// Emails about bookings and mentor applications. Each goes out in the recipient's own language
// (users.language). Failures are logged and never break the action that triggered them.
const config = require('./config');
const { sendTemplate } = require('./mail');

const money = (b) => `${(b.amount / 100).toFixed(2)} ${String(b.currency).toUpperCase()}`;

async function safeSend(label, name, user, data) {
  if (!config.EMAIL_ENABLED || !user) return;
  try {
    await sendTemplate(name, { to: user.email, lang: user.language, data });
  } catch (e) {
    console.error(`[email] ${label} failed:`, e.message);
  }
}

const notifyMentorNewQuestion = (mentor, booking) =>
  safeSend('new-question notify', 'newQuestion', mentor, { amount: money(booking), question: booking.question });

const notifySeekerAnswered = (seeker, mentor, booking) =>
  safeSend('answer notify', 'answered', seeker, { mentor: mentor.name, answer: booking.answer });

const notifyRefund = (seeker, mentor, booking, reason) => Promise.all([
  safeSend('refund notify (seeker)', 'refundSeeker', seeker, { amount: money(booking), mentor: mentor.name, reason }),
  safeSend('refund notify (mentor)', 'refundMentor', mentor, { question: booking.question, reason })
]);

const notifyMentorDeadlineSoon = (mentor, booking) => {
  const locale = mentor.language === 'ka' ? 'ka-GE' : 'en-GB';
  const date = new Date(booking.answerDeadline).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
  return safeSend('deadline reminder', 'deadlineSoon', mentor, { question: booking.question, date });
};

const notifyMentorDecision = (mentor, approved, note) =>
  safeSend('mentor decision', approved ? 'mentorApproved' : 'mentorRejected', mentor, { note });

const notifyPayoutPaid = (mentor, batch) =>
  safeSend('payout notify', 'payoutPaid', mentor, {
    amount: money(batch), last4: batch.iban_last4 || '----', reference: batch.reference
  });

// Plain notice to the site admins (English), e.g. card disputes.
const notifyAdmins = (subject, html) => {
  if (!config.EMAIL_ENABLED) return Promise.resolve();
  const { sendEmail } = require('./email');
  return Promise.all(config.ADMIN_EMAILS.map(async (to) => {
    try { await sendEmail({ to, subject, html, text: html.replace(/<[^>]+>/g, '') }); }
    catch (e) { console.error('[email] admin notify failed:', e.message); }
  }));
};

module.exports = { notifyMentorNewQuestion, notifySeekerAnswered, notifyRefund, notifyMentorDeadlineSoon, notifyMentorDecision, notifyPayoutPaid, notifyAdmins };
