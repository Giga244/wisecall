// What people are told about live sessions: emails (in each person's language) and Inbox messages. Never throws into the caller's work.
const { query } = require('../db');
const config = require('../config');
const { sendTemplate } = require('../mail');
const { getUserById } = require('../models');
const inbox = () => require('../inbox');

const urlOf = (s, lang) => `${config.PUBLIC_URL}${lang === 'ka' ? '/ka' : ''}/live/${s.slug}`;
const endsAt = (s) => new Date(new Date(s.starts_at).getTime() + s.duration_min * 60000);
// "Tuesday 3 November 2026, 19:30 (Tbilisi time)"
const WHEN = {}; // (one formatter per language, made once: R-12)
function when(d, lang) {
  const key = lang === 'ka' ? 'ka' : 'en';
  const f = WHEN[key] = WHEN[key] || new Intl.DateTimeFormat(key === 'ka' ? 'ka-GE' : 'en-GB', { timeZone: 'Asia/Tbilisi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${f.format(new Date(d))} (${lang === 'ka' ? 'თბილისის დროით' : 'Tbilisi time'})`;
}
const safely = (label, fn) => Promise.resolve().then(fn).catch((e) => console.error(`[live] ${label} failed:`, e.message));

// ---- The calendar file (.ics) and the Google Calendar link -------------------------------------------------------------------------------
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// One session, or several (a series: one event each).
function ics(one, lang) {
  const event = (s) => ['BEGIN:VEVENT',
    `UID:live-${s.id}@wisecallge.ge`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(s.starts_at)}`, `DTEND:${icsDate(endsAt(s))}`,
    `SUMMARY:${icsText(s.title)}`, `DESCRIPTION:${icsText(`${s.title}\n${urlOf(s, lang)}`)}`, `URL:${urlOf(s, lang)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(s.title)}`, 'END:VALARM', 'END:VEVENT'];
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Wisecall//Live sessions//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...(Array.isArray(one) ? one : [one]).flatMap(event), 'END:VCALENDAR'];
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
// The ticket email (with the calendar file) and the Inbox message, for the person who attends.
async function ticketFor(u, s) {
  const lang = u.language;
  await safely('ticket email', () => sendTemplate('liveTicket', { to: u.email, lang, data: {
    title: s.title, when: when(s.starts_at, lang), url: urlOf(s, lang), calendarUrl: googleLink(s, lang)
  }, attachments: [{ filename: 'wisecall-live.ics', content: Buffer.from(ics(s, lang)).toString('base64'), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] }));
  await safely('ticket inbox', () => inbox().systemMessage(u.id, 'live_ticket', { title: s.title, slug: s.slug, startsAt: s.starts_at }));
}

// Paid: the buyer gets the receipt, and the ticket (or, for a gift, the person it is for gets the link to claim it).
async function ticketPaid(t, s, receipt, giftToken) {
  const buyer = await getUserById(t.buyer_id);
  if (!buyer) return;
  if (t.gift_email && giftToken) {
    await giftLink(t, s, giftToken, buyer);
    await safely('gift sent inbox', () => inbox().systemMessage(buyer.id, 'live_gift_sent', { title: s.title, slug: s.slug }));
  } else await ticketFor(buyer, s);
  if (receipt) await safely('ticket receipt', () => require('../receipts').email(receipt));
  const mentor = await getUserById(s.mentor_id);
  if (mentor) await safely('mentor inbox', () => inbox().systemMessage(mentor.id, 'live_ticket_sold', { title: s.title, slug: s.slug, startsAt: s.starts_at }));
}

async function ticketRefunded(t, s, receipt) {
  const buyer = await getUserById(t.buyer_id);
  if (receipt && buyer) await safely('refund receipt', () => require('../receipts').email(receipt));
  // (a claimed gift: the person who would have attended is told too; the money goes back to the buyer)
  for (const id of [...new Set([t.buyer_id, t.holder_id].filter(Boolean))]) {
    await safely('refund inbox', () => inbox().systemMessage(id, 'live_refunded', { title: s.title, slug: s.slug, amount: id === t.buyer_id ? t.price : null, reason: t.refund_reason }));
  }
}

// Everybody with a ticket: who attends (the holder) and, with all = true, also whoever paid (a gift's buyer: refunds, a new time).
const buyersOf = async (sessionId, statuses = ['paid', 'refund_pending', 'refunded'], { all = true } = {}) => (await query(
  `SELECT DISTINCT u.* FROM live_tickets t JOIN users u ON u.id = t.holder_id OR ($3 AND u.id = t.buyer_id)
     WHERE t.session_id = $1 AND t.status = ANY($2::text[]) AND u.deleted_at IS NULL`, [sessionId, statuses, all])).rows;

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
  for (const b of await buyersOf(s.id, ['paid'], { all: false })) {
    await safely('reminder email', () => sendTemplate('liveReminder', { to: b.email, lang: b.language, data: { title: s.title, when: when(s.starts_at, b.language), url: urlOf(s, b.language), hours } }));
    await safely('reminder inbox', () => inbox().systemMessage(b.id, hours === 1 ? 'live_starts_1h' : 'live_starts_24h', { title: s.title, slug: s.slug, startsAt: s.starts_at }));
  }
  const mentor = await getUserById(s.mentor_id);
  if (mentor) await safely('reminder mentor', () => inbox().systemMessage(mentor.id, hours === 1 ? 'live_host_1h' : 'live_host_24h', { title: s.title, slug: s.slug, startsAt: s.starts_at }));
}

async function ended(s) {
  const mentor = await getUserById(s.mentor_id);
  if (mentor) await safely('ended inbox', () => inbox().systemMessage(mentor.id, 'live_ended', { title: s.title, slug: s.slug }));
  // (the people who were in the room are asked to rate it; the 15 % code comes in its own message)
  const { rows } = await query(`SELECT DISTINCT holder_id FROM live_tickets WHERE session_id = $1 AND status = 'paid' AND holder_id IS NOT NULL AND attended_seconds >= 60`, [s.id]);
  for (const r of rows) await safely('rate inbox', () => inbox().systemMessage(r.holder_id, 'live_rate', { title: s.title, slug: s.slug }));
}

// The waiting list: a seat is kept for this person for 2 hours.
async function seatOffered(w, s) {
  const u = await getUserById(w.user_id);
  if (!u) return;
  const lang = u.language;
  await safely('seat offer email', () => sendTemplate('liveSeatOffered', { to: u.email, lang, data: { title: s.title, when: when(s.starts_at, lang), url: urlOf(s, lang),
    until: when(w.offer_expires_at, lang) } }));
  await safely('seat offer inbox', () => inbox().systemMessage(u.id, 'live_seat_offered', { title: s.title, slug: s.slug, until: w.offer_expires_at }));
}

// A mentor someone follows published a session (server/live/follows.js decides who: at most once a week per mentor).
async function followerNewSession(u, mentor, s, unfollowUrl) {
  await sendTemplate('liveNewSession', { to: u.email, lang: u.language, data: { name: mentor ? mentor.name : '', title: s.title, when: when(s.starts_at, u.language),
    url: urlOf(s, u.language), unsubscribeUrl: unfollowUrl } });
}

// The 15 % code for a question with the same mentor.
async function discountCode(c, mentor, s) {
  const u = await getUserById(c.user_id);
  if (!u || !mentor) return;
  // (the code in the link fills the ask form; it works only for this person and this mentor)
  const profile = `${config.PUBLIC_URL}${u.language === 'ka' ? '/ka' : ''}/u/${encodeURIComponent(mentor.username || '')}?code=${encodeURIComponent(c.code)}#ask`;
  await safely('code email', () => sendTemplate('liveDiscount', { to: u.email, lang: u.language, data: { code: c.code, percent: c.percent, name: mentor.name,
    title: s.title, url: profile, until: when(c.expires_at, u.language) } }));
  await safely('code inbox', () => inbox().systemMessage(u.id, 'live_discount', { title: s.title, slug: s.slug, code: c.code, percent: c.percent, mentor: mentor.name,
    username: mentor.username, until: c.expires_at }));
}

// A gift: the person it is for gets a link to claim it (they sign in or create an account first), in the buyer's language. Only the
// buyer's first name is in it.
async function giftLink(t, s, rawToken, buyer0) {
  const buyer = buyer0 || await getUserById(t.buyer_id);
  const lang = (buyer && buyer.language) || 'ka';
  const claimUrl = `${config.PUBLIC_URL}${lang === 'ka' ? '/ka' : ''}/live-claim.html?token=${encodeURIComponent(rawToken)}`;
  await safely('gift email', () => sendTemplate('liveGift', { to: t.gift_email, lang, data: { name: buyer ? String(buyer.name).trim().split(/\s+/)[0] : '', title: s.title,
    when: when(s.starts_at, lang), url: claimUrl } }));
}

// The gift was claimed: its new holder gets the ticket; the buyer is told (not who: they know whom they gave it to).
async function giftClaimed(t, s, holder) {
  await ticketFor(holder, s);
  await safely('gift claimed inbox', () => inbox().systemMessage(t.buyer_id, 'live_gift_claimed', { title: s.title, slug: s.slug }));
}

// A series was paid: one email with every session and one calendar file holding them all; the receipt; the Inbox; the mentor is told.
// (`refunded`: the payment came too late and went straight back — then only the receipt.)
async function seriesPaid(order, series, receipt, refunded) {
  const buyer = await getUserById(order.buyer_id);
  if (!buyer) return;
  if (receipt) await safely('series receipt', () => require('../receipts').email(receipt));
  if (refunded) return;
  const lang = buyer.language;
  const { rows: list } = await query(
    `SELECT s.* FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id WHERE t.series_order_id = $1 AND t.status = 'paid' ORDER BY s.starts_at`, [order.id]);
  if (!list.length) return;
  const lines = list.map((s) => `${s.title} — ${when(s.starts_at, lang)}`).join('\n');
  await safely('series email', () => sendTemplate('liveSeriesTicket', { to: buyer.email, lang, data: {
    title: series.title, count: list.length, sessions: lines, url: `${config.PUBLIC_URL}${lang === 'ka' ? '/ka' : ''}/live/series/${series.slug}`
  }, attachments: [{ filename: 'wisecall-live.ics', content: Buffer.from(ics(list, lang)).toString('base64'), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] }));
  await safely('series inbox', () => inbox().systemMessage(buyer.id, 'live_series_ticket', { title: series.title, slug: series.slug, count: list.length }));
  await safely('series mentor inbox', () => inbox().systemMessage(series.mentor_id, 'live_series_sold', { title: series.title, slug: series.slug }));
}

// A replay pass was paid: the receipt and an Inbox message with the link.
async function replayPaid(purchase, s, receipt) {
  if (receipt) await safely('replay receipt', () => require('../receipts').email(receipt));
  await safely('replay inbox', () => inbox().systemMessage(purchase.buyer_id, 'live_replay_paid', { title: s.title, slug: s.slug, until: purchase.access_until }));
}

module.exports = { ticketPaid, ticketRefunded, timeChanged, cancelled, reviewed, reminder, ended, seatOffered, followerNewSession, discountCode, giftLink,
  giftClaimed, seriesPaid, replayPaid, ics, googleLink, when, urlOf };
