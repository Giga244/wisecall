// Payment lifecycle. Money model: "hold, then release".
//   1. The buyer pays the platform through Stripe Checkout (nothing goes to the mentor yet).
//   2. Only a signature-verified Stripe webhook (or our own server-side lookup of the Checkout
//      Session) can mark a booking paid; the browser redirect never does.
//   3. When the mentor answers, their share is transferred to their connected account and the
//      platform keeps its fee.
//   4. If the mentor does not answer before the deadline, the buyer is refunded in full.
const { tx, query } = require('./db');
const config = require('./config');
const stripe = require('./stripeClient');
const { bookingFromRow, getUserById, getBookingById, updateBooking } = require('./models');
const notify = require('./notify');

class PaymentError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

// A connected account can be paid when Stripe says payouts are enabled and transfers are active.
const accountIsReady = (account) => Boolean(account.payouts_enabled && (!account.capabilities || account.capabilities.transfers === 'active'));

const deadlineFromNow = () => new Date(Date.now() + config.ANSWER_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

async function lockBooking(client, id) {
  const { rows } = await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ? bookingFromRow(rows[0]) : null;
}

async function createCheckoutSession(booking, mentor, seeker) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: seeker.email,
    client_reference_id: booking.id,
    line_items: [{
      price_data: {
        currency: booking.currency,
        product_data: { name: `Advice from ${mentor.name}`, description: booking.question.slice(0, 300) },
        unit_amount: booking.amount
      },
      quantity: 1
    }],
    payment_intent_data: { transfer_group: `booking_${booking.id}`, metadata: { bookingId: booking.id } },
    metadata: { bookingId: booking.id },
    // Stripe's minimum lifetime is 30 minutes; unpaid bookings are closed when it lapses.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    success_url: `${config.APP_URL}/expert.html?id=${mentor.id}&booking=${booking.id}&status=success`,
    cancel_url: `${config.APP_URL}/expert.html?id=${mentor.id}&booking=${booking.id}&status=cancelled`
  }, { idempotencyKey: `checkout-${booking.id}` });
}

// Marks a booking paid from a Checkout Session object that came from Stripe (webhook payload
// or a direct API lookup). Safe to call repeatedly. Returns the booking only when it changed.
async function markPaidFromSession(client, session) {
  const bookingId = (session.metadata && session.metadata.bookingId) || session.client_reference_id;
  if (!bookingId || session.payment_status !== 'paid') return null;
  const booking = await lockBooking(client, bookingId);
  if (!booking || booking.status !== 'pending_payment') return null;

  if (session.amount_total !== booking.amount || String(session.currency).toLowerCase() !== booking.currency) {
    console.error(`[payments] amount mismatch for booking ${booking.id}: expected ${booking.amount} ${booking.currency}, got ${session.amount_total} ${session.currency}. Not marking paid.`);
    return null;
  }
  return updateBooking(booking.id, {
    status: 'paid',
    paidAt: new Date(),
    answerDeadline: deadlineFromNow(),
    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) || null
  }, client);
}

async function expirePending(client, bookingId) {
  const { rows } = await client.query(
    `UPDATE bookings SET status = 'expired' WHERE id = $1 AND status = 'pending_payment' RETURNING id`, [bookingId]
  );
  return rows.length > 0;
}

// Refunds a paid/answered booking in full. If the mentor was already paid, that transfer is
// reversed first. Idempotency keys make every step safe to retry.
async function refundBooking(bookingId, reason) {
  let refunded = null;
  let already = false;
  await tx(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking) throw new PaymentError('not_found');
    if (booking.status === 'refunded') { refunded = booking; already = true; return; }
    if (booking.status !== 'paid' && booking.status !== 'answered') throw new PaymentError('not_refundable');

    let stripeRefundId = null;
    if (booking.mode === 'stripe') {
      if (!booking.stripePaymentIntentId) throw new PaymentError('missing_payment_intent');
      if (booking.stripeTransferId) {
        await stripe.transfers.createReversal(
          booking.stripeTransferId,
          { amount: booking.mentorNetAmount, metadata: { bookingId: booking.id } },
          { idempotencyKey: `reverse-${booking.id}` }
        );
      }
      const refund = await stripe.refunds.create(
        { payment_intent: booking.stripePaymentIntentId, reason: 'requested_by_customer', metadata: { bookingId: booking.id } },
        { idempotencyKey: `refund-${booking.id}` }
      );
      stripeRefundId = refund.id;
    }
    refunded = await updateBooking(booking.id, {
      status: 'refunded', refundedAt: new Date(), refundReason: reason, stripeRefundId
    }, client);
  });

  if (!already) {
    const [seeker, mentor] = await Promise.all([getUserById(refunded.seekerId), getUserById(refunded.mentorId)]);
    if (seeker && mentor) notify.notifyRefund(seeker, mentor, refunded, reason);
  }
  return refunded;
}

// Pays the mentor's share once the question is answered. Failures are recorded on the booking
// and retried by the background job, so an answer is never lost because a payout hiccuped.
async function transferToMentor(bookingId) {
  return tx(async (client) => {
    const booking = await lockBooking(client, bookingId);
    if (!booking || booking.mode !== 'stripe' || booking.status !== 'answered' || booking.stripeTransferId) return booking;

    const mentor = await getUserById(booking.mentorId, client);
    if (!mentor || !mentor.stripeAccountId || !mentor.payoutsEnabled) {
      return updateBooking(booking.id, { transferError: 'mentor_payouts_not_ready' }, client);
    }
    try {
      const intent = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
      const transfer = await stripe.transfers.create({
        amount: booking.mentorNetAmount,
        currency: booking.currency,
        destination: mentor.stripeAccountId,
        source_transaction: intent.latest_charge,
        transfer_group: `booking_${booking.id}`,
        metadata: { bookingId: booking.id }
      }, { idempotencyKey: `transfer-${booking.id}` });
      return updateBooking(booking.id, { stripeTransferId: transfer.id, transferredAt: new Date(), transferError: null }, client);
    } catch (err) {
      console.error(`[payments] transfer for booking ${booking.id} failed (will retry):`, err.message);
      return updateBooking(booking.id, { transferError: String(err.message).slice(0, 300) }, client);
    }
  });
}

// Applies one verified Stripe event. Runs inside the webhook transaction; returns callbacks
// (emails) to run only after that transaction has committed.
async function applyStripeEvent(client, event) {
  const after = [];
  const obj = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const booking = await markPaidFromSession(client, obj);
      if (booking) after.push(async () => {
        const mentor = await getUserById(booking.mentorId);
        if (mentor) notify.notifyMentorNewQuestion(mentor, booking);
      });
      break;
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const id = (obj.metadata && obj.metadata.bookingId) || obj.client_reference_id;
      if (id) await expirePending(client, id);
      break;
    }
    case 'charge.refunded': {
      // A refund made directly in the Stripe dashboard: keep our records in step.
      if (obj.refunded && obj.payment_intent) {
        const { rows } = await client.query(
          `UPDATE bookings SET status = 'refunded', refunded_at = now(), refund_reason = COALESCE(refund_reason, 'refunded_in_stripe')
            WHERE stripe_payment_intent_id = $1 AND status IN ('paid', 'answered') RETURNING *`, [obj.payment_intent]
        );
        if (rows[0]) {
          const booking = bookingFromRow(rows[0]);
          if (booking.stripeTransferId) console.error(`[payments] booking ${booking.id} was refunded in Stripe but its mentor transfer was NOT reversed. Reverse it manually.`);
          after.push(async () => {
            const [seeker, mentor] = await Promise.all([getUserById(booking.seekerId), getUserById(booking.mentorId)]);
            if (seeker && mentor) notify.notifyRefund(seeker, mentor, booking, 'refunded_in_stripe');
          });
        }
      }
      break;
    }
    case 'account.updated': {
      const ready = accountIsReady(obj);
      await client.query('UPDATE users SET payouts_enabled = $2 WHERE stripe_account_id = $1', [obj.id, ready]);
      break;
    }
    case 'charge.dispute.created':
      console.error(`[payments] DISPUTE opened on charge ${obj.charge} (${obj.amount} ${obj.currency}). Respond in the Stripe dashboard.`);
      after.push(() => notify.notifyAdmins('A payment was disputed on Wisecall', `<p>A card dispute was opened on charge ${obj.charge}. Respond in the Stripe dashboard before the deadline.</p>`));
      break;
    default:
      break;
  }
  return after;
}

// Safety net for a missed webhook: asks Stripe directly (never trusts the browser) about
// bookings that are still unpaid after the checkout window.
async function reconcilePendingBooking(booking) {
  if (!stripe || !booking.stripeSessionId) {
    await tx((client) => expirePending(client, booking.id));
    return;
  }
  const session = await stripe.checkout.sessions.retrieve(booking.stripeSessionId);
  let paid = null;
  await tx(async (client) => {
    if (session.payment_status === 'paid') paid = await markPaidFromSession(client, session);
    else if (session.status === 'expired' || session.status === 'complete') await expirePending(client, booking.id);
  });
  if (paid) {
    const mentor = await getUserById(paid.mentorId);
    if (mentor) notify.notifyMentorNewQuestion(mentor, paid);
  }
}

module.exports = {
  PaymentError, accountIsReady, deadlineFromNow, createCheckoutSession, refundBooking, transferToMentor,
  applyStripeEvent, reconcilePendingBooking, expirePending, markPaidFromSession
};
