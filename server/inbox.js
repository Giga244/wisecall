// The Inbox: conversations and the notification centre (/inbox.html).
//   booking thread  one per paid booking, between the asker and the mentor. It shows the question and the answer (read from bookings,
//                   the one source of truth), what happened (paid, answered, refunded, rating revealed), ONE free follow-up question
//                   from the asker and ONE follow-up reply from the mentor. After the reply the thread closes.
//   support thread  a person and the Wisecall team; admins answer from the admin panel (Support tab), with internal notes.
//   system thread   one per person: messages from Wisecall (application decisions, payouts).
// Nobody can start a conversation with another user: there is no free messaging between strangers. In booking threads, phone numbers,
// email addresses, messenger handles and requests to pay outside Wisecall are refused with an explanation (server/textSafety.js); the
// refused text is never stored. Everything is plain text; pages escape it when they show it.
// Nothing here may break the action that triggered it: the event hooks log their errors and carry on.
const crypto = require('crypto');
const { query, tx } = require('./db');
const config = require('./config');
const textSafety = require('./textSafety');
const { firstName } = require('./ageGate');

// The mentor replies to the free follow-up within FOLLOW_UP_REPLY_DAYS (a reminder after followUpReminderDays); until the reply, or the
// deadline, that booking's payout waits (server/ledger.js payableSql). A deadline missed lets the asker report it for followUpDisputeDays.
const FOLLOW_UP_REPLY_DAYS = 3;
const LIMITS = {
  followUpMin: 10, followUpMax: 1000, replyMax: 2000, followUpDays: 7,
  followUpReplyDays: FOLLOW_UP_REPLY_DAYS, followUpReminderDays: 2, followUpDisputeDays: 7,
  supportSubjectMax: 120, supportMin: 2, supportMax: 3000, openSupportMax: 5,
  reportDetailsMax: 500
};
// Emails a person may turn off in Settings -> Notifications. Everything else (payments, answers, follow-ups, refunds, application
// decisions, payouts, support replies, security) is transactional and always sent.
const OPTIONAL_EMAILS = ['rating_reminders', 'tips', 'apply_reminders'];
const REPORT_REASONS = ['contact_details', 'abuse', 'spam', 'scam', 'other'];
// Why a withdrawal request lost a payout, or was closed, when a follow-up question came in for it (the mentor reads it in their language).
const FOLLOW_UP_WAITS = {
  en: 'A follow-up question is waiting for your reply, so the payout for that question waits too. Ask again once you have replied.',
  ka: 'დამატებითი კითხვა შენს პასუხს ელოდება, ამიტომ იმ კითხვის ანაზღაურებაც შეჩერებულია. მოითხოვე თავიდან, როცა უპასუხებ.'
};

class InboxError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; Object.assign(this, extra); }
}
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const runner = (client) => (client ? client.query.bind(client) : query);
const safely = (label, fn) => Promise.resolve().then(fn).catch((e) => console.error(`[inbox] ${label} failed:`, e.message));

// ---- Threads and messages ----------------------------------------------------------------------------------------------------
async function bookingThreadId(bookingId, client) {
  const run = runner(client);
  await run(`INSERT INTO threads (kind, booking_id) VALUES ('booking', $1) ON CONFLICT (booking_id) DO NOTHING`, [bookingId]);
  return (await run('SELECT id FROM threads WHERE booking_id = $1', [bookingId])).rows[0].id;
}

async function systemThreadId(userId) {
  await query(`INSERT INTO threads (kind, user_id, subject) VALUES ('system', $1, 'Wisecall') ON CONFLICT (user_id) WHERE kind = 'system' DO NOTHING`, [userId]);
  return (await query(`SELECT id FROM threads WHERE kind = 'system' AND user_id = $1`, [userId])).rows[0].id;
}

async function addMessage(threadId, { senderId = null, role, kind = 'text', body = '', event = null, data = {} }, client) {
  const run = runner(client);
  const { rows } = await run(
    `INSERT INTO messages (thread_id, sender_id, sender_role, kind, body, event, data) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [threadId, senderId, role, kind, body, event, JSON.stringify(data)]);
  // (an internal note does not move the thread up for the person it is with)
  if (kind !== 'internal_note') await run('UPDATE threads SET last_message_at = now() WHERE id = $1', [threadId]);
  return rows[0];
}

async function notifyUser(userId, kind, { threadId = null, bookingId = null, data = {} } = {}, client) {
  if (!userId) return;
  await runner(client)('INSERT INTO notifications (user_id, kind, thread_id, booking_id, data) VALUES ($1, $2, $3, $4, $5)',
    [userId, kind, threadId, bookingId, JSON.stringify(data)]);
}

// ---- Events from the rest of the site (called from server/notify.js and server/ratings.js) --------------------------------------
async function bookingEvent(booking, event, data, notices) {
  const threadId = await bookingThreadId(booking.id);
  await addMessage(threadId, { role: 'system', kind: 'event', event, data });
  for (const [userId, kind] of notices) await notifyUser(userId, kind, { threadId, bookingId: booking.id, data });
}
const onPaid = (booking) => (booking.amount === 0 // (a free question: asked, not paid)
  ? safely('free asked', () => bookingEvent(booking, 'free_asked', {}, [[booking.mentorId, 'new_free_question']]))
  : safely('paid', () => bookingEvent(booking, 'paid', {}, [[booking.mentorId, 'new_question']])));
const onAnswered = (booking) => safely('answered', () => bookingEvent(booking, 'answered', {}, [[booking.seekerId, 'answered']]));
// (a free question is "closed": nothing was paid, so nothing is refunded)
const onRefunded = (booking, reason) => (booking.amount === 0
  ? safely('free closed', () => bookingEvent(booking, 'free_closed', { reason: reason || null }, [[booking.seekerId, 'free_closed'], [booking.mentorId, 'free_closed']]))
  : safely('refunded', () => bookingEvent(booking, 'refunded', { reason: reason || null, amount: booking.refundedAmount || booking.amount },
    [[booking.seekerId, 'refunded'], [booking.mentorId, 'refunded']])));
const onDeclined = (booking, reason) => safely('declined', () => bookingEvent(booking, 'declined', { reason }, [[booking.seekerId, 'declined']]));
const onDisputeOpened = (booking) => safely('dispute opened', () => bookingEvent(booking, 'dispute_opened', {}, [[booking.mentorId, 'dispute_opened']]));
const onDisputeResolved = (booking, d) => safely('dispute resolved', () => bookingEvent(booking, 'dispute_resolved',
  { outcome: d.outcome, amount: d.refundAmount || null, note: d.note }, [[booking.seekerId, 'dispute_resolved'], [booking.mentorId, 'dispute_resolved']]));
// A rating became visible: the person who was rated hears about it.
const onRatingRevealed = (bookingId, rateeId) => safely('rating revealed', async () => {
  const threadId = await bookingThreadId(bookingId);
  await notifyUser(rateeId, 'rating_revealed', { threadId, bookingId });
});
// A message from Wisecall in the person's own system thread (application decisions, payouts). `data` holds what the page needs to
// write it in the reader's language (a step name, a reason an admin wrote, an amount).
const systemMessage = (userId, event, data = {}) => safely(`system message ${event}`, async () => {
  const threadId = await systemThreadId(userId);
  await addMessage(threadId, { role: 'system', kind: 'event', event, data });
  await notifyUser(userId, event, { threadId, data });
});

// ---- Who may see what ----------------------------------------------------------------------------------------------------------
async function loadThread(threadId) {
  if (!isUuid(threadId)) return null;
  const { rows } = await query(
    `SELECT t.*, b.seeker_id, b.mentor_id FROM threads t LEFT JOIN bookings b ON b.id = t.booking_id WHERE t.id = $1`, [threadId]);
  return rows[0] || null;
}
// 'asker' | 'mentor' | 'user' (support/system) | null (not theirs)
function roleIn(thread, userId) {
  if (!thread) return null;
  if (thread.kind === 'booking') return thread.seeker_id === userId ? 'asker' : (thread.mentor_id === userId ? 'mentor' : null);
  return thread.user_id === userId ? 'user' : null;
}

// ---- Reading -------------------------------------------------------------------------------------------------------------------
// In the list, a last event shows as its sentence (public/js/inbox.js eventLine), which needs a few of its values: a session's title,
// an amount, a step. Only those are sent; notes, reasons, codes and links stay in the opened thread (which already shows them all).
const PREVIEW_FIELDS = ['title', 'percent', 'mentor', 'amount', 'reference', 'outcome', 'step', 'status'];
const previewData = (d) => Object.fromEntries(PREVIEW_FIELDS.filter((k) => d && d[k] !== undefined && d[k] !== null).map((k) => [k, d[k]]));

async function listThreads(userId) {
  const { rows } = await query(
    `WITH mine AS (
       SELECT t.* FROM threads t JOIN bookings b ON b.id = t.booking_id WHERE t.kind = 'booking' AND (b.seeker_id = $1 OR b.mentor_id = $1)
       UNION ALL
       SELECT t.* FROM threads t WHERE t.kind IN ('support', 'system') AND t.user_id = $1)
     SELECT m.id, m.kind, m.status, m.subject, m.booking_id, m.last_message_at,
            b.seeker_id, b.mentor_id, b.asker_minor, left(b.question, 140) AS question, b.status AS booking_status,
            ou.id AS other_id, ou.name AS other_name, ou.username AS other_username, ou.color AS other_color, ou.photo_updated_at AS other_photo_at,
            lm.kind AS last_kind, lm.event AS last_event, left(lm.body, 140) AS last_body, lm.sender_role AS last_role, lm.data AS last_data,
            EXISTS (SELECT 1 FROM messages x WHERE x.thread_id = m.id AND x.kind <> 'internal_note' AND x.sender_id IS DISTINCT FROM $1
                      AND x.created_at > COALESCE((SELECT r.last_read_at FROM thread_reads r WHERE r.thread_id = m.id AND r.user_id = $1), '-infinity'::timestamptz)) AS unread
       FROM mine m
       LEFT JOIN bookings b ON b.id = m.booking_id
       LEFT JOIN users ou ON ou.id = CASE WHEN b.seeker_id = $1 THEN b.mentor_id ELSE b.seeker_id END
       LEFT JOIN LATERAL (SELECT kind, event, body, sender_role, data FROM messages x WHERE x.thread_id = m.id AND x.kind <> 'internal_note'
                          ORDER BY x.created_at DESC LIMIT 1) lm ON true
      ORDER BY m.last_message_at DESC LIMIT 200`, [userId]);
  const { photoUrl } = require('./util');
  return rows.map((r) => ({
    id: r.id, kind: r.kind, status: r.status, subject: r.subject, bookingId: r.booking_id, lastMessageAt: r.last_message_at, unread: r.unread,
    role: r.kind === 'booking' ? (r.seeker_id === userId ? 'asker' : 'mentor') : 'user',
    question: r.question, bookingStatus: r.booking_status,
    // (a mentor sees only the first name of somebody under 18: docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 5)
    other: !r.other_id ? null : (r.asker_minor && r.mentor_id === userId
      ? { name: firstName(r.other_name), username: null, color: r.other_color, photoUrl: null }
      : { name: r.other_name, username: r.other_username, color: r.other_color, photoUrl: photoUrl({ id: r.other_id, photoUpdatedAt: r.other_photo_at }) }),
    last: r.last_kind ? {
      kind: r.last_kind, event: r.last_event, body: r.last_kind === 'event' ? null : r.last_body, role: r.last_role,
      data: r.last_kind === 'event' ? previewData(r.last_data) : {}
    } : null
  }));
}

const messageView = (m, viewerId) => ({
  id: m.id, kind: m.kind, event: m.event, body: m.kind === 'event' ? null : m.body, data: m.data || {}, senderRole: m.sender_role,
  mine: Boolean(viewerId) && m.sender_id === viewerId, createdAt: m.created_at
});

// Where the free follow-up stands for this viewer. It can be asked once the asker can read the answer, within LIMITS.followUpDays;
// the mentor can reply once; then the thread is closed.
function followUpState(thread, booking, messages, role) {
  const q = messages.find((m) => m.kind === 'follow_up_question');
  const r = messages.find((m) => m.kind === 'follow_up_reply');
  const visible = booking.status === 'answered' && booking.answerReview !== 'held' && Boolean(booking.answeredAt);
  const since = booking.answerReleasedAt || booking.answeredAt;
  const askUntil = since ? new Date(new Date(since).getTime() + LIMITS.followUpDays * 86400000) : null;
  const closed = thread.status === 'closed' || Boolean(r);
  // (the mentor's reply deadline, while it is waiting; once it passed, until when the asker can report it)
  const replyBy = q && !r && thread.follow_up_due_at ? thread.follow_up_due_at : null;
  const missed = Boolean(q && !r && thread.follow_up_missed_at);
  return {
    asked: Boolean(q), replied: Boolean(r), closed, askUntil, replyBy, missed,
    reportUntil: missed ? new Date(new Date(thread.follow_up_missed_at).getTime() + LIMITS.followUpDisputeDays * 86400000) : null,
    canAsk: role === 'asker' && visible && !q && !closed && askUntil && Date.now() < +askUntil,
    canReply: role === 'mentor' && Boolean(q) && !r && !closed && booking.status === 'answered',
    limits: { min: LIMITS.followUpMin, max: role === 'mentor' ? LIMITS.replyMax : LIMITS.followUpMax }
  };
}

async function threadFor(user, threadId) {
  const thread = await loadThread(threadId);
  const role = roleIn(thread, user.id);
  if (!role) throw new InboxError('not_found');
  const { rows } = await query(`SELECT * FROM messages WHERE thread_id = $1 AND kind <> 'internal_note' ORDER BY created_at, id LIMIT 500`, [thread.id]);
  const out = { thread: { id: thread.id, kind: thread.kind, status: thread.status, subject: thread.subject, role }, messages: rows.map((m) => messageView(m, user.id)) };
  if (thread.kind === 'booking') {
    const { getBookingById, getUserById } = require('./models');
    const probation = require('./probation');
    const { photoUrl } = require('./util');
    const booking = probation.forViewer(await getBookingById(thread.booking_id), user.id);
    const other = await getUserById(role === 'asker' ? booking.mentorId : booking.seekerId);
    out.booking = {
      id: booking.id, status: booking.status, question: booking.question, answer: booking.answer || null, answeredAt: booking.answer ? booking.answeredAt : null,
      paidAt: booking.paidAt, answerDeadline: booking.answerDeadline, amount: booking.amount, answerHeld: role === 'mentor' && booking.answerReview === 'held'
    };
    out.thread.other = !other ? null : (booking.askerMinor && role === 'mentor'
      ? { name: firstName(other.name), username: null, color: other.color, photoUrl: null }
      : { name: other.name, username: other.username, color: other.color, photoUrl: photoUrl(other) });
    out.booking.askerMinor = role === 'mentor' && booking.askerMinor;
    out.followUp = followUpState(thread, booking, rows, role);
  }
  await markThreadRead(user.id, thread.id);
  return out;
}

async function markThreadRead(userId, threadId) {
  await query(`INSERT INTO thread_reads (thread_id, user_id, last_read_at) VALUES ($1, $2, now())
               ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = now()`, [threadId, userId]);
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND thread_id = $2 AND read_at IS NULL', [userId, threadId]);
}

// The booking's thread, for a link from the dashboard (/inbox.html?booking=<id>). Only the asker and the mentor, and only once paid.
async function threadIdForBooking(user, bookingId) {
  if (!isUuid(bookingId)) throw new InboxError('not_found');
  const { rows } = await query(`SELECT id, seeker_id, mentor_id, status FROM bookings WHERE id = $1`, [bookingId]);
  const b = rows[0];
  if (!b || (b.seeker_id !== user.id && b.mentor_id !== user.id) || ['pending_payment', 'expired'].includes(b.status)) throw new InboxError('not_found');
  return bookingThreadId(b.id);
}

// ---- Writing -------------------------------------------------------------------------------------------------------------------
function checkText(text, min, max) {
  if (typeof text !== 'string') throw new InboxError('missing_fields');
  const body = textSafety.cleanText(text);
  const n = textSafety.length(body);
  if (n < min) throw new InboxError('too_short', { min });
  if (n > max) throw new InboxError('too_long', { max });
  return body;
}

// Contact details and outside payments are refused in booking threads. Only the kinds found are kept, never the text.
// (a thread about a 16-17-year-old's question is checked as strictly as the question: server/textSafety.js)
async function refuseContactDetails(threadId, senderId, body, minor) {
  const reasons = [...new Set([...textSafety.findContactDetails(body), ...(minor ? textSafety.findBlockedContact(body, { strict: true }) : [])])];
  if (!reasons.length) return;
  await query('INSERT INTO blocked_messages (thread_id, sender_id, reasons) VALUES ($1, $2, $3)', [threadId, senderId, reasons]);
  throw new InboxError('contact_details', { reasons });
}

async function postMessage(user, threadId, text) {
  const thread = await loadThread(threadId);
  const role = roleIn(thread, user.id);
  if (!role) throw new InboxError('not_found');
  if (thread.kind === 'system') throw new InboxError('read_only');
  if (thread.kind === 'support') return postSupportMessage(user, thread, text);

  // A booking thread: only the follow-up question and its reply.
  const { getBookingById, getUserById } = require('./models');
  const booking = await getBookingById(thread.booking_id);
  const { rows } = await query(`SELECT kind FROM messages WHERE thread_id = $1 AND kind IN ('follow_up_question', 'follow_up_reply')`, [thread.id]);
  const state = followUpState(thread, booking, rows, role);
  if (role === 'asker' && !state.canAsk) throw new InboxError(state.asked ? 'follow_up_used' : (state.closed ? 'thread_closed' : 'follow_up_not_open'));
  if (role === 'mentor' && !state.canReply) throw new InboxError(state.replied || state.closed ? 'thread_closed' : 'nothing_to_reply');
  const body = checkText(text, LIMITS.followUpMin, role === 'mentor' ? LIMITS.replyMax : LIMITS.followUpMax);
  await refuseContactDetails(thread.id, user.id, body, booking.askerMinor);
  if (textSafety.isOffensive(body)) throw new InboxError('offensive');

  const kind = role === 'asker' ? 'follow_up_question' : 'follow_up_reply';
  const mentor = await getUserById(booking.mentorId);
  let message;
  try {
    message = await tx(async (client) => {
      const m = await addMessage(thread.id, { senderId: user.id, role, kind, body }, client);
      if (kind === 'follow_up_question') {
        // The mentor replies within FOLLOW_UP_REPLY_DAYS; until then this booking's payout waits (server/ledger.js payableSql), and one
        // already in a withdrawal request that was not sent yet comes out of it, so the wait cannot be gone round.
        await client.query('UPDATE threads SET follow_up_due_at = now() + make_interval(days => $2) WHERE id = $1', [thread.id, LIMITS.followUpReplyDays]);
        await require('./withdrawals').takeOutOfRequest(client, booking.id, FOLLOW_UP_WAITS[mentor && mentor.language === 'ka' ? 'ka' : 'en']);
      }
      if (kind === 'follow_up_reply') {
        await client.query(`UPDATE threads SET status = 'closed', follow_up_replied_at = now() WHERE id = $1`, [thread.id]);
        await addMessage(thread.id, { role: 'system', kind: 'event', event: 'follow_up_closed' }, client);
      }
      await notifyUser(role === 'asker' ? booking.mentorId : booking.seekerId, kind, { threadId: thread.id, bookingId: booking.id }, client);
      return m;
    });
  } catch (e) {
    if (e.code === '23505') throw new InboxError(kind === 'follow_up_question' ? 'follow_up_used' : 'thread_closed'); // (sent twice at once)
    throw e;
  }
  const to = await getUserById(role === 'asker' ? booking.mentorId : booking.seekerId);
  require('./notify').notifyFollowUp(to, { kind, from: booking.askerMinor && role === 'asker' ? firstName(user.name) : user.name, body, threadId: thread.id });
  return messageView(message, user.id);
}

// ---- Support -------------------------------------------------------------------------------------------------------------------
async function startSupport(user, { subject, body, source = 'inbox' } = {}) {
  const text = checkText(body, LIMITS.supportMin, LIMITS.supportMax);
  const subj = textSafety.cleanText(typeof subject === 'string' ? subject : '').replace(/\s+/g, ' ').slice(0, LIMITS.supportSubjectMax) || null;
  const open = (await query(`SELECT count(*)::int AS n FROM threads WHERE kind = 'support' AND user_id = $1 AND status = 'open'`, [user.id])).rows[0].n;
  if (open >= LIMITS.openSupportMax) throw new InboxError('too_many_open');
  const thread = await tx(async (client) => {
    const t = (await client.query(`INSERT INTO threads (kind, user_id, subject) VALUES ('support', $1, $2) RETURNING *`, [user.id, subj])).rows[0];
    await addMessage(t.id, { senderId: user.id, role: 'user', body: text, data: source === 'contact' ? { source } : {} }, client);
    return t;
  });
  await markThreadRead(user.id, thread.id);
  tellAdmins('A new support conversation', user, subj, text, thread.id);
  return { id: thread.id };
}

async function postSupportMessage(user, thread, text) {
  const body = checkText(text, LIMITS.supportMin, LIMITS.supportMax);
  const m = await tx(async (client) => {
    // (a person writing again re-opens a closed conversation)
    await client.query(`UPDATE threads SET status = 'open' WHERE id = $1`, [thread.id]);
    return addMessage(thread.id, { senderId: user.id, role: 'user', body }, client);
  });
  await markThreadRead(user.id, thread.id);
  tellAdmins('A new message in a support conversation', user, thread.subject, body, thread.id);
  return messageView(m, user.id);
}

function tellAdmins(title, user, subject, body, threadId) {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  require('./notify').notifyAdmins(title,
    `<p>${esc(user.name)} (${esc(user.email)})${subject ? `: <strong>${esc(subject)}</strong>` : ''}</p><blockquote>${esc(body.slice(0, 600))}</blockquote>` +
    `<p>Answer it in the admin panel: ${esc(config.PUBLIC_URL)}/admin.html (Support tab, conversation ${esc(threadId)}).</p>`);
}

// Admins only (the routes check requireAdmin).
async function adminList({ status } = {}) {
  const { rows } = await query(
    `SELECT t.id, t.subject, t.status, t.last_message_at, t.created_at, u.id AS user_id, u.name, u.email, a.email AS assigned_email,
            lm.sender_role AS last_role, left(lm.body, 160) AS last_body
       FROM threads t JOIN users u ON u.id = t.user_id
       LEFT JOIN users a ON a.id = t.assigned_to
       LEFT JOIN LATERAL (SELECT sender_role, body FROM messages x WHERE x.thread_id = t.id AND x.kind = 'text' ORDER BY x.created_at DESC LIMIT 1) lm ON true
      WHERE t.kind = 'support' AND ($1::text IS NULL OR t.status = $1)
      ORDER BY (lm.sender_role = 'user') DESC, t.last_message_at DESC LIMIT 300`, [status || null]);
  return rows.map((r) => ({
    id: r.id, subject: r.subject, status: r.status, lastMessageAt: r.last_message_at, createdAt: r.created_at,
    user: { id: r.user_id, name: r.name, email: r.email }, assignedTo: r.assigned_email, waitingForUs: r.last_role === 'user', lastBody: r.last_body
  }));
}

async function adminThread(threadId) {
  const thread = await loadThread(threadId);
  if (!thread || thread.kind !== 'support') throw new InboxError('not_found');
  const [msgs, user, assigned] = await Promise.all([
    query(`SELECT m.*, u.email AS sender_email FROM messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.thread_id = $1 ORDER BY m.created_at, m.id`, [thread.id]),
    query('SELECT id, name, email, language FROM users WHERE id = $1', [thread.user_id]),
    thread.assigned_to ? query('SELECT email FROM users WHERE id = $1', [thread.assigned_to]) : { rows: [] }
  ]);
  return {
    thread: { id: thread.id, subject: thread.subject, status: thread.status, assignedTo: assigned.rows[0] ? assigned.rows[0].email : null, createdAt: thread.created_at },
    user: user.rows[0] || null,
    messages: msgs.rows.map((m) => ({ ...messageView(m, null), by: m.sender_role === 'support' || m.kind === 'internal_note' ? m.sender_email : null }))
  };
}

async function adminReply(admin, threadId, text, { internal = false } = {}) {
  const thread = await loadThread(threadId);
  if (!thread || thread.kind !== 'support') throw new InboxError('not_found');
  const body = checkText(text, LIMITS.supportMin, LIMITS.supportMax);
  const m = await addMessage(thread.id, { senderId: admin.id, role: 'support', kind: internal ? 'internal_note' : 'text', body });
  if (!internal) {
    await notifyUser(thread.user_id, 'support_reply', { threadId: thread.id });
    const { getUserById } = require('./models');
    require('./notify').notifySupportReply(await getUserById(thread.user_id), { body, threadId: thread.id });
  }
  return messageView(m, admin.id);
}

async function adminUpdate(admin, threadId, { status, assign } = {}) {
  const thread = await loadThread(threadId);
  if (!thread || thread.kind !== 'support') throw new InboxError('not_found');
  if (status !== undefined) {
    if (!['open', 'closed'].includes(status)) throw new InboxError('invalid_status');
    await query('UPDATE threads SET status = $2 WHERE id = $1', [thread.id, status]);
  }
  if (assign !== undefined) await query('UPDATE threads SET assigned_to = $2 WHERE id = $1', [thread.id, assign === 'me' ? admin.id : null]);
  return adminThread(thread.id);
}

// ---- Reports -------------------------------------------------------------------------------------------------------------------
async function reportMessage(user, messageId, { reason, details } = {}) {
  if (!REPORT_REASONS.includes(reason)) throw new InboxError('invalid_reason');
  if (!isUuid(messageId)) throw new InboxError('not_found');
  const m = (await query('SELECT * FROM messages WHERE id = $1', [messageId])).rows[0];
  if (!m || !['text', 'follow_up_question', 'follow_up_reply'].includes(m.kind)) throw new InboxError('not_found');
  if (!roleIn(await loadThread(m.thread_id), user.id)) throw new InboxError('not_found');
  if (m.sender_id === user.id) throw new InboxError('cannot_report_self');
  const note = typeof details === 'string' ? textSafety.cleanText(details).slice(0, LIMITS.reportDetailsMax) : null;
  const { rowCount } = await query(
    `INSERT INTO message_reports (message_id, reporter_id, reason, details) VALUES ($1, $2, $3, $4)
     ON CONFLICT (message_id, reporter_id) WHERE status = 'open' DO NOTHING`, [m.id, user.id, reason, note || null]);
  if (!rowCount) throw new InboxError('already_reported');
  require('./notify').notifyAdmins('A message was reported', `<p>Reason: ${reason}. See the admin panel, Support tab, "Reported messages".</p>`);
}

async function adminReports({ status = 'open' } = {}) {
  const { rows } = await query(
    `SELECT r.*, m.body, m.kind AS message_kind, m.thread_id, t.kind AS thread_kind, s.name AS sender_name, s.email AS sender_email,
            p.name AS reporter_name, p.email AS reporter_email
       FROM message_reports r JOIN messages m ON m.id = r.message_id JOIN threads t ON t.id = m.thread_id
       LEFT JOIN users s ON s.id = m.sender_id LEFT JOIN users p ON p.id = r.reporter_id
      WHERE r.status = $1 ORDER BY r.created_at DESC LIMIT 200`, [status]);
  return rows.map((r) => ({
    id: r.id, reason: r.reason, details: r.details, status: r.status, createdAt: r.created_at, resolution: r.resolution,
    message: { id: r.message_id, body: r.body, kind: r.message_kind, threadId: r.thread_id, threadKind: r.thread_kind },
    sender: { name: r.sender_name, email: r.sender_email }, reporter: { name: r.reporter_name, email: r.reporter_email }
  }));
}

async function resolveReport(admin, id, resolution) {
  const text = typeof resolution === 'string' ? resolution.trim() : '';
  if (text.length < 3) throw new InboxError('reason_required');
  if (!isUuid(id)) throw new InboxError('not_found');
  const { rowCount } = await query(`UPDATE message_reports SET status = 'resolved', resolution = $2, resolved_by = $3, resolved_at = now() WHERE id = $1 AND status = 'open'`,
    [id, text.slice(0, 500), admin.id]);
  if (!rowCount) throw new InboxError('not_found');
}

// ---- Notifications -------------------------------------------------------------------------------------------------------------
async function listNotifications(userId) {
  const { rows } = await query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60', [userId]);
  return rows.map((n) => ({ id: n.id, kind: n.kind, data: n.data || {}, threadId: n.thread_id, bookingId: n.booking_id, read: Boolean(n.read_at), createdAt: n.created_at }));
}
async function unreadCount(userId) {
  return (await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId])).rows[0].n;
}
async function markNotificationsRead(userId, ids) {
  if (Array.isArray(ids) && ids.length) {
    await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL', [userId, ids.filter(isUuid).slice(0, 200)]);
  } else {
    await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  }
}

// ---- Email settings and unsubscribe links --------------------------------------------------------------------------------------
async function emailSettings(userId) {
  const [{ rows }, who] = await Promise.all([
    query('SELECT email_off FROM notification_settings WHERE user_id = $1', [userId]),
    query('SELECT role FROM users WHERE id = $1', [userId])
  ]);
  const off = rows[0] ? rows[0].email_off : [];
  // (the application reminders are a mentor's only)
  const mentor = Boolean(who.rows[0]) && ['mentor', 'both'].includes(who.rows[0].role);
  return { optional: OPTIONAL_EMAILS.filter((key) => key !== 'apply_reminders' || mentor).map((key) => ({ key, on: !off.includes(key) })) };
}
async function setEmailOff(userId, off) {
  if (!Array.isArray(off) || off.some((k) => !OPTIONAL_EMAILS.includes(k))) throw new InboxError('not_optional');
  await query(`INSERT INTO notification_settings (user_id, email_off, updated_at) VALUES ($1, $2, now())
               ON CONFLICT (user_id) DO UPDATE SET email_off = EXCLUDED.email_off, updated_at = now()`, [userId, [...new Set(off)]]);
  return emailSettings(userId);
}
async function emailAllowed(userId, category) {
  if (!OPTIONAL_EMAILS.includes(category)) return true; // transactional
  const { rows } = await query('SELECT 1 FROM notification_settings WHERE user_id = $1 AND $2 = ANY(email_off)', [userId, category]);
  return rows.length === 0;
}
// A link that turns one category off without signing in. The token names the person and the category and is signed with the server
// key, so it cannot be made up; it carries no email address.
const sign = (payload) => crypto.createHmac('sha256', config.SESSION_SECRET).update('unsubscribe:' + payload).digest('base64url').slice(0, 32);
function unsubscribeToken(userId, category) {
  const payload = `${userId}.${category}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}
async function unsubscribe(token) {
  const [p, sig] = String(token || '').split('.');
  let payload;
  try { payload = Buffer.from(p || '', 'base64url').toString('utf8'); } catch (e) { throw new InboxError('invalid_token'); }
  const [userId, category] = payload.split('.');
  // (compared as bytes: a signature in another script has more bytes than characters, docs/REVIEW-2.md #9)
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(String(sig || ''));
  const good = got.length === want.length && crypto.timingSafeEqual(want, got);
  if (!good || !isUuid(userId) || !OPTIONAL_EMAILS.includes(category)) throw new InboxError('invalid_token');
  const { rows } = await query('SELECT email_off FROM notification_settings WHERE user_id = $1', [userId]);
  const off = new Set(rows[0] ? rows[0].email_off : []);
  off.add(category);
  await setEmailOff(userId, [...off]);
  return { category };
}
const unsubscribeUrl = (userId, category) => `${config.PUBLIC_URL}/unsubscribe.html?t=${encodeURIComponent(unsubscribeToken(userId, category))}`;

// ---- The follow-up reply deadline (the sweep, server/jobs.js) ---------------------------------------------------------------------
// A reminder to the mentor followUpReminderDays after the follow-up question if they have not replied; when the deadline passes without
// a reply, the asker is told in the thread (and may report it, server/disputes.js "mentor_ignored_follow_up") and the admins by email.
// Each step is claimed in one statement, so two sweeps never send it twice. Only for an answered booking (a refunded one has nothing left).
const WAITING = `follow_up_due_at IS NOT NULL AND follow_up_replied_at IS NULL AND follow_up_missed_at IS NULL
  AND EXISTS (SELECT 1 FROM bookings fb WHERE fb.id = threads.booking_id AND fb.status = 'answered')`;
async function followUpSweep() {
  const { getBookingById, getUserById } = require('./models');
  const notify = require('./notify');
  const { rows: remind } = await query(
    `UPDATE threads SET follow_up_reminded_at = now()
      WHERE ${WAITING} AND follow_up_reminded_at IS NULL AND follow_up_due_at > now() AND follow_up_due_at <= now() + make_interval(days => $1)
      RETURNING id, booking_id, follow_up_due_at`, [LIMITS.followUpReplyDays - LIMITS.followUpReminderDays]);
  for (const t of remind) {
    await safely('follow-up reminder', async () => {
      const booking = await getBookingById(t.booking_id);
      const [mentor, asker] = await Promise.all([getUserById(booking.mentorId), getUserById(booking.seekerId)]);
      if (mentor) await notify.notifyFollowUpReminder(mentor, { from: asker ? (require('./ageGate').isMinor(asker) ? firstName(asker.name) : asker.name) : '', dueAt: t.follow_up_due_at, threadId: t.id });
    });
  }
  const { rows: missed } = await query(
    `UPDATE threads SET follow_up_missed_at = now() WHERE ${WAITING} AND follow_up_due_at <= now() RETURNING id, booking_id, follow_up_missed_at`);
  for (const t of missed) {
    await safely('missed follow-up', async () => {
      const booking = await getBookingById(t.booking_id);
      await addMessage(t.id, { role: 'system', kind: 'event', event: 'follow_up_missed' });
      await notifyUser(booking.seekerId, 'follow_up_missed', { threadId: t.id, bookingId: booking.id });
      const [mentor, asker] = await Promise.all([getUserById(booking.mentorId), getUserById(booking.seekerId)]);
      const { rows: [q] } = await query(`SELECT body FROM messages WHERE thread_id = $1 AND kind = 'follow_up_question'`, [t.id]);
      const esc = require('./email').escapeHtml;
      const until = new Date(new Date(t.follow_up_missed_at).getTime() + LIMITS.followUpDisputeDays * 86400000);
      await notify.notifyAdmins('A mentor did not reply to a follow-up question',
        `<p>${esc(mentor ? mentor.name : '?')} (${esc(mentor ? mentor.email : '?')}) did not reply within ${LIMITS.followUpReplyDays} days to the follow-up question
         that ${esc(asker ? asker.name : 'the asker')} sent about booking ${esc(booking.id)}:</p><blockquote>${esc(q ? q.body.slice(0, 600) : '')}</blockquote>
         <p>The asker can report it until ${esc(until.toISOString().slice(0, 10))} (reason "mentor_ignored_follow_up"). The payout for the question is no
         longer held for the reply.</p><p>${esc(config.PUBLIC_URL)}/admin.html?tab=bookings</p>`);
    });
  }
  return { reminded: remind.length, missed: missed.length };
}

module.exports = {
  LIMITS, FOLLOW_UP_REPLY_DAYS, OPTIONAL_EMAILS, REPORT_REASONS, InboxError, followUpSweep,
  bookingThreadId, systemThreadId, addMessage, notifyUser,
  onPaid, onAnswered, onRefunded, onDeclined, onDisputeOpened, onDisputeResolved, onRatingRevealed, systemMessage,
  listThreads, threadFor, threadIdForBooking, markThreadRead, postMessage, startSupport,
  adminList, adminThread, adminReply, adminUpdate, reportMessage, adminReports, resolveReport,
  listNotifications, unreadCount, markNotificationsRead, emailSettings, setEmailOff, emailAllowed, unsubscribe, unsubscribeUrl, unsubscribeToken
};
