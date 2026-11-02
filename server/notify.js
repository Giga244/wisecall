// Emails about bookings and mentor applications. Each goes out in the recipient's own language
// (users.language). Failures are logged and never break the action that triggered them.
const config = require('./config');
const { sendTemplate } = require('./mail');

const money = (b) => `${(b.amount / 100).toFixed(2)} ${String(b.currency).toUpperCase()}`;

// The Inbox (server/inbox.js) records the same events for the notification centre and the conversations, whether or not email is
// set up. It is loaded lazily (it needs this module too).
const inbox = () => require('./inbox');

// `category`: an optional email (see inbox.OPTIONAL_EMAILS) is skipped when the person turned it off, and carries an unsubscribe link.
async function safeSend(label, name, user, data, { category } = {}) {
  if (!config.EMAIL_ENABLED || !user) return;
  try {
    if (category) {
      if (!(await inbox().emailAllowed(user.id, category))) return;
      data = { ...data, unsubscribeUrl: inbox().unsubscribeUrl(user.id, category) };
    }
    await sendTemplate(name, { to: user.email, lang: user.language, data });
  } catch (e) {
    console.error(`[email] ${label} failed:`, e.message);
  }
}

const notifyMentorNewQuestion = (mentor, booking) => Promise.all([
  inbox().onPaid(booking),
  booking.amount === 0 // (a free question: docs/CLAUDE-CODE-FREE-ANSWERS.md)
    ? safeSend('new-question notify', 'newFreeQuestion', mentor, { question: booking.question })
    : safeSend('new-question notify', 'newQuestion', mentor, { amount: money(booking), question: booking.question })
]);

const notifySeekerAnswered = (seeker, mentor, booking) => Promise.all([
  inbox().onAnswered(booking),
  safeSend('answer notify', 'answered', seeker, { mentor: mentor.name, answer: booking.answer })
]);

const notifyRefund = (seeker, mentor, booking, reason) => Promise.all([
  inbox().onRefunded(booking, reason),
  // (a free question is closed, not refunded: nothing was paid)
  safeSend('refund notify (seeker)', booking.amount === 0 ? 'freeClosedSeeker' : 'refundSeeker', seeker, { amount: money(booking), mentor: mentor.name, reason }),
  safeSend('refund notify (mentor)', booking.amount === 0 ? 'freeClosedMentor' : 'refundMentor', mentor, { question: booking.question, reason })
]);

// The one free follow-up question (to the mentor) and its reply (to the asker). data: { kind, from, body, threadId }
const notifyFollowUp = (to, data) =>
  safeSend('follow-up notify', data.kind === 'follow_up_question' ? 'followUpQuestion' : 'followUpReply', to, { name: data.from, body: data.body, threadId: data.threadId });

// The mentor has not replied to the follow-up question after 2 days (server/inbox.js followUpSweep): always sent (it is part of the order).
const notifyFollowUpReminder = (mentor, { from, dueAt, threadId }) =>
  safeSend('follow-up reminder', 'followUpReminder', mentor, { name: from || '', when: utcDate(dueAt, mentor.language), threadId });

// A dispute: the mentor hears that the asker reported a problem (the payout is held); both hear the decision.
const notifyDisputeOpened = (mentor, booking) => safeSend('dispute opened', 'disputeOpened', mentor, { question: booking.question });
const notifyDisputeResolved = (asker, mentor, booking, d) => Promise.all([asker, mentor].map((u) => safeSend('dispute resolved', 'disputeResolved', u, {
  role: u && u.id === booking.seekerId ? 'asker' : 'mentor', outcome: d.outcome, amount: d.refundAmount ? money({ amount: d.refundAmount, currency: booking.currency }) : '', note: d.note
})));

// A receipt for a payment or a refund (data: number, kind, amount, mentor, date, url of the PDF).
const notifyReceipt = (user, data) => safeSend('receipt', 'receipt', user, data);

// The account will be deleted on `when` unless the person signs in and keeps it.
const notifyDeletionScheduled = (user, when) => safeSend('deletion scheduled', 'deletionScheduled', user, { date: utcDate(when, user.language) });

// An admin hid one part of a profile (or all of it), with the reason (server/profileSections.js).
const notifyProfileHidden = (user, { section, reason }) => safeSend('profile hidden', 'profileHidden', user, { section: section || '', reason: reason || '' });

const notifySupportReply = (user, data) => safeSend('support reply', 'supportReply', user, { body: data.body, threadId: data.threadId });

const notifyMentorDeadlineSoon = (mentor, booking) => {
  const locale = mentor.language === 'ka' ? 'ka-GE' : 'en-GB';
  const date = new Date(booking.answerDeadline).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  return safeSend('deadline reminder', booking.amount === 0 ? 'deadlineSoonFree' : 'deadlineSoon', mentor, { question: booking.question, date });
};

const notifyMentorDecision = (mentor, approved, note) => Promise.all([
  inbox().systemMessage(mentor.id, approved ? 'approved' : 'rejected', { note: note || null }),
  // (a mentor who answers for free needs no payout details to be listed: docs/CLAUDE-CODE-WALKTHROUGH-FIXES.md #5)
  safeSend('mentor decision', approved ? 'mentorApproved' : 'mentorRejected', mentor, { note, free: mentor.price === 0 })
]);

const notifyPayoutPaid = (mentor, batch) => Promise.all([
  inbox().systemMessage(mentor.id, 'payout_sent', { amount: batch.amount, reference: batch.reference || null }),
  safeSend('payout notify', 'payoutPaid', mentor, {
    amount: money(batch), last4: batch.iban_last4 || '----', reference: batch.reference
  })
]);

// A withdrawal was asked for, or not sent (with the reason). (Sent: notifyPayoutPaid.)
const notifyWithdrawal = (mentor, kind, batch) => Promise.all([
  inbox().systemMessage(mentor.id, `withdrawal_${kind}`, { amount: batch.amount, ...(kind === 'rejected' ? { reason: batch.reject_reason || '' } : {}) }),
  safeSend(`withdrawal ${kind} notify`, kind === 'rejected' ? 'withdrawalRejected' : 'withdrawalRequested', mentor, {
    amount: money(batch), last4: batch.iban_last4 || '----', reason: batch.reject_reason || ''
  })
]);

// Payout details were changed: always sent (it is a security notice, not an optional email).
const notifyPayoutChanged = (mentor, { oldLast4, newLast4, holdUntil }) => safeSend('payout change notify', 'payoutChanged', mentor, {
  oldLast4, newLast4, holdUntil: holdUntil ? utcDate(holdUntil, mentor.language) : ''
});

// Two-step verification was turned off: always sent (a security notice), naming the device and the time (docs/REVIEW-2.md #11).
const notifyTwoFactorOff = (user, { device, at }) => safeSend('2fa off notify', 'twoFactorOff', user, { device: device || '?', when: utcDate(at || new Date(), user.language) });
// A first password was set on an account that had none (made with Google): always sent, a security notice like the one above.
const notifyPasswordSet = (user, { device, at }) => safeSend('password set notify', 'passwordSet', user, { device: device || '?', when: utcDate(at || new Date(), user.language) });

// A time written for the person receiving it, always with the zone spelled out.
const utcDate = (date, lang) => new Date(date).toLocaleString(lang === 'ka' ? 'ka-GE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

const notifyMentorSuspended = (mentor, note) => Promise.all([
  inbox().systemMessage(mentor.id, 'suspended', { note: note || null }),
  safeSend('mentor suspended', 'mentorSuspended', mentor, { note })
]);

// (docs/CLAUDE-CODE-MENTOR-EDIT.md: an admin changed the price; an admin decided a change to the mentor's details)
const notifyPriceChanged = (mentor, from, to) => safeSend('price changed', 'priceChanged', mentor, { from, to });
const notifyChangeDecided = (mentor, approved, note) => safeSend('change decided', approved ? 'changeApproved' : 'changeRejected', mentor, { note: note || null });

const notifyVerificationUpdate = (mentor, data) => Promise.all([
  inbox().systemMessage(mentor.id, 'verification_update', { step: data.step, status: data.status, reason: data.reason || null, reasonKey: data.reasonKey || null, delisted: Boolean(data.delisted) }),
  safeSend('verification update', 'verificationUpdate', mentor, data)
]);

const notifyInterviewRequested = (mentor, reason) => Promise.all([
  inbox().systemMessage(mentor.id, 'interview_requested', { reason: reason || null }),
  safeSend('interview requested', 'interviewRequested', mentor, { reason })
]);
const notifyVerificationSimplified = (mentor) => safeSend('verification simplified', 'verificationSimplified', mentor, {});

const notifyInterviewBooked =(mentor, slot) =>
  safeSend('interview booked', 'interviewBooked', mentor, { date: utcDate(slot.startsAt, mentor.language), minutes: slot.minutes });
const notifyInterviewLink = (mentor, slot) =>
  safeSend('interview link', 'interviewLink', mentor, { date: utcDate(slot.startsAt, mentor.language), link: slot.meetingLink });
const notifyInterviewCancelled = (mentor, slot, reason) =>
  safeSend('interview cancelled', 'interviewCancelled', mentor, { date: utcDate(slot.startsAt, mentor.language), reason });

// "Please rate" (after 2 and 6 days). data: { role: 'asker' | 'mentor', name (the other person), revealsAt, final }.
const notifyRateReminder = (user, data) =>
  safeSend('rating reminder', 'rateReminder', user, { role: data.role, name: data.name, date: utcDate(data.revealsAt, user.language), final: data.final ? '1' : '' }, { category: 'rating_reminders' });

// Plain notice to the site admins (English), e.g. card disputes.
const notifyAdmins = (subject, html) => {
  if (!config.EMAIL_ENABLED) return Promise.resolve();
  const { sendEmail } = require('./email');
  return Promise.all(config.ADMIN_EMAILS.map(async (to) => {
    try { await sendEmail({ to, subject, html, text: html.replace(/<[^>]+>/g, '') }); }
    catch (e) { console.error('[email] admin notify failed:', e.message); }
  }));
};

// The application was sent: what happens next. Reminders for one left unfinished (server/verification/reminders.js), which the footer
// switches off.
const notifyApplicationReceived = (mentor) => safeSend('application received', 'applicationReceived', mentor, { days: config.MENTOR_REVIEW_DAYS, prelaunch: config.LAUNCH_MODE === 'prelaunch' });
const notifyApplyReminder = (mentor, d) => safeSend('application reminder', 'applyReminder', mentor, d, { category: 'apply_reminders' });
// d: { draft: not sent yet (everything else is done), second: the last of the two }
const notifyIdReminder = (mentor, d = {}) => safeSend('ID check reminder', 'idReminder', mentor, d, { category: 'apply_reminders' });
// Right after sending without the ID check (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md 4): once, see verification/reminders.js oneStepLeft.
const notifyIdOneStep = (mentor) => safeSend('ID check: one step left', 'idOneStep', mentor, {});

module.exports = { notifyApplicationReceived, notifyApplyReminder, notifyIdReminder, notifyIdOneStep, notifyDeletionScheduled, notifyProfileHidden, notifyMentorNewQuestion, notifySeekerAnswered, notifyRefund, notifyFollowUp, notifyFollowUpReminder, notifySupportReply, notifyReceipt, notifyDisputeOpened, notifyDisputeResolved, notifyMentorDeadlineSoon, notifyMentorDecision, notifyPayoutPaid, notifyPayoutChanged, notifyTwoFactorOff, notifyPasswordSet, notifyWithdrawal, notifyMentorSuspended, notifyVerificationUpdate, notifyInterviewRequested, notifyVerificationSimplified, notifyInterviewBooked, notifyInterviewLink, notifyInterviewCancelled, notifyRateReminder, notifyAdmins, notifyPriceChanged, notifyChangeDecided };
