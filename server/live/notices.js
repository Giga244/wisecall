// What people are told about live sessions: emails (in each person's language) and Inbox messages. Never throws into the caller's work.
const { query } = require('../db');
const config = require('../config');
const { sendTemplate } = require('../mail');
const { getUserById } = require('../models');
const inbox = () => require('../inbox');

const urlOf = (s, lang) => `${config.PUBLIC_URL}${lang === 'ka' ? '/ka' : ''}/live/${s.slug}`;
const endsAt = (s) => new Date(new Date(s.starts_at).getTime() + s.duration_min * 60000);
// "Tuesday 3 November 2026, 19:30 (Tbilisi time)"
function when(d, lang) {
  const f = new Intl.DateTimeFormat(lang === 'ka' ? 'ka-GE' : 'en-GB', { timeZone: 'Asia/Tbilisi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${f.format(new Date(d))} (${lang === 'ka' ? 'თბილისის დროით' : 'Tbilisi time'})`;
}
const safely = (label, fn) => Promise.resolve().then(fn).catch((e) => console.error(`[live] ${label} failed:`, e.message));

// ---- The calendar file (.ics) and the Google Calendar link -------------------------------------------------------------------------------
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function ics(s, lang) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wisecall//Live sessions//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:live-${s.id}@wisecallge.ge`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(s.starts_at)}`, `DTEND:${icsDate(endsAt(s))}`,
    `SUMMARY:${icsText(s.title)}`, `DESCRIPTION:${icsText(`${s.title}\n${urlOf(s, lang)}`)}`, `URL:${urlOf(s, lang)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(s.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
  // (lines longer than 75 octets are folded, as the format requires)
  return lines.map((l) => {
    const out = [];
    let rest = Buffer.from(l, 'utf8');
    while (rest.length > 75) {
      let cut = 75;
      while (cut > 0 && (rest[cut] & 0xc0) === 0x80) cut -= 1; // (never inside a multi-byte letter)
      out.push(rest.subarray(0, cut).toString('utf8'));
      rest = Buffer.concat([Buffer.from(' '), rest.subarray(cut)]);
    }
    out.push(rest.toString('utf8'));
    return out.join('\r\n');
  }).join('\r\n') + '\r\n';
}
const googleLink = (s, lang) => `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(s.title)}`
  + `&dates=${icsDate(s.starts_at)}/${icsDate(endsAt(s))}&details=${encodeURIComponent(urlOf(s, lang))}`;

// ---- Tickets ---------------------------------------------------------------------------------------------------------------------------
async function ticketPaid(t, s, receipt) {
  const buyer = await getUserById(t.buyer_id);
  if (!buyer) return;
  const lang = buyer.language;
  await safely('ticket email', () => sendTemplate('liveTicket', { to: buyer.email, lang, data: {
    title: s.title, when: when(s.starts_at, lang), url: urlOf(s, lang), calendarUrl: googleLink(s, lang)
  }, attachments: [{ filename: 'wisecall-live.ics', content: Buffer.from(ics(s, lang)).toString('base64'), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] }));
  if (receipt) await safely('ticket receipt', () => require('../receipts').email(receipt));
  await safely('ticket inbox', () => inbox().systemMessage(buyer.id, 'live_ticket', { title: s.title, slug: s.slug, startsAt: s.starts_at }));
  const mentor = await getUserById(s.mentor_id);
  if (mentor) await safely('mentor inbox', () => inbox().systemMessage(mentor.id, 'live_ticket_sold', { title: s.title, slug: s.slug, startsAt: s.starts_at }));
}

async function ticketRefunded(t, s, receipt) {
  const buyer = await getUserById(t.buyer_id);
  if (!buyer) return;
  if (receipt) await safely('refund receipt', () => require('../receipts').email(receipt));
  await safely('refund inbox', () => inbox().systemMessage(buyer.id, 'live_refunded', { title: s.title, slug: s.slug, amount: t.price, reason: t.refund_reason }));
}

const buyersOf = async (sessionId, statuses = ['paid', 'refund_pending', 'refunded']) => (await query(
  `SELECT DISTINCT u.* FROM live_tickets t JOIN users u ON u.id = t.buyer_id WHERE t.session_id = $1 AND t.status = ANY($2::text[])`, [sessionId, statuses])).rows;

async function timeChanged(s) {
  for (const b of await buyersOf(s.id, ['paid'])) {
    await safely('time change email', () => sendTemplate('liveTimeChanged', { to: b.email, lang: b.language, data: { title: s.title, when: when(s.starts_at, b.language), url: urlOf(s, b.language) },
      attachments: [{ filename: 'wisecall-live.ics', content: Buffer.from(ics(s, b.language)).toString('base64'), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] }));
    await safely('time change inbox', () => inbox().systemMessage(b.id, 'live_time_changed', { title: s.title, slug: s.slug, startsAt: s.starts_at }));
  }
}

async function cancelled(s) {
  for (const b of await buyersOf(s.id)) {
    await safely('cancel email', () => sendTemplate('liveCancelled', { to: b.email, lang: b.language, data: { title: s.title, when: when(s.starts_at, b.language), reason: s.cancel_reason } }));
    await safely('cancel inbox', () => inbox().systemMessage(b.id, 'live_cancelled', { title: s.title, slug: s.slug, reason: s.cancel_reason }));
  }
  const mentor = await getUserById(s.mentor_id);
  if (mentor && s.cancel_reason !== 'mentor') {
    await safely('cancel mentor email', () => sendTemplate('liveCancelledMentor', { to: mentor.email, lang: mentor.language, data: { title: s.title, when: when(s.starts_at, mentor.language), reason: s.cancel_reason } }));
  }
  if (mentor) await safely('cancel mentor inbox', () => inbox().systemMessage(mentor.id, 'live_cancelled_mentor', { title: s.title, slug: s.slug, reason: s.cancel_reason }));
}

async function reviewed(s, approved) {
  const mentor = await getUserById(s.mentor_id);
  if (!mentor) return;
  await safely('review email', () => sendTemplate(approved ? 'liveApproved' : 'liveRejected', { to: mentor.email, lang: mentor.language,
    data: { title: s.title, url: urlOf(s, mentor.language), reason: s.review_reason || '' } }));
  await safely('review inbox', () => inbox().systemMessage(mentor.id, approved ? 'live_approved' : 'live_rejected', { title: s.title, slug: s.slug, note: approved ? null : s.review_reason }));
}

async function reminder(s, hours) {
  for (const b of await buyersOf(s.id, ['paid'])) {
    await safely('reminder email', () => sendTemplate('liveReminder', { to: b.email, lang: b.language, data: { title: s.title, when: when(s.starts_at, b.language), url: urlOf(s, b.language), hours } }));
    await safely('reminder inbox', () => inbox().systemMessage(b.id, hours === 1 ? 'live_starts_1h' : 'live_starts_24h', { title: s.title, slug: s.slug, startsAt: s.starts_at }));
  }
  const mentor = await getUserById(s.mentor_id);
  if (mentor) await safely('reminder mentor', () => inbox().systemMessage(mentor.id, hours === 1 ? 'live_host_1h' : 'live_host_24h', { title: s.title, slug: s.slug, startsAt: s.starts_at }));
}

async function ended(s) {
  const mentor = await getUserById(s.mentor_id);
  if (mentor) await safely('ended inbox', () => inbox().systemMessage(mentor.id, 'live_ended', { title: s.title, slug: s.slug }));
}

module.exports = { ticketPaid, ticketRefunded, timeChanged, cancelled, reviewed, reminder, ended, ics, googleLink, when, urlOf };
