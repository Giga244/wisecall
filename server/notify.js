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
  safeSend('new-question notify', 'newQuestion', mentor, { amount: money(booking), question: booking.question })
]);

const notifySeekerAnswered = (seeker, mentor, booking) => Promise.all([
  inbox().onAnswered(booking),
  safeSend('answer notify', 'answered', seeker, { mentor: mentor.name, answer: booking.answer })
]);

const notifyRefund = (seeker, mentor, booking, reason) => Promise.all([
  inbox().onRefunded(booking, reason),
  safeSend('refund notify (seeker)', 'refundSeeker', seeker, { amount: money(booking), mentor: mentor.name, reason }),
  safeSend('refund notify (mentor)', 'refundMentor', mentor, { question: booking.question, reason })
]);

// The one free follow-up question (to the mentor) and its reply (to the asker). data: { kind, from, body, threadId }
const notifyFollowUp = (to, data) =>
  safeSend('follow-up notify', data.kind === 'follow_up_question' ? 'followUpQuestion' : 'followUpReply', to, { name: data.from, body: data.body, threadId: data.threadId });

// A dispute: the mentor hears that the asker reported a problem (the payout is held); both hear the decision.
const notifyDisputeOpened = (mentor, booking) => safeSend('dispute opened', 'disputeOpened', mentor, { question: booking.question });
const notifyDisputeResolved = (asker, mentor, booking, d) => Promise.all([asker, mentor].map((u) => safeSend('dispute resolved', 'disputeResolved', u, {
  role: u && u.id === booking.seekerId ? 'asker' : 'mentor', outcome: d.outcome, amount: d.refundAmount ? money({ amount: d.refundAmount, currency: booking.currency }) : '', note: d.note
})));

const notifySupportReply = (user, data) => safeSend('support reply', 'supportReply', user, { body: data.body, threadId: data.threadId });

const notifyMentorDeadlineSoon = (mentor, booking) => {
  const locale = mentor.language === 'ka' ? 'ka-GE' : 'en-GB';
  const date = new Date(booking.answerDeadline).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  return safeSend('deadline reminder', 'deadlineSoon', mentor, { question: booking.question, date });
};

const notifyMentorDecision = (mentor, approved, note) => Promise.all([
  inbox().systemMessage(mentor.id, approved ? 'approved' : 'rejected', { note: note || null }),
  safeSend('mentor decision', approved ? 'mentorApproved' : 'mentorRejected', mentor, { note })
]);

const notifyPayoutPaid = (mentor, batch) => Promise.all([
  inbox().systemMessage(mentor.id, 'payout_sent', { amount: batch.amount, reference: batch.reference || null }),
  safeSend('payout notify', 'payoutPaid', mentor, {
    amount: money(batch), last4: batch.iban_last4 || '----', reference: batch.reference
  })
]);

// A time written for the person receiving it, always with the zone spelled out.
const utcDate = (date, lang) => new Date(date).toLocaleString(lang === 'ka' ? 'ka-GE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

const notifyMentorSuspended = (mentor, note) => Promise.all([
  inbox().systemMessage(mentor.id, 'suspended', { note: note || null }),
  safeSend('mentor suspended', 'mentorSuspended', mentor, { note })
]);

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

module.exports = { notifyMentorNewQuestion, notifySeekerAnswered, notifyRefund, notifyFollowUp, notifySupportReply, notifyDisputeOpened, notifyDisputeResolved, notifyMentorDeadlineSoon, notifyMentorDecision, notifyPayoutPaid, notifyMentorSuspended, notifyVerificationUpdate, notifyInterviewRequested, notifyVerificationSimplified, notifyInterviewBooked, notifyInterviewLink, notifyInterviewCancelled, notifyRateReminder, notifyAdmins };
