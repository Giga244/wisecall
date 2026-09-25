const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const config = require('../config');
const payments = require('../payments');
const pay = require('../pay');
const ledger = require('../ledger');
const notify = require('../notify');
const probation = require('../probation');
const launch = require('../launch');
const ratings = require('../ratings');
const { isListable, asyncHandler, photoUrl } = require('../util');
const content = require('../content');
const { bookingFromRow, getUserById, getBookingById, updateBooking, claimAnswer } = require('../models');

const router = express.Router();

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  // Before launch nobody can pay: refuse before anything is created or the bank is contacted.
  await launch.refresh(); // the mode can depend on the number of listed mentors, so it is read fresh
  if (config.LAUNCH_MODE === 'prelaunch') return res.status(403).json({ error: 'prelaunch', message: 'Wisecall has not opened to buyers yet. Join the waiting list and we will tell you the day it does.' });
  const { mentorId, question } = req.body || {};
  if (typeof mentorId !== 'string' || typeof question !== 'string') return res.status(400).json({ error: 'missing_fields' });
  const checked = content.checkQuestion(question); // at least 50 characters (server/content.js)
  if (checked.error) return res.status(400).json({ error: checked.error, ...(checked.min ? { min: checked.min } : {}), ...(checked.max ? { max: checked.max } : {}) });

  const mentor = await getUserById(mentorId);
  const seeker = await getUserById(req.userToken.id);
  if (!seeker) return res.status(401).json({ error: 'not_authenticated' });
  if (!isListable(mentor)) return res.status(404).json({ error: 'mentor_not_found' });
  if (mentor.id === seeker.id) return res.status(400).json({ error: 'cannot_book_self' });

  const amount = Math.round(mentor.price * 100);
  const feeAmount = Math.round(amount * (config.PLATFORM_FEE_PERCENT / 100));
  const cleanQuestion = checked.text;

  let providerName;
  try { providerName = pay.current().name; } catch (e) { return res.status(503).json({ error: 'payments_unavailable' }); }

  const { rows } = await query(
    `INSERT INTO bookings (seeker_id, mentor_id, question, amount, currency, platform_fee_percent,
                           platform_fee_amount, mentor_net_amount, status, provider)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_payment', $9) RETURNING *`,
    [seeker.id, mentor.id, cleanQuestion, amount, config.CURRENCY, config.PLATFORM_FEE_PERCENT,
      feeAmount, amount - feeAmount, providerName]
  );
  const booking = bookingFromRow(rows[0]);

  try {
    const order = await payments.startPayment(booking, mentor, seeker);
    const updated = await updateBooking(booking.id, { providerOrderId: order.orderId });
    res.status(201).json({ booking: updated, checkoutUrl: order.redirectUrl });
  } catch (err) {
    console.error('[payments] could not start the bank payment:', err.message);
    await updateBooking(booking.id, { status: 'expired' });
    res.status(502).json({ error: 'payment_error', message: 'Could not start the payment. Please try again.' });
  }
}));
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const list = async (mine, other) => {
    const { rows } = await query(
      `SELECT b.*, u.name AS other_name, u.color AS other_color, u.username AS other_username, u.photo_updated_at AS other_photo_at
         FROM bookings b JOIN users u ON u.id = b.${other}_id
        WHERE b.${mine}_id = $1 ORDER BY b.created_at DESC LIMIT 200`,
      [req.userToken.id]
    );
    return rows.map((r) => ({
      ...bookingFromRow(r), otherPartyName: r.other_name, otherPartyColor: r.other_color, otherPartyUsername: r.other_username,
      otherPartyPhotoUrl: photoUrl({ id: r[`${other}_id`], photoUpdatedAt: r.other_photo_at })
    }));
  };
  const me = req.userToken.id;
  // A buyer never sees an answer that is still being checked (see server/probation.js).
  const asked = await ratings.attach((await list('seeker', 'mentor')).map((b) => probation.forViewer(b, me)), me, 'asker');
  const received = await ratings.attach((await list('mentor', 'seeker')).map((b) => ({ ...b, answerHeld: b.answerReview === 'held' })), me, 'mentor');
  res.json({ asked, received });
}));

router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const booking = await getBookingById(req.params.id);
  if (!booking) return res.status(404).json({ error: 'not_found' });
  if (booking.seekerId !== req.userToken.id && booking.mentorId !== req.userToken.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json({ booking: probation.forViewer(booking, req.userToken.id) });
}));

// The buyer came back from the bank (or is waiting on the page). We do not believe the redirect:
// this asks the BANK about the payment and records what it says. Throttled per booking.
const lastSync = new Map();
router.post('/:id/sync', requireAuth, asyncHandler(async (req, res) => {
  const existing = await getBookingById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.seekerId !== req.userToken.id) return res.status(403).json({ error: 'forbidden' });

  const last = lastSync.get(existing.id) || 0;
  let booking = existing;
  if (Date.now() - last > 2000) {
    lastSync.set(existing.id, Date.now());
    if (lastSync.size > 5000) lastSync.clear();
    try { booking = (await payments.syncBooking(existing.id)) || existing; }
    catch (err) { console.error('[payments] status check failed:', err.message); }
  }
  res.json({ booking: probation.forViewer(booking, req.userToken.id) });
}));
// A mentor answers ONCE. There is no way to change an answer afterwards, held for a check or not: a second request gets 409
// "already_answered" and the first answer stays exactly as it was (a wrong answer is dealt with by an admin: reject it, and the buyer is
// refunded). The answer must be a real one (server/content.js: at least 150 characters, not the same few characters over and over).
router.post('/:id/answer', requireAuth, asyncHandler(async (req, res) => {
  const existing = await getBookingById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (existing.mentorId !== req.userToken.id) return res.status(400).json({ error: 'forbidden' });
  // A suspended mentor cannot answer (their open questions were refunded).
  const mentorNow = await getUserById(existing.mentorId);
  if (!mentorNow || mentorNow.verificationStatus === 'suspended') return res.status(403).json({ error: 'suspended' });
  if (existing.status === 'answered' || existing.answeredAt) return res.status(409).json({ error: 'already_answered' });
  if (existing.status !== 'paid') return res.status(400).json({ error: 'not_paid' });

  const checked = content.checkAnswer((req.body || {}).answer);
  if (checked.error) return res.status(400).json({ error: checked.error, ...(checked.min ? { min: checked.min } : {}), ...(checked.max ? { max: checked.max } : {}) });

  // One of a new mentor's first answers? Then it waits for an admin before the buyer sees it.
  const held = await probation.shouldHold(existing.mentorId);
  const booking = await claimAnswer(existing.id, checked.text, held ? probation.holdPatch() : null);
  if (!booking) { // somebody (the same mentor, twice) answered a moment before, or the question was refunded meanwhile
    const now = await getBookingById(existing.id);
    return res.status(now && (now.status === 'answered' || now.answeredAt) ? 409 : 400).json({ error: now && (now.status === 'answered' || now.answeredAt) ? 'already_answered' : 'not_paid' });
  }

  if (!held) {
    // Record the mentor's earnings in the payout ledger.
    await ledger.onAnswered(booking);
    const [seeker, mentor] = await Promise.all([getUserById(booking.seekerId), getUserById(booking.mentorId)]);
    if (seeker && mentor) notify.notifySeekerAnswered(seeker, mentor, booking);
  }
  res.json({ booking: probation.forViewer(booking, req.userToken.id) });
}));

module.exports = router;
