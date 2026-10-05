// Tickets for live sessions. The same money rules as questions (server/payments.js), through the same bank layer (server/pay):
//   - a seat is HELD for LIVE_HOLD_MINUTES while the buyer pays; the session row is locked while seats are counted, so a session can
//     never be oversold, however many people press "Buy" at once;
//   - a ticket is PAID only when the bank's status check says so, for the right amount (callback, the buyer's return, the sweep);
//   - refunds are full, idempotent (one idempotency key per ticket) and retried by the sweep; "refund_pending" until the bank confirms.
// Two people per ticket (Milestone 2, gifts): buyer_id paid for it (receipts, refunds to their card); holder_id attends it (the room,
// reminders, rating). They are the same person unless it is a gift; an unclaimed gift has no holder yet.
const crypto = require('crypto');
const { query, tx } = require('../db');
const config = require('../config');
const pay = require('../pay');
const textSafety = require('../textSafety');
const receipts = require('../receipts');
const sessions = require('./sessions');
const { LiveError } = sessions;

const ACTIVE = `('held', 'paid', 'refund_pending')`;
const GIFTS_MAX = 5; // unclaimed gifts one person can have for one session
const feeOf = (price) => Math.round(price * config.PLATFORM_FEE_PERCENT / 100);
const view = (t) => t && ({
  id: t.id, sessionId: t.session_id, status: t.status, price: t.price, early: t.early, holdUntil: t.hold_until, paidAt: t.paid_at,
  refundedAt: t.refunded_at, refundReason: t.refund_reason, joinAnonymous: t.join_anonymous, createdAt: t.created_at,
  gift: t.gift_email ? { claimed: Boolean(t.gift_claimed_at) } : null
});
const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

async function lockTicket(client, id) {
  const { rows } = await client.query('SELECT * FROM live_tickets WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] || null;
}

// ---- Buying ---------------------------------------------------------------------------------------------------------------------------
// -> { ticket, checkoutUrl }. Up to 2 questions for the mentor, sent before paying (anonymous to the other participants). With
// `giftEmail`, the ticket is a gift: once paid, that address gets a link to claim it.
async function buy(user, sessionId, { questions, anonymous, giftEmail } = {}) {
  if (!user || !user.emailVerified) throw new LiveError('email_not_verified');
  let provider;
  try { provider = pay.current(); } catch (e) { throw new LiveError('payments_closed'); }
  if (config.LAUNCH_MODE === 'prelaunch') throw new LiveError('payments_closed');
  let gift = null;
  if (giftEmail !== undefined && giftEmail !== null && giftEmail !== '') {
    gift = String(giftEmail).trim().toLowerCase();
    if (gift.length > 254 || !EMAIL_RE.test(gift)) throw new LiveError('invalid_gift_email');
    if (gift === String(user.email || '').toLowerCase()) throw new LiveError('gift_to_self');
  }
  // (a gift's questions are asked in the room, by the person who attends)
  const qs = gift ? [] : (Array.isArray(questions) ? questions : []).map((q) => textSafety.cleanText(String(q || ''))).filter(Boolean);
  if (qs.length > 2) throw new LiveError('too_many_questions');
  for (const q of qs) {
    if ([...q].length < 3 || [...q].length > 300) throw new LiveError('invalid_question');
    if (textSafety.isOffensive(q)) throw new LiveError('offensive');
  }
  // A mentor who is no longer listed (a missing step, a suspension) cannot sell new tickets. Checked BEFORE the transaction: inside it,
  // every waiting buyer holds a database connection, so the lock holder must not need a second one.
  const { rows: [pre] } = await query('SELECT mentor_id FROM live_sessions WHERE id = $1', [/^[0-9a-f-]{36}$/i.test(String(sessionId || '')) ? sessionId : null]);
  if (!pre) throw new LiveError('not_on_sale');
  if (!require('../util').isListable(await require('../models').getUserById(pre.mentor_id))) throw new LiveError('not_on_sale');
  const waitlist = require('./waitlist');
  let ticket;
  let session;
  await tx(async (client) => {
    // (the session row is the lock every buyer of this session waits on: seats are counted one buyer at a time)
    const { rows: [locked] } = await client.query('SELECT * FROM live_sessions WHERE id = $1 FOR UPDATE', [sessionId]);
    // (on sale until the start, also once the mentor has opened the room a few minutes early)
    if (!locked || !['published', 'live'].includes(locked.status)) throw new LiveError('not_on_sale');
    if (new Date(locked.starts_at).getTime() <= Date.now()) throw new LiveError('started');
    if (locked.mentor_id === user.id) throw new LiveError('own_session');
    // Holds that ran out free their seat (the sweep also asks the bank about them; a late payment is handled in sync()).
    await client.query(`UPDATE live_tickets SET status = 'expired' WHERE session_id = $1 AND status = 'held' AND hold_until <= now() AND provider_order_id IS NULL`, [locked.id]);
    if (gift) {
      const { rows: [g] } = await client.query(
        `SELECT count(*)::int AS n FROM live_tickets WHERE session_id = $1 AND buyer_id = $2 AND gift_email IS NOT NULL AND gift_claimed_at IS NULL AND status IN ${ACTIVE}`, [locked.id, user.id]);
      if (g.n >= GIFTS_MAX) throw new LiveError('too_many_gifts', { max: GIFTS_MAX });
    } else {
      const { rows: [mine] } = await client.query(`SELECT * FROM live_tickets WHERE session_id = $1 AND holder_id = $2 AND status IN ${ACTIVE}`, [locked.id, user.id]);
      if (mine && mine.status !== 'held') throw new LiveError('already_have_ticket');
      if (mine && mine.status === 'held' && new Date(mine.hold_until).getTime() > Date.now()) throw new LiveError('payment_in_progress', { ticketId: mine.id });
      if (mine) await client.query(`UPDATE live_tickets SET status = 'expired' WHERE id = $1`, [mine.id]);
    }
    const s = await sessions.rowById(locked.id, client);
    // The seats taken count the seats kept for people on the waiting list; this person's own kept seat is theirs, and people still
    // waiting before them come first.
    const w = await waitlist.standing(client, s.id, user.id);
    const free = s.max_seats - Number(s.taken) + (w.offer ? 1 : 0) - (w.offer ? 0 : w.ahead);
    if (free <= 0) throw new LiveError('sold_out');
    const { price, early } = sessions.currentPrice(s);
    const fee = feeOf(price);
    const { rows: [n] } = await client.query(`SELECT COALESCE(max(guest_number), 0) + 1 AS n FROM live_tickets WHERE session_id = $1`, [s.id]);
    const { rows: [t] } = await client.query(
      `INSERT INTO live_tickets (session_id, buyer_id, holder_id, gift_email, status, price, fee, net, early, provider, hold_until, join_anonymous, guest_number)
       VALUES ($1, $2, $3, $4, 'held', $5, $6, $7, $8, $9, now() + make_interval(mins => $10), $11, $12) RETURNING *`,
      [s.id, user.id, gift ? null : user.id, gift, price, fee, price - fee, early, provider.name, config.LIVE_HOLD_MINUTES, anonymous === true, n.n]);
    for (const q of qs) {
      await client.query(`INSERT INTO live_questions (session_id, ticket_id, author_id, body, source) VALUES ($1, $2, $3, $4, 'checkout')`, [s.id, t.id, user.id, q]);
    }
    ticket = t;
    session = s;
  });
  const back = `${config.PUBLIC_URL}${user.language === 'ka' ? '/ka' : ''}/live/${session.slug}?ticket=${ticket.id}`;
  let order;
  try {
    order = await provider.createPayment({
      bookingId: ticket.id, amount: ticket.price, description: 'Wisecall live', callbackUrl: `${config.PUBLIC_URL}/api/payments/callback`,
      successUrl: `${back}&status=success`, failUrl: `${back}&status=fail`, cancelUrl: `${back}&status=cancel`, returnUrl: `${back}&status=return`,
      ttlMinutes: Math.min(config.PAYMENT_TTL_MINUTES, config.LIVE_HOLD_MINUTES), language: user.language
    });
  } catch (e) {
    console.error('[live] could not start the bank payment:', e.message);
    await query(`UPDATE live_tickets SET status = 'expired' WHERE id = $1 AND status = 'held'`, [ticket.id]);
    throw new LiveError('payment_failed_to_start');
  }
  await query('UPDATE live_tickets SET provider_order_id = $2 WHERE id = $1', [ticket.id, order.orderId]);
  return { ticket: view({ ...ticket, provider_order_id: order.orderId }), checkoutUrl: order.redirectUrl };
}

// A ticket just became paid (inside the transaction): the receipt; for a gift, a fresh claim link (only its hash is kept); the holder's
// place on the waiting list is closed. -> the follow-up to run after the commit.
async function onPaid(client, u, s) {
  const receipt = await receipts.issueTicket(u.id, 'payment', u.price, client);
  let raw = null;
  if (u.gift_email && !u.gift_claimed_at) {
    raw = crypto.randomBytes(24).toString('base64url');
    await client.query('UPDATE live_tickets SET gift_token_hash = $2 WHERE id = $1', [u.id, hashToken(raw)]);
  }
  if (u.holder_id) await require('./waitlist').bought(client, s.id, u.holder_id);
  return { receipt, notify: () => require('./notices').ticketPaid(u, s, receipt, raw) };
}

// ---- What the bank says ---------------------------------------------------------------------------------------------------------------
// Applies the bank's status to one ticket (locked, with its session locked first). Returns the work to do after the commit.
async function apply(client, t, s, status) {
  const after = [];
  const amountOk = status.amount === t.price && (!status.currency || status.currency === t.currency);
  // (a hold whose time ran out no longer reserves its seat: a payment after that is a late one, below, even before the sweep closed it)
  const lapsed = t.status === 'held' && new Date(t.hold_until).getTime() <= Date.now();
  if (t.status === 'held' && status.status === 'paid' && !lapsed) {
    if (!amountOk) { console.error(`[live] amount mismatch for ticket ${t.id}: expected ${t.price}, bank says ${status.amount}. Not marking paid.`); return { t, after }; }
    const { rows: [u] } = await client.query(`UPDATE live_tickets SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING *`, [t.id]);
    const p = await onPaid(client, u, s);
    after.push(p.notify);
    return { t: u, after };
  }
  if (t.status === 'held' && ['failed', 'expired'].includes(status.status)) {
    const { rows: [u] } = await client.query(`UPDATE live_tickets SET status = 'expired' WHERE id = $1 RETURNING *`, [t.id]);
    return { t: u, after };
  }
  // The bank took the money after the hold ran out: the seat is taken if it is still free and the session still on sale; otherwise
  // the money goes straight back.
  if ((t.status === 'expired' || lapsed) && status.status === 'paid' && amountOk) {
    const fresh = await sessions.rowById(s.id, client);
    // (the seats taken never count this ticket here: it is expired, or a hold whose time has run out)
    const seat = fresh.status === 'published' && new Date(fresh.starts_at).getTime() > Date.now() && Number(fresh.taken) < fresh.max_seats;
    const { rows: [u] } = await client.query(`UPDATE live_tickets SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING *`, [t.id]);
    if (seat) {
      const p = await onPaid(client, u, s);
      after.push(p.notify);
    } else {
      const receipt = await receipts.issueTicket(u.id, 'payment', u.price, client);
      after.push(async () => { await receipts.email(receipt); await refund(u.id, 'late_payment').catch((e) => console.error(`[live] refund of late payment ${u.id} failed:`, e.message)); });
    }
    return { t: u, after };
  }
  if (status.status === 'refunded' && ['paid', 'refund_pending'].includes(t.status)) {
    const { rows: [u] } = await client.query(
      `UPDATE live_tickets SET status = 'refunded', refunded_at = now(), refund_error = NULL, refund_reason = COALESCE(refund_reason, 'refunded_at_bank'),
         gift_token_hash = NULL WHERE id = $1 RETURNING *`, [t.id]);
    // (after an earlier partial refund only the rest goes back, and only the rest of the mentor's share comes off)
    const already = u.refunded_amount || 0;
    await require('../ledger').onTicketRefunded(client, u, u.net - shareOf(u, already));
    const receipt = await receipts.issueTicket(u.id, 'refund', u.price - already, client);
    after.push(() => require('./notices').ticketRefunded(u, s, receipt));
    return { t: u, after };
  }
  return { t, after };
}

// Asks the bank about this ticket and records it. The only way a ticket becomes paid. Safe to call any number of times.
async function sync(ticketId) {
  const { rows: [t0] } = await query('SELECT * FROM live_tickets WHERE id = $1', [ticketId]);
  if (!t0 || !t0.provider_order_id || !['held', 'paid', 'refund_pending', 'expired'].includes(t0.status)) return t0 || null;
  const status = await pay.forProvider(t0.provider).getPaymentStatus(t0.provider_order_id);
  let result = { t: t0, after: [] };
  await tx(async (client) => {
    const { rows: [s] } = await client.query('SELECT * FROM live_sessions WHERE id = $1 FOR UPDATE', [t0.session_id]);
    const t = await lockTicket(client, t0.id);
    if (t && s) result = await apply(client, t, s, status);
  });
  for (const fn of result.after) Promise.resolve().then(fn).catch((e) => console.error('[live] follow-up failed:', e.message));
  return result.t;
}

// The bank's callback (server/payments.js asks here when the order is not a question's).
async function findByOrder(providerName, orderId) {
  const { rows } = await query('SELECT id FROM live_tickets WHERE provider = $1 AND provider_order_id = $2', [providerName, orderId]);
  return rows[0] ? rows[0].id : null;
}

// ---- Refunds --------------------------------------------------------------------------------------------------------------------------
// Full refund of a paid ticket; a hold that was never paid is simply closed. Idempotent; a bank error leaves "refund_pending" with the
// error recorded, and the sweep tries again.
async function refund(ticketId, reason) {
  let claimed = null;
  let done = null;
  await tx(async (client) => {
    const t = await lockTicket(client, ticketId);
    if (!t) throw new LiveError('not_found');
    if (t.status === 'held') {
      await client.query(`UPDATE live_tickets SET status = 'expired' WHERE id = $1`, [t.id]);
      done = { ...t, status: 'expired' };
      return;
    }
    if (t.status === 'refunded' || t.status === 'expired' || (t.status === 'refund_pending' && !t.refund_error)) { done = t; return; }
    try { pay.forProvider(t.provider); } catch (e) { throw new LiveError('provider_unavailable'); }
    const { rows: [u] } = await client.query(
      `UPDATE live_tickets SET status = 'refund_pending', refund_requested_at = COALESCE(refund_requested_at, now()), refund_reason = COALESCE(refund_reason, $2),
         refund_error = NULL WHERE id = $1 RETURNING *`, [t.id, reason]);
    claimed = u;
  });
  if (done) return done;
  try {
    const r = await pay.forProvider(claimed.provider).refund({ orderId: claimed.provider_order_id, amount: claimed.price - (claimed.refunded_amount || 0),
      idempotencyKey: `live-refund-${claimed.id}` });
    await query('UPDATE live_tickets SET provider_refund_id = $2 WHERE id = $1', [claimed.id, r.refundId]);
  } catch (err) {
    console.error(`[live] the bank refused or failed the refund for ticket ${claimed.id}:`, err.message);
    await query('UPDATE live_tickets SET refund_error = $2 WHERE id = $1', [claimed.id, String(err.message).slice(0, 300)]);
    const now = await sync(claimed.id).catch(() => null);
    if (now && now.status === 'refunded') return now;
    throw new LiveError('refund_failed');
  }
  try { return (await sync(claimed.id)) || claimed; } catch (e) { return claimed; }
}

// The mentor's part of `amount` tetri returned on this ticket: in proportion to their share of its price (the platform keeps the same
// proportion of its fee), rounded to the nearest tetri.
const shareOf = (t, amount) => Math.round((amount * t.net) / t.price);

// A partial refund (an admin settling a dispute about a session that was not as described): `amount` tetri goes back, the ticket stays
// paid. Claimed first, so two admins cannot send it twice; the ledger and the receipt change only after the bank accepted it.
async function partialRefund(ticketId, amount, reason) {
  let claimed = null;
  await tx(async (client) => {
    const t = await lockTicket(client, ticketId);
    if (!t) throw new LiveError('not_found');
    if (t.status !== 'paid') throw new LiveError('not_refundable');
    if (t.refunded_amount || t.partial_refund_started_at) throw new LiveError('already_partly_refunded');
    if (!Number.isInteger(amount) || amount < 1 || amount >= t.price) throw new LiveError('invalid_amount');
    try { pay.forProvider(t.provider); } catch (e) { throw new LiveError('provider_unavailable'); }
    await client.query('UPDATE live_tickets SET partial_refund_started_at = now() WHERE id = $1', [t.id]);
    claimed = t;
  });
  try {
    await pay.forProvider(claimed.provider).refund({ orderId: claimed.provider_order_id, amount, partial: true, idempotencyKey: `live-partial-refund-${claimed.id}` });
  } catch (err) {
    await query('UPDATE live_tickets SET partial_refund_started_at = NULL WHERE id = $1', [claimed.id]); // (nothing was returned: it can be tried again)
    console.error(`[live] the bank refused the partial refund for ticket ${claimed.id}:`, err.message);
    throw new LiveError('refund_failed');
  }
  let receipt;
  let updated;
  await tx(async (client) => {
    const t = await lockTicket(client, claimed.id);
    ({ rows: [updated] } = await client.query('UPDATE live_tickets SET refunded_amount = $2, refund_reason = $3 WHERE id = $1 RETURNING *', [t.id, amount, reason]));
    await require('../ledger').onTicketRefunded(client, t, shareOf(t, amount));
    receipt = await receipts.issueTicket(t.id, 'refund', amount, client);
  });
  receipts.email(receipt).catch((e) => console.error('[live] receipt email failed:', e.message));
  return updated;
}

// Who may cancel a ticket: the person who attends it (the buyer, or whoever claimed a gift); the buyer while a gift is unclaimed. The
// money always goes back to the card that paid.
const canceller = (t) => t.holder_id || t.buyer_id;

// Cancelling: a full refund until 24 hours before the start, or, after the mentor moved the time, until the start. The seat then goes
// to the first person on the waiting list.
async function cancelByBuyer(user, ticketId) {
  const { rows: [t] } = await query('SELECT t.*, s.starts_at, s.time_changed_at, s.status AS session_status FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE t.id = $1', [ticketId]);
  if (!t || canceller(t) !== user.id) throw new LiveError('not_found');
  if (t.status !== 'paid') throw new LiveError('not_cancellable');
  const start = new Date(t.starts_at).getTime();
  const moved = t.time_changed_at && t.paid_at && new Date(t.time_changed_at) > new Date(t.paid_at);
  const limit = moved ? start : start - 24 * 3600000;
  if (Date.now() > limit) throw new LiveError('too_late_to_cancel');
  const out = await refund(t.id, 'buyer_cancel');
  require('./waitlist').offerFreedSeats(t.session_id).catch((e) => console.error('[live] waiting list hand-off failed:', e.message));
  return view(out);
}

// ---- Gifts ----------------------------------------------------------------------------------------------------------------------------
// The person the gift is for opens the link, signs in (or creates an account) and the ticket becomes theirs. The link works once.
async function claimGift(user, rawToken) {
  if (!user || !user.emailVerified) throw new LiveError('email_not_verified');
  const raw = String(rawToken || '');
  if (raw.length < 20 || raw.length > 100) throw new LiveError('not_found');
  let t;
  let s;
  await tx(async (client) => {
    const { rows: [found] } = await client.query(`SELECT id, session_id FROM live_tickets WHERE gift_token_hash = $1`, [hashToken(raw)]);
    if (!found) throw new LiveError('not_found');
    ({ rows: [s] } = await client.query('SELECT * FROM live_sessions WHERE id = $1 FOR UPDATE', [found.session_id]));
    const locked = await lockTicket(client, found.id);
    if (!locked || locked.status !== 'paid' || locked.gift_claimed_at || locked.gift_token_hash !== hashToken(raw)) throw new LiveError('not_found');
    if (!['published', 'live'].includes(s.status) || Date.now() > sessions.endsAt(s).getTime()) throw new LiveError('gift_closed');
    if (s.mentor_id === user.id) throw new LiveError('own_session');
    const { rows: [has] } = await client.query(`SELECT 1 FROM live_tickets WHERE session_id = $1 AND holder_id = $2 AND status IN ${ACTIVE}`, [s.id, user.id]);
    if (has) throw new LiveError('already_have_ticket');
    ({ rows: [t] } = await client.query(
      `UPDATE live_tickets SET holder_id = $2, gift_claimed_at = now(), gift_token_hash = NULL WHERE id = $1 RETURNING *`, [locked.id, user.id]));
    await require('./waitlist').bought(client, s.id, user.id);
  });
  require('./notices').giftClaimed(t, s, user).catch((e) => console.error('[live] gift claim notices failed:', e.message));
  return { ticket: view(t), session: { slug: s.slug, title: s.title, startsAt: s.starts_at } };
}

// The buyer sends the claim email again (a new link; the old one stops working), e.g. when it went to spam.
async function resendGift(user, ticketId) {
  const raw = crypto.randomBytes(24).toString('base64url');
  const { rows: [t] } = await query(
    `UPDATE live_tickets SET gift_token_hash = $3 WHERE id = $1 AND buyer_id = $2 AND status = 'paid' AND gift_email IS NOT NULL AND gift_claimed_at IS NULL RETURNING *`,
    [ticketId, user.id, hashToken(raw)]);
  if (!t) throw new LiveError('not_found');
  const { rows: [s] } = await query('SELECT * FROM live_sessions WHERE id = $1', [t.session_id]);
  await require('./notices').giftLink(t, s, raw);
  return { ok: true };
}

// ---- The sweep --------------------------------------------------------------------------------------------------------------------------
// Holds that ran out: the bank is asked first (a payment can arrive late), then they are closed.
async function expireHolds() {
  const { rows } = await query(`SELECT id FROM live_tickets WHERE status = 'held' AND hold_until <= now() LIMIT 200`);
  let n = 0;
  for (const { id } of rows) {
    try {
      const t = await sync(id);
      if (t && t.status === 'held') { await query(`UPDATE live_tickets SET status = 'expired' WHERE id = $1 AND status = 'held'`, [id]); n += 1; }
    } catch (e) {
      // (the bank did not answer: closed anyway after one more hold period; a late payment is still caught by the callback)
      await query(`UPDATE live_tickets SET status = 'expired' WHERE id = $1 AND status = 'held' AND hold_until < now() - make_interval(mins => $2)`, [id, config.LIVE_HOLD_MINUTES]);
    }
  }
  return n;
}
async function retryRefunds() {
  const { rows } = await query(`SELECT id FROM live_tickets WHERE status = 'refund_pending' AND (refund_error IS NOT NULL OR refund_requested_at < now() - interval '5 minutes') LIMIT 100`);
  for (const { id } of rows) {
    const { rows: [t] } = await query('SELECT * FROM live_tickets WHERE id = $1', [id]);
    if (t.refund_error) await refund(id, t.refund_reason).catch(() => {});
    else await sync(id).catch(() => {});
  }
}

// ---- Reading -------------------------------------------------------------------------------------------------------------------------
// The tickets this person attends, and the gifts they paid for (the address a gift went to is shown only to its buyer).
async function mine(userId) {
  const { rows } = await query(
    `SELECT t.*, s.slug, s.title, s.starts_at, s.duration_min, s.status AS session_status, s.kind, s.time_changed_at, s.end_kind, s.ended_at,
            m.name AS mentor_name, m.username AS mentor_username,
            (SELECT r.stars FROM live_ratings r WHERE r.ticket_id = t.id) AS my_stars
       FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id JOIN users m ON m.id = s.mentor_id
      WHERE (t.holder_id = $1 OR t.buyer_id = $1) AND t.status IN ('paid', 'refund_pending', 'refunded') ORDER BY s.starts_at DESC LIMIT 100`, [userId]);
  const disputes = require('../disputes');
  const after = require('./after');
  const found = await disputes.forTickets(rows.map((r) => r.id));
  return rows.map((r) => {
    const start = new Date(r.starts_at).getTime();
    const moved = r.time_changed_at && r.paid_at && new Date(r.time_changed_at) > new Date(r.paid_at);
    const attends = r.holder_id === userId;
    const giver = Boolean(r.gift_email) && r.buyer_id === userId;
    const w = attends ? disputes.windowForTicket(r, { status: r.session_status, end_kind: r.end_kind, ended_at: r.ended_at }) : null;
    const rateable = attends && r.status === 'paid' && r.session_status === 'ended' && r.end_kind === 'normal' && r.attended_seconds >= after.ATTENDED_S
      && Date.now() < new Date(r.ended_at).getTime() + after.RATE_DAYS * 86400000;
    return { ...view(r), refundedAmount: r.refunded_amount || null, attends,
      gift: r.gift_email ? { claimed: Boolean(r.gift_claimed_at), email: giver ? r.gift_email : null, mine: giver, fromSomeone: attends && r.buyer_id !== userId } : null,
      session: { slug: r.slug, title: r.title, startsAt: r.starts_at, durationMin: r.duration_min, status: r.session_status, kind: r.kind,
        mentorName: r.mentor_name, mentorUsername: r.mentor_username, timeChanged: Boolean(moved) },
      dispute: attends ? (found[r.id] || null) : null, disputeUntil: w && Date.now() < +w.until && !found[r.id] ? w.until : null,
      rating: r.my_stars || null, canRate: rateable && !r.my_stars,
      canCancel: canceller(r) === userId && r.status === 'paid' && Date.now() <= (moved ? start : start - 24 * 3600000),
      canResendGift: giver && !r.gift_claimed_at && r.status === 'paid' && ['published', 'live'].includes(r.session_status),
      canJoin: attends && r.status === 'paid' && ['published', 'live'].includes(r.session_status) && Date.now() >= start - 10 * 60000 && Date.now() <= start + (r.duration_min + 30) * 60000 };
  });
}

module.exports = { buy, sync, apply, refund, partialRefund, shareOf, cancelByBuyer, claimGift, resendGift, expireHolds, retryRefunds, findByOrder, mine, view,
  feeOf, hashToken };
