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
const receipts = require('./receipts');
const { isListable } = require('./util');

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
      const receipt = await receipts.issue(updated.id, 'payment', updated.amount, client);
      after.push(async () => {
        const mentor = await getUserById(updated.mentorId);
        if (mentor) notify.notifyMentorNewQuestion(mentor, updated);
        await receipts.email(receipt);
        require('./analytics').event('question_paid', null, { field: mentor ? String(mentor.niche || '') : '' });
      });
      return { booking: updated, after };
    }
    if (s.status === 'failed' || s.status === 'expired') {
      await expirePending(client, booking.id);
      return { booking: { ...booking, status: 'expired' }, after };
    }
    return { booking, after };
  }

  // The bank took the money after we had closed the attempt (a slow 3-D Secure, a buyer who came back late; docs/AUDIT.md #4). The money
  // is never lost: the question is opened again as paid when the mentor can still be asked, otherwise it is refunded at once. Admins are
  // told either way.
  if (booking.status === 'expired' && s.status === 'paid') {
    if (s.amount !== booking.amount || (s.currency && s.currency !== booking.currency)) {
      console.error(`[payments] late payment with the wrong amount for booking ${booking.id}: expected ${booking.amount}, bank says ${s.amount}. Not recorded.`);
      after.push(async () => notify.notifyAdmins('A late bank payment did not match its question', `<p>Booking ${booking.id}: the bank reports a payment of ${s.amount} tetri for a question of ${booking.amount}. Check it in the bank's merchant portal.</p>`));
      return { booking, after };
    }
    const mentor = await getUserById(booking.mentorId);
    const askable = isListable(mentor);
    const updated = await updateBooking(booking.id, { status: 'paid', paidAt: new Date(), answerDeadline: deadlineFromNow() }, client);
    const receipt = await receipts.issue(updated.id, 'payment', updated.amount, client);
    after.push(async () => {
      await receipts.email(receipt);
      if (askable) notify.notifyMentorNewQuestion(mentor, updated);
      else await refundBooking(updated.id, 'late_payment').catch((e) => console.error(`[payments] refund of late payment ${updated.id} failed:`, e.message));
      notify.notifyAdmins('A late bank payment was recorded', `<p>Booking ${updated.id} was closed before the bank confirmed its payment. It is now ${askable ? 'paid and sent to the mentor' : 'being refunded (the mentor can no longer be asked)'}.</p>`);
    });
    return { booking: updated, after };
  }

  // A refund we asked for (or one made in the bank's own dashboard) has completed.
  if (s.status === 'refunded' && ['paid', 'answered', 'refund_pending'].includes(booking.status)) {
    const updated = await updateBooking(booking.id, {
      status: 'refunded', refundedAt: new Date(), refundReason: booking.refundReason || 'refunded_at_bank', refundError: null
    }, client);
    await ledger.onRefundRequested(client, updated);
    // (what is left to return after an earlier partial refund)
    const receipt = await receipts.issue(updated.id, 'refund', updated.amount - (updated.refundedAmount || 0), client);
    after.push(async () => {
      const [seeker, mentor] = await Promise.all([getUserById(updated.seekerId), getUserById(updated.mentorId)]);
      if (seeker && mentor) notify.notifyRefund(seeker, mentor, updated, updated.refundReason);
      await receipts.email(receipt);
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
  // ("expired" too: the bank can still complete a payment we stopped waiting for, docs/AUDIT.md #4)
  if (!['pending_payment', 'paid', 'answered', 'refund_pending', 'expired'].includes(booking.status)) return booking;

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
async function handleCallback({ rawBody, headers, ip }) {
  let provider;
  try { provider = pay.current(); } catch (e) { throw new PaymentError('invalid_callback', 'payments are not set up on this site'); } // (before launch there is no bank: nothing here is genuine)
  let orderId;
  try { ({ orderId } = provider.verifyCallback({ rawBody, headers, ip })); } // throws if not genuine
  catch (e) { throw new PaymentError('invalid_callback', e.message); }
  const { rows } = await query('SELECT id FROM bookings WHERE provider = $1 AND provider_order_id = $2', [provider.name, orderId]);
  if (!rows[0]) {
    // (or a ticket for a live session: the same bank, the same rule, server/live/tickets.js)
    const tickets = require('./live/tickets');
    const ticketId = await tickets.findByOrder(provider.name, orderId);
    if (ticketId) {
      await tickets.sync(ticketId);
      return { known: true, ticketId };
    }
    // (a whole series in one payment, or a pass to watch a replay)
    const series = require('./live/series');
    const seriesOrderId = await series.findByOrder(provider.name, orderId);
    if (seriesOrderId) {
      await series.syncOrder(seriesOrderId);
      return { known: true, seriesOrderId };
    }
    const replays = require('./live/replays');
    const purchaseId = await replays.findByOrder(provider.name, orderId);
    if (!purchaseId) return { known: false };
    await replays.sync(purchaseId);
    return { known: true, purchaseId };
  }
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
    if (booking.partialRefundAmount) throw new PaymentError('refund_unconfirmed'); // (a partial refund's answer from the bank is not known yet)
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
    // After a partial refund (a dispute) only what is left goes back, as a partial return of that much (docs/REVIEW-2.md #2).
    const left = claimed.amount - (claimed.refundedAmount || 0);
    const r = await pay.forProvider(claimed.provider).refund({
      orderId: claimed.providerOrderId, amount: left, partial: left < claimed.amount, idempotencyKey: `refund-${claimed.id}`
    });
    await updateBooking(claimed.id, { providerRefundId: r.refundId });
  } catch (err) {
    console.error(`[payments] bank refused or failed the refund for booking ${claimed.id}:`, err.message);
    await updateBooking(claimed.id, { refundError: String(err.message).slice(0, 300) });
    // The request may have reached the bank and only the answer was lost (a timeout): ask the bank before calling it a failure.
    const now = await syncBooking(claimed.id).catch(() => null);
    if (now && now.status === 'refunded') return now;
    throw new PaymentError('refund_failed', err.message);
  }
  // Some banks confirm at once, so look straight away instead of waiting for the sweep.
  try { return (await syncBooking(claimed.id)) || claimed; } catch (e) { return claimed; }
}

// A partial refund (an admin settling a dispute): `amount` tetri goes back to the asker and the booking stays answered. The mentor's
// part is in proportion to their share of the price (server/ledger.js onPartialRefund). The request is claimed first
// (partial_refund_started_at, and the amount in partial_refund_amount), so two admins cannot send it twice; the ledger changes only after
// the bank accepted it. When the bank's answer is lost, the bank is asked what it returned before anything else (docs/REVIEW-2.md #3):
// the refund is recorded if the money went back; the claim is released if nothing went back and asking again is safe (the bank refused
// outright, or it dedupes a repeated request); otherwise it stays "sent, answer unknown" (refund_unconfirmed) and the sweep checks again
// (settleUnconfirmedRefunds). Nothing is ever sent to the bank twice without that check. Returns the booking. Throws PaymentError.
async function partialRefund(bookingId, amount, reason) {
  let claimed = null;
  await tx(async (client) => {
    const b = await lockBooking(client, bookingId);
    if (!b) throw new PaymentError('not_found');
    if (b.status !== 'answered') throw new PaymentError('not_refundable');
    if (b.partialRefundAmount) throw new PaymentError('refund_unconfirmed');
    if (b.refundedAmount || b.partialRefundStartedAt) throw new PaymentError('already_partly_refunded');
    if (!Number.isInteger(amount) || amount < 1 || amount >= b.amount) throw new PaymentError('invalid_amount');
    try { pay.forProvider(b.provider); } catch (e) { throw new PaymentError('provider_unavailable', e.message); }
    if (!b.providerOrderId) throw new PaymentError('missing_order');
    await client.query('UPDATE bookings SET partial_refund_started_at = now(), partial_refund_amount = $2 WHERE id = $1', [b.id, amount]);
    claimed = b;
  });
  const bank = pay.forProvider(claimed.provider);
  try {
    await bank.refund({ orderId: claimed.providerOrderId, amount, partial: true, idempotencyKey: `partial-refund-${claimed.id}` });
  } catch (err) {
    console.error(`[payments] the partial refund for booking ${claimed.id} failed, or its answer was lost:`, err.message);
    const seen = await partialRefundAtBank(claimed, amount);
    if (seen === 'returned') return recordPartialRefund(claimed.id, amount, reason);
    if (seen === 'not_returned' && (refusedByBank(err) || bank.idempotentRefunds)) {
      await query('UPDATE bookings SET partial_refund_started_at = NULL, partial_refund_amount = NULL WHERE id = $1', [claimed.id]); // (nothing went back: it can be tried again)
      throw new PaymentError('refund_failed', err.message);
    }
    throw new PaymentError('refund_unconfirmed', err.message);
  }
  return recordPartialRefund(claimed.id, amount, reason);
}

// The bank said no (a 4xx answer other than "too many" or "timeout"), or a bank without HTTP said so: nothing was returned, for certain.
const refusedByBank = (err) => Boolean(err && err.status >= 400 && err.status < 500 && ![408, 429].includes(err.status));

// What the bank shows for a partial refund of `amount` on top of what this booking had already returned: 'returned', 'not_returned' or
// 'unknown' (the bank cannot be reached, or says something in between).
async function partialRefundAtBank(b, amount) {
  let s;
  try { s = await pay.forProvider(b.provider).getPaymentStatus(b.providerOrderId); } catch (e) { return 'unknown'; }
  const before = b.refundedAmount || 0;
  if (typeof s.returned === 'number') {
    if (s.returned >= before + amount) return 'returned';
    return s.returned <= before && s.status === 'paid' ? 'not_returned' : 'unknown';
  }
  if (s.status === 'refunded_partially' || s.status === 'refunded') return before ? 'unknown' : 'returned';
  return s.status === 'paid' ? 'not_returned' : 'unknown';
}

// A full refund the bank has not confirmed yet: may it be sent again? With a bank that dedupes refunds (idempotentRefunds), yes. With one
// that does not (TBC), only when the bank shows the payment still paid with nothing more returned: while it says the refund is in progress,
// or cannot be reached, asking again could return the money twice (docs/security-audit M2).
async function safeToResendRefund(b) {
  let bank;
  try { bank = pay.forProvider(b.provider); } catch (e) { return false; }
  if (bank.idempotentRefunds) return true;
  return (await partialRefundAtBank(b, b.amount - (b.refundedAmount || 0))) === 'not_returned';
}

// The bank returned a partial refund: the booking, the ledger and a refund receipt (once).
async function recordPartialRefund(bookingId, amount, reason) {
  let updated;
  let receipt = null;
  await tx(async (client) => {
    const b = await lockBooking(client, bookingId);
    if (b.refundedAmount) { updated = b; return; } // (already recorded)
    updated = await updateBooking(b.id, { refundedAmount: amount, refundReason: reason }, client);
    await client.query('UPDATE bookings SET partial_refund_amount = NULL WHERE id = $1', [b.id]);
    await ledger.onPartialRefund(client, b, amount);
    receipt = await receipts.issue(b.id, 'refund', amount, client);
  });
  if (receipt) receipts.email(receipt).catch((e) => console.error('[payments] receipt email failed:', e.message));
  return updated;
}

// The sweep: partial refunds whose answer from the bank was lost. Recorded as soon as the bank shows the money went back (the dispute's
// decision is then announced); released after 15 minutes if the bank still shows nothing returned (the dispute opens again for the admin).
async function settleUnconfirmedRefunds() {
  const { rows } = await query(`SELECT id FROM bookings WHERE partial_refund_amount IS NOT NULL AND partial_refund_started_at < now() - interval '1 minute'
    ORDER BY partial_refund_started_at LIMIT 50`);
  let n = 0;
  for (const { id } of rows) {
    try {
      const b = await getBookingById(id);
      const seen = await partialRefundAtBank(b, b.partialRefundAmount);
      if (seen === 'returned') {
        await recordPartialRefund(b.id, b.partialRefundAmount, 'dispute');
        await require('./disputes').refundConfirmed(b.id);
        n += 1;
      } else if (seen === 'not_returned' && Date.now() - new Date(b.partialRefundStartedAt).getTime() > 15 * 60000) {
        const { rowCount } = await query('UPDATE bookings SET partial_refund_started_at = NULL, partial_refund_amount = NULL WHERE id = $1 AND partial_refund_amount IS NOT NULL', [b.id]);
        if (rowCount) await require('./disputes').refundNotMade(b.id);
        n += 1;
      }
    } catch (e) { console.error(`[payments] could not settle the partial refund of booking ${id}:`, e.message); }
  }
  return n;
}

module.exports = {
  PaymentError, partialRefund, settleUnconfirmedRefunds, safeToResendRefund, deadlineFromNow, startPayment, syncBooking, handleCallback, refundBooking, expirePending, applyBankStatus
};
