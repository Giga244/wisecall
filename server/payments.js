// Payment lifecycle. Money model: "hold, then release".
//   1. The buyer pays the platform through a Georgian bank (see server/pay/). The money sits in
//      Wisecall's bank account; nothing goes to the mentor yet.
//   2. A booking becomes "paid" only when the BANK says so: we ask the bank's API for the payment
//      status (after a signed callback, from the sweep job, or when the buyer returns to the site).
//      The browser redirect alone never marks anything paid.
//   3. When the mentor answers, the mentor's share is recorded in the payout ledger (server/ledger.js)
//      and paid out by hand by an admin.
//   4. If the mentor does not answer before the deadline, the buyer is refunded in full through the
//      bank's refund API. Refunds are asynchronous: "refund_pending" until the bank confirms.
const { tx, query } = require('./db');
const config = require('./config');
const pay = require('./pay');
const { bookingFromRow, getUserById, getBookingById, updateBooking } = require('./models');
const notify = require('./notify');
const ledger = require('./ledger');

class PaymentError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const deadlineFromNow = () => new Date(Date.now() + config.ANSWER_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

async function lockBooking(client, id) {
  const { rows } = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ? bookingFromRow(rows[0]) : null;
}

// Sends the buyer to the bank. Returns { orderId, redirectUrl }.
async function startPayment(booking, mentor, seeker) {
  const provider = pay.forProvider(booking.provider);
  const back = `${config.PUBLIC_URL}/u/${mentor.username}?booking=${booking.id}`;
  return provider.createPayment({
    bookingId: booking.id,
    amount: booking.amount,
    description: 'Wisecall',
    callbackUrl: `${config.PUBLIC_URL}/api/payments/callback`,
    successUrl: `${back}&status=success`,
    failUrl: `${back}&status=fail`,
    // Where a buyer who presses "cancel" is sent back to (the fake bank uses it; the real banks send a cancelled payment to failUrl).
    cancelUrl: `${back}&status=cancel`,
    returnUrl: `${back}&status=return`,
    ttlMinutes: config.PAYMENT_TTL_MINUTES,
    language: seeker.language
  });
}

async function expirePending(client, bookingId) {
  const { rows } = await client.query(
    `UPDATE bookings SET status = 'expired' WHERE id = $1 AND status = 'pending_payment' RETURNING id`, [bookingId]
  );
  return rows.length > 0;
}

// Applies what the bank reported to one (locked) booking. Runs inside a transaction and returns
// the follow-up work (emails) to run only after the transaction has committed.
// Every branch checks the current status first, so repeating it changes nothing.
async function applyBankStatus(client, booking, s) {
  const after = [];

  if (booking.status === 'pending_payment') {
    if (s.status === 'paid') {
      // Never trust a paid status for the wrong amount or currency.
      if (s.amount !== booking.amount || (s.currency && s.currency !== booking.currency)) {
        console.error(`[payments] amount mismatch for booking ${booking.id}: expected ${booking.amount} ${booking.currency}, bank says ${s.amount} ${s.currency}. Not marking paid.`);
        return { booking, after };
      }
      const updated = await updateBooking(booking.id, { status: 'paid', paidAt: new Date(), answerDeadline: deadlineFromNow() }, client);
      after.push(async () => {
        const mentor = await getUserById(updated.mentorId);
        if (mentor) notify.notifyMentorNewQuestion(mentor, updated);
      });
      return { booking: updated, after };
    }
    if (s.status === 'failed' || s.status === 'expired') {
      await expirePending(client, booking.id);
      return { booking: { ...booking, status: 'expired' }, after };
    }
    return { booking, after };
  }

  // A refund we asked for (or one made in the bank's own dashboard) has completed.
  if (s.status === 'refunded' && ['paid', 'answered', 'refund_pending'].includes(booking.status)) {
    const updated = await updateBooking(booking.id, {
      status: 'refunded', refundedAt: new Date(), refundReason: booking.refundReason || 'refunded_at_bank', refundError: null
    }, client);
    await ledger.onRefundRequested(client, updated);
    after.push(async () => {
      const [seeker, mentor] = await Promise.all([getUserById(updated.seekerId), getUserById(updated.mentorId)]);
      if (seeker && mentor) notify.notifyRefund(seeker, mentor, updated, updated.refundReason);
    });
    return { booking: updated, after };
  }
  return { booking, after };
}

// Asks the bank what really happened to this booking's payment and records it. This is the ONLY
// way a booking becomes paid. Safe to call any number of times, from any number of places.
async function syncBooking(bookingId) {
  const booking = await getBookingById(bookingId);
  if (!booking || !booking.providerOrderId) return booking;
  if (!['pending_payment', 'paid', 'answered', 'refund_pending'].includes(booking.status)) return booking;

  const status = await pay.forProvider(booking.provider).getPaymentStatus(booking.providerOrderId); // network call, outside the transaction
  let result = { booking, after: [] };
  await tx(async (client) => {
    const locked = await lockBooking(client, bookingId);
    if (locked) result = await applyBankStatus(client, locked, status);
  });
  for (const fn of result.after) fn().catch((e) => console.error('[payments] follow-up failed:', e.message));
  return result.booking;
}

// The bank called our callback URL. Authenticity is checked by the provider (a signature for BOG);
// either way the payment status is then read from the bank's API, never from the callback body.
async function handleCallback({ rawBody, headers }) {
  let provider;
  try { provider = pay.current(); } catch (e) { throw new PaymentError('invalid_callback', 'payments are not set up on this site'); } // (before launch there is no bank: nothing here is genuine)
  let orderId;
  try { ({ orderId } = provider.verifyCallback({ rawBody, headers })); } // throws if not genuine
  catch (e) { throw new PaymentError('invalid_callback', e.message); }
  const { rows } = await query('SELECT id FROM bookings WHERE provider = $1 AND provider_order_id = $2', [provider.name, orderId]);
  if (!rows[0]) return { known: false };
  await syncBooking(rows[0].id);
  return { known: true, bookingId: rows[0].id };
}

// Asks the bank to return a booking's money in full. Idempotent: calling it again for a booking
// already refunded (or with a refund in progress) does nothing new. If the bank rejects the
// request, the booking stays "refund_pending" with the error recorded and the sweep retries.
async function refundBooking(bookingId, reason) {
  let claimed = null;
  let alreadyDone = null;
  await tx(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw new PaymentError('not_found');
    if (booking.status === 'refunded') { alreadyDone = booking; return; }
    if (booking.status === 'refund_pending' && !booking.refundError) { alreadyDone = booking; return; }
    if (!['paid', 'answered', 'refund_pending'].includes(booking.status)) throw new PaymentError('not_refundable');
    try { pay.forProvider(booking.provider); } catch (e) { throw new PaymentError('provider_unavailable', e.message); }
    if (!booking.providerOrderId) throw new PaymentError('missing_order');

    claimed = await updateBooking(booking.id, {
      status: 'refund_pending',
      refundRequestedAt: booking.refundRequestedAt || new Date(),
      refundReason: booking.refundReason || reason,
      refundError: null
    }, client);
    await ledger.onRefundRequested(client, claimed);
  });
  if (alreadyDone) return alreadyDone;

  try {
    const r = await pay.forProvider(claimed.provider).refund({
      orderId: claimed.providerOrderId, amount: claimed.amount, idempotencyKey: `refund-${claimed.id}`
    });
    await updateBooking(claimed.id, { providerRefundId: r.refundId });
  } catch (err) {
    console.error(`[payments] bank refused or failed the refund for booking ${claimed.id}:`, err.message);
    await updateBooking(claimed.id, { refundError: String(err.message).slice(0, 300) });
    throw new PaymentError('refund_failed', err.message);
  }
  // Some banks confirm at once, so look straight away instead of waiting for the sweep.
  try { return (await syncBooking(claimed.id)) || claimed; } catch (e) { return claimed; }
}

// A partial refund (an admin settling a dispute): `amount` tetri goes back to the asker and the booking stays answered. The mentor's
// part is in proportion to their share of the price (server/ledger.js onPartialRefund). The request is claimed first
// (partial_refund_started_at), so two admins cannot send it twice; the ledger changes only after the bank accepted it.
// Returns the booking. Throws PaymentError.
async function partialRefund(bookingId, amount, reason) {
  let claimed = null;
  await tx(async (client) => {
    const b = await lockBooking(client, bookingId);
    if (!b) throw new PaymentError('not_found');
    if (b.status !== 'answered') throw new PaymentError('not_refundable');
    if (b.refundedAmount || b.partialRefundStartedAt) throw new PaymentError('already_partly_refunded');
    if (!Number.isInteger(amount) || amount < 1 || amount >= b.amount) throw new PaymentError('invalid_amount');
    try { pay.forProvider(b.provider); } catch (e) { throw new PaymentError('provider_unavailable', e.message); }
    if (!b.providerOrderId) throw new PaymentError('missing_order');
    await client.query('UPDATE bookings SET partial_refund_started_at = now() WHERE id = $1', [b.id]);
    claimed = b;
  });
  try {
    await pay.forProvider(claimed.provider).refund({ orderId: claimed.providerOrderId, amount, partial: true, idempotencyKey: `partial-refund-${claimed.id}` });
  } catch (err) {
    await query('UPDATE bookings SET partial_refund_started_at = NULL WHERE id = $1', [claimed.id]); // (nothing was returned: it can be tried again)
    console.error(`[payments] the bank refused the partial refund for booking ${claimed.id}:`, err.message);
    throw new PaymentError('refund_failed', err.message);
  }
  let updated;
  await tx(async (client) => {
    const b = await lockBooking(client, claimed.id);
    updated = await updateBooking(b.id, { refundedAmount: amount, refundReason: reason }, client);
    await ledger.onPartialRefund(client, b, amount);
  });
  return updated;
}

module.exports = {
  PaymentError, partialRefund, deadlineFromNow, startPayment, syncBooking, handleCallback, refundBooking, expirePending, applyBankStatus
};
