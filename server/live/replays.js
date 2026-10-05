// Replays (Milestone 3, opt-in; docs/LIVE-SESSIONS-PLAN.md section 10). A Live Q&A or Workshop can be recorded: only the mentor's video and
// screen (nobody else can be given the microphone in a recorded session, and the written questions are not in the video). After a normal
// end the recording is attached to the session. Ticket holders watch it free for 30 days after the session; anybody else buys a 30-day
// pass (the same bank layer and money rules as tickets; the mentor's 80 % is a payout of its own). The mentor (or an admin) can delete the
// replay at any time: passes still running are refunded in full. Sales close 60 days after the session; the file goes after 90.
const { query, tx } = require('../db');
const config = require('../config');
const pay = require('../pay');
const receipts = require('../receipts');
const sessions = require('./sessions');
const { LiveError } = sessions;

const TICKET_DAYS = 30; // ticket holders: from the end of the session
const PASS_DAYS = 30; // a pass: from its payment
const SALE_DAYS = 60;
const KEEP_DAYS = 90;
const UUID = /^[0-9a-f-]{36}$/i;
const feeOf = (price) => Math.round(price * config.PLATFORM_FEE_PERCENT / 100);
// (the provider that made the room records it; the one that stored a replay plays and deletes it)
const video = () => require('./provider');

// ---- Recording (the mentor, from the room) --------------------------------------------------------------------------------------------
async function setRecording(user, sessionId, start) {
  const room = require('./room');
  const a = await room.access(user, sessionId);
  if (a.role !== 'mentor') throw new LiveError('forbidden');
  const s = a.session;
  if (!s.replay_enabled) throw new LiveError('not_recorded');
  if (s.status !== 'live') throw new LiveError('not_live');
  const p = video().forRoomUrl(s.room_url);
  if (start) {
    if (s.recording_started_at && !s.recording_stopped_at) return { recording: true };
    await p.startRecording({ roomName: s.room_name, ownerUserId: user.id });
    await query('UPDATE live_sessions SET recording_started_at = COALESCE(recording_started_at, now()), recording_stopped_at = NULL WHERE id = $1', [s.id]);
    return { recording: true };
  }
  if (s.recording_started_at && !s.recording_stopped_at) {
    await p.stopRecording({ roomName: s.room_name }).catch((e) => console.error('[live] stopping the recording failed:', e.message));
    await query('UPDATE live_sessions SET recording_stopped_at = now() WHERE id = $1', [s.id]);
  }
  return { recording: false };
}
const isRecording = (s) => Boolean(s.recording_started_at && !s.recording_stopped_at);

// ---- After the session (the sweep) -------------------------------------------------------------------------------------------------------
// A session that ended normally: its finished recording becomes the replay. A recording of a session that did not take place (short,
// cancelled) is deleted. Old replays are deleted.
async function sweep() {
  const { rows: done } = await query(
    `SELECT s.* FROM live_sessions s WHERE s.replay_enabled AND s.recording_started_at IS NOT NULL AND s.status = 'ended' AND s.end_kind = 'normal'
        AND s.ended_at > now() - interval '3 days' AND NOT EXISTS (SELECT 1 FROM live_replays r WHERE r.session_id = s.id) LIMIT 20`);
  for (const s of done) {
    try {
      const p = video().forRoomUrl(s.room_url);
      const rec = await p.findRecording({ roomName: s.room_name || s.slug, sessionId: s.id });
      if (rec) await query(`INSERT INTO live_replays (session_id, recording_id, provider, duration_s) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [s.id, rec.id, p.name, rec.durationS || null]);
    } catch (e) { console.error(`[live] attaching the replay of ${s.id} failed:`, e.message); }
  }
  const { rows: dropped } = await query(
    `SELECT s.* FROM live_sessions s WHERE s.replay_enabled AND s.recording_started_at IS NOT NULL AND s.status = 'cancelled'
        AND s.cancelled_at > now() - interval '3 days' AND NOT EXISTS (SELECT 1 FROM live_replays r WHERE r.session_id = s.id) LIMIT 20`);
  for (const s of dropped) {
    try {
      const p = video().forRoomUrl(s.room_url);
      const rec = await p.findRecording({ roomName: s.room_name || s.slug, sessionId: s.id });
      if (rec) await p.deleteRecording(rec.id);
      // (not found yet: the service may still be finishing it; asked again by the next sweeps for a day)
      else if (new Date(s.cancelled_at).getTime() > Date.now() - 86400000) continue;
      await query(`INSERT INTO live_replays (session_id, recording_id, provider, status, deleted_at, delete_reason) VALUES ($1, $2, $3, 'deleted', now(), 'session_not_held')
                   ON CONFLICT DO NOTHING`, [s.id, rec ? rec.id : 'none', p.name]);
    } catch (e) { console.error(`[live] deleting the recording of ${s.id} failed:`, e.message); }
  }
  const { rows: old } = await query(
    `SELECT r.session_id FROM live_replays r JOIN live_sessions s ON s.id = r.session_id WHERE r.status = 'ready' AND s.ended_at < now() - make_interval(days => $1) LIMIT 20`, [KEEP_DAYS]);
  for (const r of old) await remove(null, r.session_id, 'kept_90_days').catch((e) => console.error('[live] deleting an old replay failed:', e.message));
}

// ---- Who may watch ---------------------------------------------------------------------------------------------------------------------
async function replayOf(sessionId) {
  const { rows: [r] } = await query(`SELECT * FROM live_replays WHERE session_id = $1 AND status = 'ready'`, [sessionId]);
  return r || null;
}
// -> { can: true, until } | { can: false, canBuy, price }
async function accessFor(user, s) {
  const r = await replayOf(s.id);
  if (!r) return { can: false, ready: false };
  if (user && s.mentor_id === user.id) return { can: true, ready: true, mentor: true };
  if (user) {
    const until = new Date(new Date(s.ended_at).getTime() + TICKET_DAYS * 86400000);
    const { rows: [t] } = await query(`SELECT 1 FROM live_tickets WHERE session_id = $1 AND holder_id = $2 AND status = 'paid'`, [s.id, user.id]);
    if (t && until > new Date()) return { can: true, ready: true, until, via: 'ticket' };
    const { rows: [pp] } = await query(
      `SELECT access_until FROM live_replay_purchases WHERE session_id = $1 AND buyer_id = $2 AND status = 'paid' AND access_until > now() ORDER BY access_until DESC LIMIT 1`, [s.id, user.id]);
    if (pp) return { can: true, ready: true, until: pp.access_until, via: 'pass' };
  }
  const onSale = Date.now() < new Date(s.ended_at).getTime() + SALE_DAYS * 86400000;
  return { can: false, ready: true, canBuy: onSale, price: s.replay_price };
}

// A short-lived address for this viewer (the provider makes it; it is never stored).
async function playback(user, s) {
  const a = await accessFor(user, s);
  if (!a.can) return null;
  const r = await replayOf(s.id);
  return { ...(await video().forName(r.provider).playbackUrl(r.recording_id)), until: a.until || null };
}

// ---- Buying a pass --------------------------------------------------------------------------------------------------------------------
const purchaseView = (p) => p && ({ id: p.id, sessionId: p.session_id, status: p.status, price: p.price, paidAt: p.paid_at, accessUntil: p.access_until, refundedAt: p.refunded_at });

async function buy(user, sessionId) {
  if (!user || !user.emailVerified) throw new LiveError('email_not_verified');
  let bank;
  try { bank = pay.current(); } catch (e) { throw new LiveError('payments_closed'); }
  if (config.LAUNCH_MODE === 'prelaunch') throw new LiveError('payments_closed');
  const s = await sessions.rowById(sessionId);
  if (!s || s.status !== 'ended') throw new LiveError('not_found');
  const a = await accessFor(user, s);
  if (a.can) throw new LiveError('already_have_access');
  if (!a.ready || !a.canBuy) throw new LiveError('not_on_sale');
  let p;
  await tx(async (client) => {
    await client.query(`UPDATE live_replay_purchases SET status = 'expired' WHERE session_id = $1 AND buyer_id = $2 AND status = 'held' AND hold_until <= now() AND provider_order_id IS NULL`, [s.id, user.id]);
    const { rows: [open] } = await client.query(`SELECT * FROM live_replay_purchases WHERE session_id = $1 AND buyer_id = $2 AND status = 'held'`, [s.id, user.id]);
    if (open && new Date(open.hold_until).getTime() > Date.now()) throw new LiveError('payment_in_progress', { purchaseId: open.id });
    if (open) await client.query(`UPDATE live_replay_purchases SET status = 'expired' WHERE id = $1`, [open.id]);
    const fee = feeOf(s.replay_price);
    ({ rows: [p] } = await client.query(
      `INSERT INTO live_replay_purchases (session_id, buyer_id, price, fee, net, provider, hold_until) VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(mins => $7)) RETURNING *`,
      [s.id, user.id, s.replay_price, fee, s.replay_price - fee, bank.name, config.LIVE_HOLD_MINUTES]));
  });
  const back = `${config.PUBLIC_URL}${user.language === 'ka' ? '/ka' : ''}/live/${s.slug}/replay?purchase=${p.id}`;
  let order;
  try {
    order = await bank.createPayment({
      bookingId: p.id, amount: p.price, description: 'Wisecall replay', callbackUrl: `${config.PUBLIC_URL}/api/payments/callback`,
      successUrl: `${back}&status=success`, failUrl: `${back}&status=fail`, cancelUrl: `${back}&status=cancel`, returnUrl: `${back}&status=return`,
      ttlMinutes: Math.min(config.PAYMENT_TTL_MINUTES, config.LIVE_HOLD_MINUTES), language: user.language
    });
  } catch (e) {
    console.error('[live] could not start the bank payment for a replay:', e.message);
    await query(`UPDATE live_replay_purchases SET status = 'expired' WHERE id = $1 AND status = 'held'`, [p.id]);
    throw new LiveError('payment_failed_to_start');
  }
  await query('UPDATE live_replay_purchases SET provider_order_id = $2 WHERE id = $1', [p.id, order.orderId]);
  return { purchase: purchaseView(p), checkoutUrl: order.redirectUrl };
}

async function lock(client, id) {
  return (await client.query('SELECT * FROM live_replay_purchases WHERE id = $1 FOR UPDATE', [id])).rows[0] || null;
}

async function apply(client, p, status) {
  const after = [];
  const amountOk = status.amount === p.price && (!status.currency || status.currency === p.currency);
  const lapsed = p.status === 'held' && new Date(p.hold_until).getTime() <= Date.now();
  const markPaid = async () => {
    const { rows: [u] } = await client.query(
      `UPDATE live_replay_purchases SET status = 'paid', paid_at = now(), access_until = now() + make_interval(days => $2) WHERE id = $1 RETURNING *`, [p.id, PASS_DAYS]);
    const receipt = await receipts.issueReplay(u.id, 'payment', u.price, client);
    const { rows: [s] } = await client.query('SELECT mentor_id, title, slug FROM live_sessions WHERE id = $1', [u.session_id]);
    await require('../ledger').onReplayPaid(client, u, s.mentor_id);
    return { u, receipt, s };
  };
  if (p.status === 'held' && status.status === 'paid' && !lapsed) {
    if (!amountOk) { console.error(`[live] amount mismatch for replay pass ${p.id}. Not marking paid.`); return { p, after }; }
    const { u, receipt, s } = await markPaid();
    after.push(() => require('./notices').replayPaid(u, s, receipt));
    return { p: u, after };
  }
  if (p.status === 'held' && ['failed', 'expired'].includes(status.status)) {
    const { rows: [u] } = await client.query(`UPDATE live_replay_purchases SET status = 'expired' WHERE id = $1 RETURNING *`, [p.id]);
    return { p: u, after };
  }
  if ((p.status === 'expired' || lapsed) && status.status === 'paid' && amountOk) {
    const { rows: [r] } = await client.query(`SELECT 1 FROM live_replays WHERE session_id = $1 AND status = 'ready'`, [p.session_id]);
    const { u, receipt, s } = await markPaid();
    after.push(async () => {
      if (r) await require('./notices').replayPaid(u, s, receipt);
      else { await receipts.email(receipt); await refund(u.id, 'late_payment').catch((e) => console.error('[live] replay refund failed:', e.message)); }
    });
    return { p: u, after };
  }
  if (status.status === 'refunded' && ['paid', 'refund_pending'].includes(p.status)) {
    const { rows: [u] } = await client.query(
      `UPDATE live_replay_purchases SET status = 'refunded', refunded_at = now(), refund_error = NULL, refund_reason = COALESCE(refund_reason, 'refunded_at_bank'), access_until = now()
        WHERE id = $1 RETURNING *`, [p.id]);
    await require('../ledger').onReplayRefunded(client, u);
    const receipt = await receipts.issueReplay(u.id, 'refund', u.price, client);
    after.push(() => receipts.email(receipt));
    return { p: u, after };
  }
  return { p, after };
}

async function sync(purchaseId) {
  const { rows: [p0] } = await query('SELECT * FROM live_replay_purchases WHERE id = $1', [purchaseId]);
  if (!p0 || !p0.provider_order_id || !['held', 'paid', 'refund_pending', 'expired'].includes(p0.status)) return p0 || null;
  const status = await pay.forProvider(p0.provider).getPaymentStatus(p0.provider_order_id);
  let result = { p: p0, after: [] };
  await tx(async (client) => {
    const p = await lock(client, p0.id);
    if (p) result = await apply(client, p, status);
  });
  for (const fn of result.after) Promise.resolve().then(fn).catch((e) => console.error('[live] replay follow-up failed:', e.message));
  return result.p;
}

async function findByOrder(providerName, orderId) {
  const { rows } = await query('SELECT id FROM live_replay_purchases WHERE provider = $1 AND provider_order_id = $2', [providerName, orderId]);
  return rows[0] ? rows[0].id : null;
}

// A full refund (the replay was deleted while the pass ran, or a late payment). Idempotent; retried by the sweep.
async function refund(purchaseId, reason) {
  let claimed = null;
  let done = null;
  await tx(async (client) => {
    const p = await lock(client, purchaseId);
    if (!p) throw new LiveError('not_found');
    if (p.status === 'held') { await client.query(`UPDATE live_replay_purchases SET status = 'expired' WHERE id = $1`, [p.id]); done = { ...p, status: 'expired' }; return; }
    if (['refunded', 'expired'].includes(p.status) || (p.status === 'refund_pending' && !p.refund_error)) { done = p; return; }
    const { rows: [u] } = await client.query(
      `UPDATE live_replay_purchases SET status = 'refund_pending', refund_requested_at = COALESCE(refund_requested_at, now()), refund_reason = COALESCE(refund_reason, $2),
         refund_error = NULL WHERE id = $1 RETURNING *`, [p.id, reason]);
    claimed = u;
  });
  if (done) return done;
  try {
    const r = await pay.forProvider(claimed.provider).refund({ orderId: claimed.provider_order_id, amount: claimed.price, idempotencyKey: `live-replay-refund-${claimed.id}` });
    await query('UPDATE live_replay_purchases SET provider_refund_id = $2 WHERE id = $1', [claimed.id, r.refundId]);
  } catch (err) {
    console.error(`[live] the bank refused the replay refund ${claimed.id}:`, err.message);
    await query('UPDATE live_replay_purchases SET refund_error = $2 WHERE id = $1', [claimed.id, String(err.message).slice(0, 300)]);
    throw new LiveError('refund_failed');
  }
  try { return (await sync(claimed.id)) || claimed; } catch (e) { return claimed; }
}

async function expireHolds() {
  const { rows } = await query(`SELECT id FROM live_replay_purchases WHERE status = 'held' AND hold_until <= now() LIMIT 100`);
  for (const { id } of rows) {
    try {
      const p = await sync(id);
      if (p && p.status === 'held') await query(`UPDATE live_replay_purchases SET status = 'expired' WHERE id = $1 AND status = 'held'`, [id]);
    } catch (e) {
      await query(`UPDATE live_replay_purchases SET status = 'expired' WHERE id = $1 AND status = 'held' AND hold_until < now() - make_interval(mins => $2)`, [id, config.LIVE_HOLD_MINUTES]);
    }
  }
  const { rows: pending } = await query(`SELECT id, refund_error, refund_reason FROM live_replay_purchases WHERE status = 'refund_pending' AND (refund_error IS NOT NULL OR refund_requested_at < now() - interval '5 minutes') LIMIT 50`);
  for (const p of pending) {
    if (p.refund_error) await refund(p.id, p.refund_reason).catch(() => {});
    else await sync(p.id).catch(() => {});
  }
}

// ---- Deleting a replay (the mentor, an admin, or the 90-day rule): passes still running get their money back -------------------------
async function remove(by, sessionId, reason) {
  const s = await sessions.rowById(sessionId);
  if (!s) throw new LiveError('not_found');
  if (by && !by.isAdminAction && s.mentor_id !== by.id) throw new LiveError('not_found');
  const { rows: [r] } = await query(
    `UPDATE live_replays SET status = 'deleted', deleted_at = now(), deleted_by = $2, delete_reason = $3 WHERE session_id = $1 AND status = 'ready' RETURNING *`,
    [s.id, by ? by.id : null, String(reason || 'mentor').slice(0, 200)]);
  if (!r) throw new LiveError('not_found');
  await video().forName(r.provider).deleteRecording(r.recording_id).catch((e) => console.error('[live] the provider did not delete the recording (deleted on our side):', e.message));
  const { rows: passes } = await query(`SELECT id FROM live_replay_purchases WHERE session_id = $1 AND status = 'paid' AND access_until > now()`, [s.id]);
  for (const p of passes) await refund(p.id, 'replay_deleted').catch((e) => console.error(`[live] replay refund ${p.id} failed (the sweep retries):`, e.message));
  return { deleted: true, refunded: passes.length };
}

module.exports = { setRecording, isRecording, sweep, accessFor, playback, buy, sync, apply, findByOrder, refund, expireHolds, remove, purchaseView, replayOf,
  TICKET_DAYS, PASS_DAYS, SALE_DAYS, KEEP_DAYS };
