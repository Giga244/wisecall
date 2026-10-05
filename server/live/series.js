// Series of live sessions (Milestone 3; docs/LIVE-SESSIONS-PLAN.md section 10): a mentor groups 2-6 of their upcoming sessions and sells
// them together for a bundle price, in ONE bank payment that holds a seat in every session. Each seat is an ordinary ticket
// (live_tickets.series_order_id) with its share of the bundle price, so everything a ticket does (the room, reminders, refunds, the
// session's payout) works unchanged; a share refund is a partial refund of the one bank order (server/live/tickets.js).
const crypto = require('crypto');
const { query, tx } = require('../db');
const config = require('../config');
const pay = require('../pay');
const textSafety = require('../textSafety');
const receipts = require('../receipts');
const sessions = require('./sessions');
const { LiveError } = sessions;

const MIN_SESSIONS = 2;
const MAX_SESSIONS = 6;
const MIN_SHARE = 500; // at least 5 ₾ per session
const UUID = /^[0-9a-f-]{36}$/i;
const feeOf = (price) => Math.round(price * config.PLATFORM_FEE_PERCENT / 100);

// ---- Reading -------------------------------------------------------------------------------------------------------------------------
async function rowById(id, client) {
  if (!UUID.test(String(id || ''))) return null;
  const run = client ? client.query.bind(client) : query;
  return (await run('SELECT * FROM live_series WHERE id = $1', [id])).rows[0] || null;
}
async function rowBySlug(slug) {
  return (await query('SELECT * FROM live_series WHERE slug = $1', [String(slug || '')])).rows[0] || null;
}
// The series' sessions, in time order, with their seats.
async function sessionsOf(seriesId, client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`SELECT id FROM live_sessions WHERE series_id = $1 ORDER BY starts_at, id`, [seriesId]);
  const out = [];
  for (const r of rows) out.push(await sessions.rowById(r.id, client));
  return out;
}
const sumOf = (list) => list.reduce((a, s) => a + s.price, 0);

// Splits the bundle price over the sessions in proportion to their normal prices; the shares add up exactly (the remainder goes, a tetri
// each, to the largest fractions).
function shares(price, list) {
  const total = sumOf(list);
  const raw = list.map((s) => (price * s.price) / total);
  const out = raw.map(Math.floor);
  let left = price - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i] += 1; left -= 1; } });
  return out;
}

// On sale: published, every session published and not started, a seat in each.
function saleState(series, list) {
  if (series.status !== 'published') return { onSale: false, reason: series.status };
  if (list.length < MIN_SESSIONS || list.some((s) => !['published', 'live'].includes(s.status))) return { onSale: false, reason: 'changed' };
  if (list.some((s) => new Date(s.starts_at).getTime() <= Date.now())) return { onSale: false, reason: 'started' };
  const seatsLeft = Math.min(...list.map((s) => Math.max(0, s.max_seats - Number(s.taken || 0))));
  return { onSale: seatsLeft > 0, reason: seatsLeft > 0 ? null : 'sold_out', seatsLeft };
}

function publicView(series, list, mentor) {
  const st = saleState(series, list);
  return {
    id: series.id, slug: series.slug, title: series.title, description: series.description, price: series.price, sumPrice: sumOf(list),
    saving: Math.max(0, sumOf(list) - series.price), status: series.status, onSale: st.onSale, notOnSaleReason: st.reason, seatsLeft: st.seatsLeft || 0,
    startsAt: list[0] ? list[0].starts_at : null,
    sessions: list.map((s) => ({ id: s.id, slug: s.slug, title: s.title, startsAt: s.starts_at, durationMin: s.duration_min, kind: s.kind, price: s.price,
      status: s.status })),
    mentor: mentor ? { id: mentor.id, name: mentor.name, username: mentor.username, roleTitle: mentor.roleTitle } : null
  };
}

// ---- The mentor: create, edit, publish, cancel ------------------------------------------------------------------------------------------
const clean = (v) => textSafety.cleanText(typeof v === 'string' ? v : '');
function checkText(value, min, max, field) {
  const t = clean(value);
  if ([...t].length < min || [...t].length > max) throw new LiveError('invalid_' + field, { field, min, max });
  if (textSafety.isOffensive(t)) throw new LiveError('offensive', { field });
  if (textSafety.findContactDetails(t).length) throw new LiveError('contact_details', { field });
  return t;
}

// The sessions a mentor may put in a series: their own, published, not started, not in another series (`except` = this series).
async function checkSessions(mentor, ids, except) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
  if (list.length < MIN_SESSIONS || list.length > MAX_SESSIONS) throw new LiveError('series_sessions', { min: MIN_SESSIONS, max: MAX_SESSIONS });
  const out = [];
  for (const id of list) {
    const s = await sessions.rowById(id);
    if (!s || s.mentor_id !== mentor.id) throw new LiveError('not_found');
    if (s.status !== 'published' || new Date(s.starts_at).getTime() <= Date.now()) throw new LiveError('series_session_not_open', { sessionId: s.id });
    if (s.series_id && s.series_id !== except) throw new LiveError('series_session_taken', { sessionId: s.id });
    out.push(s);
  }
  return out.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
}
function checkPrice(lari, list) {
  const price = Number(lari);
  if (!Number.isInteger(price)) throw new LiveError('invalid_series_price');
  const t = price * 100;
  if (t < MIN_SHARE * list.length || t >= sumOf(list)) throw new LiveError('invalid_series_price', { min: (MIN_SHARE * list.length) / 100, max: sumOf(list) / 100 - 1 });
  return t;
}
const soldAny = async (seriesId, client) => {
  const run = client ? client.query.bind(client) : query;
  return (await run(`SELECT 1 FROM live_series_orders WHERE series_id = $1 AND status IN ('held', 'paid') LIMIT 1`, [seriesId])).rows.length > 0;
};

async function create(mentor, b = {}) {
  if (!config.LIVE_SERIES_ENABLED) throw new LiveError('series_unavailable');
  const host = await sessions.canHost(mentor);
  if (!host.ok) throw new LiveError('cannot_host', { reason: host.reason });
  const title = checkText(b.title, 5, 100, 'title');
  const description = checkText(b.description, 20, 2000, 'description');
  const list = await checkSessions(mentor, b.sessionIds, null);
  const price = checkPrice(b.price, list);
  const id = crypto.randomUUID();
  await tx(async (client) => {
    await client.query(`INSERT INTO live_series (id, slug, mentor_id, title, description, price) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, sessions.slugFor(title, id), mentor.id, title, description, price]);
    // (one statement per session, each only if still free: two series cannot take the same session)
    for (const s of list) {
      const { rowCount } = await client.query('UPDATE live_sessions SET series_id = $2 WHERE id = $1 AND series_id IS NULL', [s.id, id]);
      if (!rowCount) throw new LiveError('series_session_taken', { sessionId: s.id });
    }
  });
  return ownerView(await rowById(id));
}

// Free editing until the first sale; then only the title and the description.
async function update(mentor, id, b = {}) {
  const series = await rowById(id);
  if (!series || series.mentor_id !== mentor.id) throw new LiveError('not_found');
  if (series.status === 'cancelled') throw new LiveError('not_editable');
  const title = b.title === undefined ? series.title : checkText(b.title, 5, 100, 'title');
  const description = b.description === undefined ? series.description : checkText(b.description, 20, 2000, 'description');
  const sold = await soldAny(series.id);
  const changesDeal = b.sessionIds !== undefined || (b.price !== undefined && Number(b.price) * 100 !== series.price);
  if (sold && changesDeal) throw new LiveError('locked_after_sales', { fields: ['price', 'sessionIds'] });
  await tx(async (client) => {
    let price = series.price;
    if (!sold && changesDeal) {
      const list = b.sessionIds !== undefined ? await checkSessions(mentor, b.sessionIds, series.id) : await sessionsOf(series.id, client);
      price = checkPrice(b.price !== undefined ? b.price : series.price / 100, list);
      if (b.sessionIds !== undefined) {
        await client.query('UPDATE live_sessions SET series_id = NULL WHERE series_id = $1', [series.id]);
        for (const s of list) {
          const { rowCount } = await client.query('UPDATE live_sessions SET series_id = $2 WHERE id = $1 AND series_id IS NULL', [s.id, series.id]);
          if (!rowCount) throw new LiveError('series_session_taken', { sessionId: s.id });
        }
      }
    }
    await client.query('UPDATE live_series SET title = $2, description = $3, price = $4, updated_at = now() WHERE id = $1', [series.id, title, description, price]);
  });
  return ownerView(await rowById(series.id));
}

async function publish(mentor, id) {
  const series = await rowById(id);
  if (!series || series.mentor_id !== mentor.id) throw new LiveError('not_found');
  if (series.status !== 'draft') throw new LiveError('not_a_draft');
  const list = await sessionsOf(series.id);
  await checkSessions(mentor, list.map((s) => s.id), series.id);
  checkPrice(series.price / 100, list);
  await query(`UPDATE live_series SET status = 'published', published_at = now(), updated_at = now() WHERE id = $1 AND status = 'draft'`, [series.id]);
  return ownerView(await rowById(series.id));
}

// The mentor cancels the whole series: every session of it that has not started is cancelled, and everybody (series and single tickets)
// gets their money back for those sessions.
async function cancel(mentor, id) {
  const series = await rowById(id);
  if (!series || series.mentor_id !== mentor.id) throw new LiveError('not_found');
  if (series.status === 'cancelled') throw new LiveError('not_cancellable');
  await query(`UPDATE live_series SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`, [series.id]);
  for (const s of await sessionsOf(series.id)) {
    if (['draft', 'review', 'rejected', 'published'].includes(s.status)) await sessions.cancel(s.id, 'mentor').catch((e) => console.error(`[live] cancelling ${s.id} failed:`, e.message));
  }
  return ownerView(await rowById(series.id));
}

async function ownerView(series) {
  const list = await sessionsOf(series.id);
  const { rows: [n] } = await query(`SELECT count(*) FILTER (WHERE status = 'paid')::int AS sold FROM live_series_orders WHERE series_id = $1`, [series.id]);
  return { ...publicView(series, list, null), sold: n.sold, createdAt: series.created_at, publishedAt: series.published_at };
}
async function mine(mentorId) {
  const { rows } = await query(`SELECT * FROM live_series WHERE mentor_id = $1 ORDER BY created_at DESC LIMIT 50`, [mentorId]);
  const out = [];
  for (const r of rows) out.push(await ownerView(r));
  return out;
}

// ---- Buying ---------------------------------------------------------------------------------------------------------------------------
async function buy(user, seriesId) {
  if (!config.LIVE_SERIES_ENABLED) throw new LiveError('series_unavailable');
  if (!user || !user.emailVerified) throw new LiveError('email_not_verified');
  let provider;
  try { provider = pay.current(); } catch (e) { throw new LiveError('payments_closed'); }
  if (config.LAUNCH_MODE === 'prelaunch') throw new LiveError('payments_closed');
  const series0 = await rowById(seriesId);
  if (!series0 || series0.status !== 'published') throw new LiveError('not_on_sale');
  if (series0.mentor_id === user.id) throw new LiveError('own_session');
  if (!require('../util').isListable(await require('../models').getUserById(series0.mentor_id))) throw new LiveError('not_on_sale');
  const waitlist = require('./waitlist');
  let order;
  let series;
  await tx(async (client) => {
    ({ rows: [series] } = await client.query('SELECT * FROM live_series WHERE id = $1 FOR UPDATE', [series0.id]));
    if (!series || series.status !== 'published') throw new LiveError('not_on_sale');
    // (every session row is locked, always in the same order, so two buyers of overlapping things can never wait on each other)
    const { rows: ids } = await client.query(`SELECT id FROM live_sessions WHERE series_id = $1 ORDER BY id FOR UPDATE`, [series.id]);
    if (ids.length < MIN_SESSIONS) throw new LiveError('not_on_sale');
    for (const { id } of ids) {
      await client.query(`UPDATE live_tickets SET status = 'expired' WHERE session_id = $1 AND status = 'held' AND hold_until <= now() AND provider_order_id IS NULL AND series_order_id IS NULL`, [id]);
    }
    const list = await sessionsOf(series.id, client);
    const st = saleState(series, list);
    if (!st.onSale && st.reason !== 'sold_out') throw new LiveError(st.reason === 'started' ? 'started' : 'not_on_sale');
    for (const s of list) {
      const { rows: [mine] } = await client.query(`SELECT 1 FROM live_tickets WHERE session_id = $1 AND holder_id = $2 AND status IN ('held', 'paid', 'refund_pending')`, [s.id, user.id]);
      if (mine) throw new LiveError('already_have_ticket', { sessionId: s.id });
      const w = await waitlist.standing(client, s.id, user.id);
      if (s.max_seats - Number(s.taken) + (w.offer ? 1 : 0) - (w.offer ? 0 : w.ahead) <= 0) throw new LiveError('sold_out', { sessionId: s.id });
    }
    const parts = shares(series.price, list);
    ({ rows: [order] } = await client.query(
      `INSERT INTO live_series_orders (series_id, buyer_id, price, provider, hold_until) VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5)) RETURNING *`,
      [series.id, user.id, series.price, provider.name, config.LIVE_HOLD_MINUTES]));
    for (let i = 0; i < list.length; i += 1) {
      const s = list[i];
      const price = parts[i];
      const fee = feeOf(price);
      const { rows: [n] } = await client.query(`SELECT COALESCE(max(guest_number), 0) + 1 AS n FROM live_tickets WHERE session_id = $1`, [s.id]);
      await client.query(
        `INSERT INTO live_tickets (session_id, buyer_id, holder_id, status, price, fee, net, early, provider, hold_until, guest_number, series_order_id)
         VALUES ($1, $2, $2, 'held', $3, $4, $5, false, $6, $7, $8, $9)`,
        [s.id, user.id, price, fee, price - fee, provider.name, order.hold_until, n.n, order.id]);
    }
  });
  const back = `${config.PUBLIC_URL}${user.language === 'ka' ? '/ka' : ''}/live/series/${series.slug}?order=${order.id}`;
  let bank;
  try {
    bank = await provider.createPayment({
      bookingId: order.id, amount: order.price, description: 'Wisecall live series', callbackUrl: `${config.PUBLIC_URL}/api/payments/callback`,
      successUrl: `${back}&status=success`, failUrl: `${back}&status=fail`, cancelUrl: `${back}&status=cancel`, returnUrl: `${back}&status=return`,
      ttlMinutes: Math.min(config.PAYMENT_TTL_MINUTES, config.LIVE_HOLD_MINUTES), language: user.language
    });
  } catch (e) {
    console.error('[live] could not start the bank payment for a series:', e.message);
    await closeOrder(order.id);
    throw new LiveError('payment_failed_to_start');
  }
  await query('UPDATE live_series_orders SET provider_order_id = $2 WHERE id = $1', [order.id, bank.orderId]);
  return { order: orderView({ ...order, provider_order_id: bank.orderId }), checkoutUrl: bank.redirectUrl };
}
const orderView = (o) => o && ({ id: o.id, seriesId: o.series_id, status: o.status, price: o.price, holdUntil: o.hold_until, paidAt: o.paid_at, createdAt: o.created_at });

async function closeOrder(orderId) {
  await tx(async (client) => {
    await client.query(`UPDATE live_series_orders SET status = 'expired' WHERE id = $1 AND status = 'held'`, [orderId]);
    await client.query(`UPDATE live_tickets SET status = 'expired' WHERE series_order_id = $1 AND status = 'held'`, [orderId]);
  });
}

// ---- What the bank says (the only way an order becomes paid) ---------------------------------------------------------------------------
async function syncOrder(orderId) {
  const { rows: [o0] } = await query('SELECT * FROM live_series_orders WHERE id = $1', [orderId]);
  if (!o0 || !o0.provider_order_id || !['held', 'paid', 'expired'].includes(o0.status)) return o0 || null;
  const status = await pay.forProvider(o0.provider).getPaymentStatus(o0.provider_order_id);
  let after = [];
  let out = o0;
  await tx(async (client) => {
    await client.query(`SELECT id FROM live_sessions WHERE series_id = $1 ORDER BY id FOR UPDATE`, [o0.series_id]);
    const { rows: [o] } = await client.query('SELECT * FROM live_series_orders WHERE id = $1 FOR UPDATE', [o0.id]);
    const r = await applyOrder(client, o, status);
    out = r.o;
    after = r.after;
  });
  for (const fn of after) Promise.resolve().then(fn).catch((e) => console.error('[live] series follow-up failed:', e.message));
  return out;
}

async function applyOrder(client, o, status) {
  const after = [];
  const amountOk = status.amount === o.price && (!status.currency || status.currency === o.currency);
  const lapsed = o.status === 'held' && new Date(o.hold_until).getTime() <= Date.now();
  const paidNow = async (keepSeats) => {
    const { rows: [u] } = await client.query(`UPDATE live_series_orders SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING *`, [o.id]);
    const { rows: kids } = await client.query(
      `UPDATE live_tickets SET status = 'paid', paid_at = now() WHERE series_order_id = $1 AND status IN ('held', 'expired') RETURNING *`, [o.id]);
    const receipt = await receipts.issueSeriesOrder(o.id, 'payment', o.price, client);
    for (const k of kids) await require('./waitlist').bought(client, k.session_id, k.holder_id);
    const series = await rowById(o.series_id, client);
    after.push(async () => {
      // (a session of it that was cancelled meanwhile, or no seats any more: those shares go straight back)
      const refundIds = [];
      for (const k of kids) {
        const { rows: [s] } = await query('SELECT status FROM live_sessions WHERE id = $1', [k.session_id]);
        if (!keepSeats || !['published', 'live'].includes(s.status)) refundIds.push(k.id);
      }
      await require('./notices').seriesPaid(u, series, receipt, refundIds.length === kids.length);
      for (const id of refundIds) await require('./tickets').refund(id, keepSeats ? 'session_cancelled' : 'late_payment').catch((e) => console.error(`[live] refund ${id} failed:`, e.message));
    });
    return u;
  };
  if (o.status === 'held' && status.status === 'paid' && !lapsed) {
    if (!amountOk) { console.error(`[live] amount mismatch for series order ${o.id}: expected ${o.price}, bank says ${status.amount}. Not marking paid.`); return { o, after }; }
    return { o: await paidNow(true), after };
  }
  if (o.status === 'held' && ['failed', 'expired'].includes(status.status)) {
    const { rows: [u] } = await client.query(`UPDATE live_series_orders SET status = 'expired' WHERE id = $1 RETURNING *`, [o.id]);
    await client.query(`UPDATE live_tickets SET status = 'expired' WHERE series_order_id = $1 AND status = 'held'`, [o.id]);
    return { o: u, after };
  }
  // Paid after the hold ran out: kept only if every session still has a seat and this person no other ticket for it; otherwise every
  // share goes straight back.
  if ((o.status === 'expired' || lapsed) && status.status === 'paid' && amountOk) {
    await client.query(`UPDATE live_tickets SET status = 'expired' WHERE series_order_id = $1 AND status = 'held'`, [o.id]);
    let keep = true;
    const { rows: kids } = await client.query('SELECT * FROM live_tickets WHERE series_order_id = $1', [o.id]);
    for (const k of kids) {
      const s = await sessions.rowById(k.session_id, client);
      const { rows: [other] } = await client.query(
        `SELECT 1 FROM live_tickets WHERE session_id = $1 AND holder_id = $2 AND id <> $3 AND status IN ('held', 'paid', 'refund_pending')`, [k.session_id, k.holder_id, k.id]);
      if (other || s.status !== 'published' || new Date(s.starts_at).getTime() <= Date.now() || Number(s.taken) >= s.max_seats) keep = false;
    }
    if (!keep) {
      // (the seats are not taken: the tickets stay expired; the whole payment goes back as one refund)
      const { rows: [u] } = await client.query(`UPDATE live_series_orders SET status = 'paid', paid_at = now() WHERE id = $1 RETURNING *`, [o.id]);
      const receipt = await receipts.issueSeriesOrder(o.id, 'payment', o.price, client);
      after.push(async () => { await receipts.email(receipt); await refundWhole(u.id, 'late_payment'); });
      return { o: u, after };
    }
    return { o: await paidNow(true), after };
  }
  return { o, after };
}

// A whole order back in one refund (only for a late payment whose seats were never given): the order becomes refunded.
async function refundWhole(orderId, reason) {
  const { rows: [o] } = await query('SELECT * FROM live_series_orders WHERE id = $1', [orderId]);
  if (!o || o.status !== 'paid') return o;
  try {
    await pay.forProvider(o.provider).refund({ orderId: o.provider_order_id, amount: o.price, idempotencyKey: `live-series-refund-${o.id}` });
  } catch (e) {
    console.error(`[live] the bank refused the refund of series order ${o.id} (the sweep retries):`, e.message);
    return o;
  }
  let receipt;
  await tx(async (client) => {
    const { rows: [u] } = await client.query(`UPDATE live_series_orders SET status = 'refunded' WHERE id = $1 AND status = 'paid' RETURNING *`, [o.id]);
    if (u) receipt = await receipts.issueSeriesOrder(o.id, 'refund', o.price, client);
  });
  if (receipt) receipts.email(receipt).catch(() => {});
  return { ...o, status: 'refunded', reason };
}

async function findByOrder(providerName, orderId) {
  const { rows } = await query('SELECT id FROM live_series_orders WHERE provider = $1 AND provider_order_id = $2', [providerName, orderId]);
  return rows[0] ? rows[0].id : null;
}

// After a share of an order was refunded: the order is "refunded" once nothing of it is left.
async function settleOrder(client, orderId) {
  await client.query(
    `UPDATE live_series_orders SET status = 'refunded' WHERE id = $1 AND status = 'paid'
        AND NOT EXISTS (SELECT 1 FROM live_tickets WHERE series_order_id = $1 AND status IN ('held', 'paid', 'refund_pending'))`, [orderId]);
}

// ---- The sweep ------------------------------------------------------------------------------------------------------------------------
async function expireHolds() {
  const { rows } = await query(`SELECT id FROM live_series_orders WHERE status = 'held' AND hold_until <= now() LIMIT 100`);
  for (const { id } of rows) {
    try {
      const o = await syncOrder(id);
      if (o && o.status === 'held') await closeOrder(id);
    } catch (e) {
      const { rows: [o] } = await query('SELECT hold_until FROM live_series_orders WHERE id = $1', [id]);
      if (o && new Date(o.hold_until).getTime() < Date.now() - config.LIVE_HOLD_MINUTES * 60000) await closeOrder(id);
    }
  }
  // (a late payment refunded as a whole whose bank call failed: tried again)
  const { rows: late } = await query(
    `SELECT o.id FROM live_series_orders o WHERE o.status = 'paid' AND NOT EXISTS (SELECT 1 FROM live_tickets t WHERE t.series_order_id = o.id AND t.status <> 'expired') LIMIT 50`);
  for (const { id } of late) await refundWhole(id, 'late_payment').catch(() => {});
}

// The buyer's series orders (their tickets are listed with the other tickets).
async function ordersOf(userId) {
  const { rows } = await query(
    `SELECT o.*, s.title, s.slug FROM live_series_orders o JOIN live_series s ON s.id = o.series_id
      WHERE o.buyer_id = $1 AND o.status IN ('paid', 'refunded') ORDER BY o.created_at DESC LIMIT 50`, [userId]);
  return rows.map((r) => ({ ...orderView(r), series: { title: r.title, slug: r.slug } }));
}

module.exports = { rowById, rowBySlug, sessionsOf, shares, saleState, publicView, create, update, publish, cancel, ownerView, mine, buy, syncOrder,
  applyOrder, findByOrder, settleOrder, closeOrder, refundWhole, expireHolds, ordersOf, orderView, MIN_SESSIONS, MAX_SESSIONS };
