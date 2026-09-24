// Every email the platform sends about bookings lives here, so wording and layout can be
// changed in one place. Failures are logged and never break the action that triggered them.
const config = require('./config');
const { sendEmail, escapeHtml } = require('./email');

const money = (b) => `${(b.amount / 100).toFixed(2)} ${String(b.currency).toUpperCase()}`;
const oneLine = (s) => String(s).replace(/[\r\n]+/g, ' ');

async function safeSend(label, message) {
  if (!config.EMAIL_ENABLED) return;
  try {
    await sendEmail(message);
  } catch (e) {
    console.error(`[email] ${label} failed:`, e.message);
  }
}

const dashboardLink = `<a href="${config.APP_URL}/dashboard.html">your dashboard</a>`;

const notifyMentorNewQuestion = (mentor, booking) => safeSend('new-question notify', {
  to: mentor.email,
  subject: 'You have a new paid question on Wisecall',
  html: `<p>Someone paid ${escapeHtml(money(booking))} to ask you a question:</p><p>"${escapeHtml(booking.question)}"</p><p>Answer it in ${dashboardLink} within ${config.ANSWER_DEADLINE_DAYS} days, or the payment is refunded automatically.</p>`
});

const notifySeekerAnswered = (seeker, mentor, booking) => safeSend('answer notify', {
  to: seeker.email,
  subject: `${oneLine(mentor.name)} answered your question on Wisecall`,
  html: `<p>${escapeHtml(mentor.name)} just answered your question:</p><p>"${escapeHtml(booking.answer)}"</p><p>Read it in ${dashboardLink}.</p>`
});

const notifyRefund = (seeker, mentor, booking, reason) => {
  const why = reason === 'no_answer_deadline'
    ? `${escapeHtml(mentor.name)} did not answer within ${config.ANSWER_DEADLINE_DAYS} days`
    : 'the payment was refunded by our team';
  return Promise.all([
    safeSend('refund notify (seeker)', {
      to: seeker.email,
      subject: 'Your Wisecall payment was refunded',
      html: `<p>We refunded ${escapeHtml(money(booking))} for your question to ${escapeHtml(mentor.name)} because ${why}.</p><p>It can take 5–10 business days to appear on your statement.</p>`
    }),
    safeSend('refund notify (mentor)', {
      to: mentor.email,
      subject: 'A question was refunded on Wisecall',
      html: `<p>The question "${escapeHtml(booking.question)}" was refunded to the buyer because ${why}. You will not receive a payout for it.</p>`
    })
  ]);
};

const notifyMentorDeadlineSoon = (mentor, booking) => safeSend('deadline reminder', {
  to: mentor.email,
  subject: 'Answer soon or the question will be refunded',
  html: `<p>You have a paid question waiting: "${escapeHtml(booking.question)}"</p><p>If it is not answered by ${escapeHtml(new Date(booking.answerDeadline).toUTCString())}, the buyer is refunded automatically.</p><p>Answer it in ${dashboardLink}.</p>`
});

const notifyAdmins = (subject, html) => Promise.all(config.ADMIN_EMAILS.map((to) => safeSend('admin notify', { to, subject, html })));

module.exports = { notifyMentorNewQuestion, notifySeekerAnswered, notifyRefund, notifyMentorDeadlineSoon, notifyAdmins };
