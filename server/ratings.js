// Two-way ratings.
//   - After a paid question is answered, the ASKER rates the MENTOR (1-5 stars, tags, a written review) and the MENTOR rates
//     the ASKER (1-5 stars for "a clear, respectful question", tags, an optional private note to the Wisecall team).
//   - Double-blind: neither sees the other's rating until BOTH have rated, or 7 days after the answer became readable for the
//     buyer (after the probation check, when there is one), whichever comes first. Until then a rating can be edited; after
//     that it cannot. Ratings can be given for 30 days after the answer became readable.
//   - Only the two people in a paid, answered booking can rate, once each.
//   - What is public: a mentor's average, count, tag counts and written reviews (the mentor may reply once). An asker's average
//     is never shown under 3 ratings; from 3 on it is a friendly badge and their top tags.
//   - An admin can hide a review with a written reason; anybody signed in can report one; low averages open a flag for admins.
const { query, tx } = require('./db');
const flags = require('./verification/flags');
const notify = require('./notify');
const { getUserById } = require('./models');
const { photoUrl } = require('./util');

const DAY = 86400000;
const REVEAL_DAYS = 7;
const WINDOW_DAYS = 30;
const LIMITS = { review: 1000, note: 1000, reply: 1000, details: 1000, tags: 4, askerBadgeMinRatings: 3, askerLowAverage: 2.5, askerLowMinRatings: 3 };
const TAGS = {
  asker_to_mentor: ['helpful', 'detailed', 'clear', 'fast'],
  mentor_to_asker: ['clear_question', 'gave_context', 'respectful', 'thankful']
};
const REPORT_REASONS = ['abusive', 'false', 'personal_info', 'spam', 'other'];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// When the buyer could first read the answer: after the probation release when there was one, otherwise when it was sent.
const VISIBLE_AT = 'COALESCE(b.answer_released_at, b.answered_at)';

class RatingError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// ---- Rules -----------------------------------------------------------------------------------------------------------
const rateable = (b) => Boolean(b) && b.status === 'answered' && Boolean(b.answeredAt) && !['held', 'rejected'].includes(b.answerReview);

function timing(b) {
  const visibleAt = new Date(b.answerReleasedAt || b.answeredAt);
  return { visibleAt, revealsAt: new Date(+visibleAt + REVEAL_DAYS * DAY), closesAt: new Date(+visibleAt + WINDOW_DAYS * DAY) };
}

// Text typed by a person: no control characters (line breaks stay), no more than one blank line in a row.
const clean = (v) => String(v).replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();

function validate(direction, input) {
  const stars = typeof input.stars === 'string' && /^\d$/.test(input.stars) ? Number(input.stars) : input.stars;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new RatingError('invalid_rating');
  const tags = input.tags === undefined || input.tags === null ? [] : input.tags;
  if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string') || tags.length > LIMITS.tags) throw new RatingError('invalid_tags');
  const unique = [...new Set(tags)];
  if (unique.some((t) => !TAGS[direction].includes(t))) throw new RatingError('invalid_tags');
  for (const f of ['review', 'privateNote']) {
    const v = input[f];
    if (v !== undefined && v !== null && typeof v !== 'string') throw new RatingError('invalid_field');
  }
  let review = null, privateNote = null;
  if (direction === 'asker_to_mentor') {
    if (input.privateNote) throw new RatingError('invalid_field');
    review = clean(input.review || '');
    if (review.length > LIMITS.review) throw new RatingError('review_too_long');
  } else {
    if (input.review) throw new RatingError('invalid_field');
    privateNote = clean(input.privateNote || '');
    if (privateNote.length > LIMITS.note) throw new RatingError('note_too_long');
  }
  return { stars, tags: unique, review: review || null, privateNote: privateNote || null };
}

// ---- Giving a rating -------------------------------------------------------------------------------------------------
async function afterReveal(rows) {
  const monitoring = require('./verification/monitoring');
  for (const r of rows) {
    if (!r.hidden_at) require('./inbox').onRatingRevealed(r.booking_id, r.ratee_id); // (the notification centre)
    try {
      if (r.direction === 'asker_to_mentor') await monitoring.afterReview(r.ratee_id);
      else await afterAskerRating(r.ratee_id);
    } catch (e) { console.error('[ratings] follow-up after a reveal failed:', e.message); }
  }
}

// Creates or (while it is still hidden) changes the rating of `user` for this booking.
async function submit({ booking, user, input }) {
  const isAsker = booking.seekerId === user.id, isMentor = booking.mentorId === user.id;
  if (!isAsker && !isMentor) throw new RatingError('forbidden');
  if (!rateable(booking)) throw new RatingError('not_rateable');
  const when = timing(booking);
  if (Date.now() > +when.closesAt) throw new RatingError('window_closed');
  const direction = isAsker ? 'asker_to_mentor' : 'mentor_to_asker';
  const v = validate(direction, input || {});
  const ratee = isAsker ? booking.mentorId : booking.seekerId;

  const revealed = [];
  const mine = await tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [booking.id]); // the two people can submit at the same moment
    const { rows } = await client.query(
      `INSERT INTO ratings (booking_id, direction, rater_id, ratee_id, stars, tags, review, private_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (booking_id, direction) DO UPDATE
         SET stars = EXCLUDED.stars, tags = EXCLUDED.tags, review = EXCLUDED.review, private_note = EXCLUDED.private_note, edited_at = now()
         WHERE ratings.revealed_at IS NULL
       RETURNING *`,
      [booking.id, direction, user.id, ratee, v.stars, v.tags, v.review, v.privateNote]
    );
    if (!rows[0]) throw new RatingError('already_revealed'); // it cannot be changed after it was revealed
    let row = rows[0];
    const other = await client.query('SELECT 1 FROM ratings WHERE booking_id = $1 AND direction <> $2', [booking.id, direction]);
    if (other.rowCount || Date.now() >= +when.revealsAt) { // both have rated, or the 7 days are over
      const r = await client.query('UPDATE ratings SET revealed_at = now() WHERE booking_id = $1 AND revealed_at IS NULL RETURNING *', [booking.id]);
      revealed.push(...r.rows);
      row = r.rows.find((x) => x.id === row.id) || row;
    }
    return row;
  });
  await afterReveal(revealed);
  return mine;
}

// Ratings whose 7 days are over (or whose pair is complete) become visible. Called by the sweep job and before ratings are read.
async function revealDue(bookingId) {
  const { rows } = await query(
    `UPDATE ratings r SET revealed_at = now() FROM bookings b
      WHERE r.booking_id = b.id AND r.revealed_at IS NULL AND ($2::uuid IS NULL OR r.booking_id = $2)
        AND (${VISIBLE_AT} + make_interval(days => $1) <= now() OR (SELECT count(*) FROM ratings x WHERE x.booking_id = r.booking_id) = 2)
      RETURNING r.*`,
    [REVEAL_DAYS, bookingId || null]
  );
  await afterReveal(rows);
  return rows.length;
}

// ---- What a person sees of their booking -----------------------------------------------------------------------------
// The tags and stars of the OTHER person's rating are only ever included once it is revealed (and not hidden by an admin).
function viewFor(booking, rows, viewerId) {
  const asker = booking.seekerId === viewerId;
  const mineDir = asker ? 'asker_to_mentor' : 'mentor_to_asker';
  const mine = rows.find((r) => r.direction === mineDir);
  const theirs = rows.find((r) => r.direction !== mineDir);
  const when = booking.answeredAt ? timing(booking) : null;
  const open = rateable(booking) && when && Date.now() <= +when.closesAt;
  const theirsVisible = theirs && theirs.revealed_at && !theirs.hidden_at;
  return {
    role: asker ? 'asker' : 'mentor',
    rateable: rateable(booking),
    canRate: Boolean(open && (!mine || !mine.revealed_at)),
    revealsAt: when ? when.revealsAt : null,
    closesAt: when ? when.closesAt : null,
    mine: mine ? {
      id: mine.id, stars: mine.stars, tags: mine.tags, submittedAt: mine.submitted_at, revealed: Boolean(mine.revealed_at), hidden: Boolean(mine.hidden_at),
      ...(asker ? { review: mine.review } : { privateNote: mine.private_note }),
      ...(asker && mine.reply ? { reply: mine.reply } : {})
    } : null,
    theirs: theirsVisible ? {
      id: theirs.id, stars: theirs.stars, tags: theirs.tags, submittedAt: theirs.submitted_at,
      ...(asker ? {} : { review: theirs.review, reply: theirs.reply || null }) // a mentor sees the written review; an asker sees stars and tags only
    } : null
  };
}

async function rowsFor(bookingIds) {
  if (!bookingIds.length) return new Map();
  const { rows } = await query(
    `SELECT r.*, rp.body AS reply FROM ratings r LEFT JOIN review_replies rp ON rp.rating_id = r.id AND rp.hidden_at IS NULL WHERE r.booking_id = ANY($1::uuid[])`, [bookingIds]
  );
  const map = new Map();
  rows.forEach((r) => { if (!map.has(r.booking_id)) map.set(r.booking_id, []); map.get(r.booking_id).push(r); });
  return map;
}

async function forBooking(booking, viewerId) {
  await revealDue(booking.id);
  const rows = (await rowsFor([booking.id])).get(booking.id) || [];
  return viewFor(booking, rows, viewerId);
}

// For the dashboard lists: adds `rating` (what this person sees) to each booking, and for a mentor the asker's rating.
async function attach(bookings, viewerId, role) {
  await revealDue();
  const map = await rowsFor(bookings.map((b) => b.id));
  const askers = role === 'mentor' ? await askerStatsFor([...new Set(bookings.map((b) => b.seekerId))]) : null;
  return bookings.map((b) => ({
    ...b,
    rating: viewFor(b, map.get(b.id) || [], viewerId),
    ...(askers ? { askerRating: askerView(askers[b.seekerId], false) } : {})
  }));
}

// ---- Numbers ---------------------------------------------------------------------------------------------------------
// Only ratings that are revealed, not hidden by an admin, and belong to a booking that stayed answered (not refunded) count.
const COUNTED = `r.revealed_at IS NOT NULL AND r.hidden_at IS NULL AND b.status = 'answered'`;

async function statsFor(ids, direction) {
  const out = {};
  ids.forEach((id) => { out[id] = { count: 0, avg: null, tags: {}, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }; });
  if (!ids.length) return out;
  const [nums, tags] = await Promise.all([
    query(`SELECT r.ratee_id, r.stars, count(*)::int AS n FROM ratings r JOIN bookings b ON b.id = r.booking_id
            WHERE r.direction = $1 AND r.ratee_id = ANY($2::uuid[]) AND ${COUNTED} GROUP BY r.ratee_id, r.stars`, [direction, ids]),
    query(`SELECT r.ratee_id, tag, count(*)::int AS n FROM ratings r JOIN bookings b ON b.id = r.booking_id, unnest(r.tags) AS tag
            WHERE r.direction = $1 AND r.ratee_id = ANY($2::uuid[]) AND ${COUNTED} GROUP BY r.ratee_id, tag`, [direction, ids])
  ]);
  nums.rows.forEach((r) => { out[r.ratee_id].distribution[r.stars] = r.n; });
  for (const id of ids) {
    const d = out[id].distribution;
    out[id].count = Object.values(d).reduce((a, b) => a + b, 0);
    out[id].avg = out[id].count ? Math.round((Object.entries(d).reduce((a, [s, n]) => a + Number(s) * n, 0) / out[id].count) * 10) / 10 : null;
  }
  tags.rows.forEach((r) => { out[r.ratee_id].tags[r.tag] = r.n; });
  return out;
}
const mentorStats = (ids) => statsFor(ids, 'asker_to_mentor');
const askerStatsFor = (ids) => statsFor(ids, 'mentor_to_asker');

const topTags = (tags, n = 3) => Object.entries(tags || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([tag, count]) => ({ tag, count }));

// What is shown of an asker's rating. `publicView` = on their profile: nothing under 3 ratings, then a friendly badge and top tags.
// (A mentor sees the same numbers on the question in their dashboard, from the first rating on.)
function askerView(s, publicView) {
  if (!s || !s.count) return null;
  if (publicView && s.count < LIMITS.askerBadgeMinRatings) return null;
  return { avg: s.avg, count: s.count, great: s.avg >= 4.5, topTags: topTags(s.tags) };
}
async function askerBadge(userId) {
  return askerView((await askerStatsFor([userId]))[userId], true);
}

async function afterAskerRating(askerId) {
  const s = (await askerStatsFor([askerId]))[askerId];
  if (s.count >= LIMITS.askerLowMinRatings && s.avg !== null && s.avg < LIMITS.askerLowAverage) {
    if (await flags.openFlag(askerId, 'asker_low_rating', { average: s.avg, ratings: s.count })) {
      const asker = await getUserById(askerId);
      notify.notifyAdmins('An asker has a low rating', `<p>${esc(asker.name)} (${esc(asker.email)}) has an average rating of ${s.avg} from ${s.count} mentors. Please have a look in the Reviews tab of the admin panel.</p>`);
    }
  }
}

// ---- A mentor's public reviews -----------------------------------------------------------------------------------------
async function reviewsForMentor(mentorId, limit = 100) {
  await revealDue();
  const { rows } = await query(
    `SELECT r.id, r.stars, r.tags, r.review, r.submitted_at, u.id AS uid, u.name, u.color, u.username, u.photo_updated_at, u.profile_visibility,
            rp.body AS reply, rp.created_at AS reply_at
       FROM ratings r JOIN bookings b ON b.id = r.booking_id JOIN users u ON u.id = r.rater_id
       LEFT JOIN review_replies rp ON rp.rating_id = r.id AND rp.hidden_at IS NULL
      WHERE r.ratee_id = $1 AND r.direction = 'asker_to_mentor' AND ${COUNTED} AND r.review IS NOT NULL AND r.review <> ''
      ORDER BY r.revealed_at DESC, r.submitted_at DESC LIMIT $2`, [mentorId, limit]
  );
  return rows.map((r) => ({
    id: r.id, stars: r.stars, tags: r.tags, review: r.review, at: r.submitted_at,
    // an asker whose profile is private is shown as "Anonymous asker"
    reviewer: r.profile_visibility === 'public' && r.username
      ? { name: r.name, username: r.username, color: r.color, photoUrl: photoUrl({ id: r.uid, photoUpdatedAt: r.photo_updated_at }) } : null,
    reply: r.reply ? { body: r.reply, at: r.reply_at } : null
  }));
}

async function mentorSummary(mentorId) {
  await revealDue();
  const s = (await mentorStats([mentorId]))[mentorId];
  return { avg: s.avg, count: s.count, tags: s.tags, distribution: s.distribution };
}

// ---- The mentor's public reply, and reports --------------------------------------------------------------------------------
async function reply(ratingId, mentor, body) {
  const text = clean(body === undefined || body === null ? '' : body);
  if (typeof body !== 'string' || !text) throw new RatingError('empty');
  if (text.length > LIMITS.reply) throw new RatingError('too_long');
  if (!/^[0-9a-f-]{36}$/i.test(String(ratingId))) throw new RatingError('not_found');
  const { rows } = await query('SELECT * FROM ratings WHERE id = $1', [ratingId]);
  const r = rows[0];
  if (!r || r.direction !== 'asker_to_mentor') throw new RatingError('not_found');
  if (r.ratee_id !== mentor.id) throw new RatingError('forbidden');
  if (!r.revealed_at || r.hidden_at) throw new RatingError('not_available');
  const done = await query('INSERT INTO review_replies (rating_id, mentor_id, body) VALUES ($1, $2, $3) ON CONFLICT (rating_id) DO NOTHING RETURNING rating_id', [r.id, mentor.id, text]);
  if (!done.rowCount) throw new RatingError('already_replied'); // once only
  return { body: text };
}

async function report({ reporter, ratingId, reason, details }) {
  if (!REPORT_REASONS.includes(reason)) throw new RatingError('invalid_reason');
  const text = details === undefined || details === null ? '' : clean(details);
  if (typeof details !== 'undefined' && details !== null && typeof details !== 'string') throw new RatingError('invalid_field');
  if (text.length > LIMITS.details) throw new RatingError('details_too_long');
  if (!/^[0-9a-f-]{36}$/i.test(String(ratingId))) throw new RatingError('not_found');
  const { rows } = await query('SELECT * FROM ratings WHERE id = $1', [ratingId]);
  const r = rows[0];
  // Only what the reporter can see: a revealed, visible review; not their own; a private mentor-to-asker rating only by the asker it is about.
  if (!r || !r.revealed_at || r.hidden_at || r.rater_id === reporter.id || (r.direction === 'mentor_to_asker' && r.ratee_id !== reporter.id)) throw new RatingError('not_found');
  try {
    await query('INSERT INTO review_reports (rating_id, reporter_id, reason, details) VALUES ($1, $2, $3, $4)', [r.id, reporter.id, reason, text || null]);
  } catch (e) {
    if (e.code === '23505') throw new RatingError('already_reported');
    throw e;
  }
  notify.notifyAdmins('A review was reported', `<p>A review was reported (${esc(reason)}). Open the Reviews tab of the admin panel.</p>`);
}

// ---- Admin -------------------------------------------------------------------------------------------------------------
async function adminOverview() {
  const [reports, hidden, askers] = await Promise.all([
    query(`SELECT p.*, r.stars, r.tags, r.review, r.direction, r.hidden_at, ru.name AS rater_name, ru.email AS rater_email, eu.name AS ratee_name, eu.email AS ratee_email,
                  pu.name AS reporter_name, pu.email AS reporter_email, rp.body AS reply
             FROM review_reports p JOIN ratings r ON r.id = p.rating_id JOIN users ru ON ru.id = r.rater_id JOIN users eu ON eu.id = r.ratee_id JOIN users pu ON pu.id = p.reporter_id
             LEFT JOIN review_replies rp ON rp.rating_id = r.id
            WHERE p.status = 'open' ORDER BY p.created_at LIMIT 200`),
    query(`SELECT r.id, r.stars, r.review, r.direction, r.hidden_at, ru.name AS rater_name, eu.name AS ratee_name,
                  (SELECT a.reason FROM rating_audit a WHERE a.rating_id = r.id AND a.action = 'hidden' ORDER BY a.created_at DESC LIMIT 1) AS reason,
                  (SELECT a.by_email FROM rating_audit a WHERE a.rating_id = r.id AND a.action = 'hidden' ORDER BY a.created_at DESC LIMIT 1) AS by_email
             FROM ratings r JOIN users ru ON ru.id = r.rater_id JOIN users eu ON eu.id = r.ratee_id WHERE r.hidden_at IS NOT NULL ORDER BY r.hidden_at DESC LIMIT 50`),
    query(`SELECT f.id, f.detail, f.created_at, u.id AS user_id, u.name, u.email FROM mentor_flags f JOIN users u ON u.id = f.mentor_id
            WHERE f.kind = 'asker_low_rating' AND f.status = 'open' ORDER BY f.created_at`)
  ]);
  return {
    reports: reports.rows.map((p) => ({
      id: p.id, ratingId: p.rating_id, reason: p.reason, details: p.details, createdAt: p.created_at,
      reporter: { name: p.reporter_name, email: p.reporter_email },
      rating: { stars: p.stars, tags: p.tags, review: p.review, direction: p.direction, reply: p.reply, rater: { name: p.rater_name, email: p.rater_email }, ratee: { name: p.ratee_name, email: p.ratee_email } }
    })),
    hidden: hidden.rows.map((h) => ({ id: h.id, stars: h.stars, review: h.review, direction: h.direction, hiddenAt: h.hidden_at, reason: h.reason, by: h.by_email, rater: h.rater_name, ratee: h.ratee_name })),
    askers: askers.rows.map((f) => ({ flagId: f.id, userId: f.user_id, name: f.name, email: f.email, average: f.detail.average, ratings: f.detail.ratings, createdAt: f.created_at }))
  };
}

const needReason = (reason) => {
  const text = String(reason || '').trim();
  if (text.length < 5) throw new RatingError('reason_required');
  return text.slice(0, 1000);
};
const audit = (ratingId, action, admin, reason) =>
  query('INSERT INTO rating_audit (rating_id, action, by_email, reason) VALUES ($1, $2, $3, $4)', [ratingId, action, admin.email, reason]);

// Takes a review down (it disappears from the profile and from the numbers). Open reports about it are closed with the same reason.
async function hide(ratingId, admin, reason) {
  const text = needReason(reason);
  if (!/^[0-9a-f-]{36}$/i.test(String(ratingId))) throw new RatingError('not_found');
  const { rows } = await query('UPDATE ratings SET hidden_at = now() WHERE id = $1 AND hidden_at IS NULL RETURNING *', [ratingId]);
  if (!rows[0]) throw new RatingError('not_found');
  await audit(ratingId, 'hidden', admin, text);
  await query(`UPDATE review_reports SET status = 'resolved', resolution = 'hidden', resolution_note = $2, resolved_by = $3, resolved_at = now() WHERE rating_id = $1 AND status = 'open'`, [ratingId, text, admin.id]);
  return rows[0];
}
async function unhide(ratingId, admin, reason) {
  const text = needReason(reason);
  if (!/^[0-9a-f-]{36}$/i.test(String(ratingId))) throw new RatingError('not_found');
  const { rows } = await query('UPDATE ratings SET hidden_at = NULL WHERE id = $1 AND hidden_at IS NOT NULL RETURNING *', [ratingId]);
  if (!rows[0]) throw new RatingError('not_found');
  await audit(ratingId, 'unhidden', admin, text);
  return rows[0];
}
async function resolveReport(reportId, admin, decision, reason) {
  if (!['dismiss', 'hide'].includes(decision)) throw new RatingError('invalid_decision');
  const text = needReason(reason);
  if (!/^[0-9a-f-]{36}$/i.test(String(reportId))) throw new RatingError('not_found');
  const { rows } = await query(`SELECT rating_id FROM review_reports WHERE id = $1 AND status = 'open'`, [reportId]);
  if (!rows[0]) throw new RatingError('not_found');
  if (decision === 'hide') return hide(rows[0].rating_id, admin, text);
  await query(`UPDATE review_reports SET status = 'resolved', resolution = 'dismissed', resolution_note = $2, resolved_by = $3, resolved_at = now() WHERE id = $1`, [reportId, text, admin.id]);
  await audit(rows[0].rating_id, 'report_dismissed', admin, text);
  return null;
}

// ---- Reminder emails ("please rate"), after 2 and after 6 days ------------------------------------------------------------
// Sent once per person per kind, only to a person who has not rated yet and while the rating window is open. A reminder that
// is overdue for both kinds (the server was off) is sent once, as the last one.
async function sendReminders() {
  let sent = 0;
  for (const [kind, days] of [['d6', 6], ['d2', 2]]) {
    for (const [party, direction, whoCol, otherCol] of [['asker', 'asker_to_mentor', 'seeker_id', 'mentor_id'], ['mentor', 'mentor_to_asker', 'mentor_id', 'seeker_id']]) {
      const { rows } = await query(
        `SELECT b.* FROM bookings b
          WHERE b.status = 'answered' AND b.answer_review IS DISTINCT FROM 'held' AND b.answer_review IS DISTINCT FROM 'rejected' AND b.answered_at IS NOT NULL
            AND ${VISIBLE_AT} + make_interval(days => $1) <= now() AND ${VISIBLE_AT} + make_interval(days => $2) > now()
            AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.booking_id = b.id AND r.direction = $3)
            AND NOT EXISTS (SELECT 1 FROM rating_reminders x WHERE x.booking_id = b.id AND x.party = $4 AND x.kind = $5)
          ORDER BY b.answered_at LIMIT 50`, [days, WINDOW_DAYS, direction, party, kind]
      );
      for (const b of rows) {
        // Claim it first, so two servers can never send the same reminder twice.
        const claimed = await query(`INSERT INTO rating_reminders (booking_id, party, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING booking_id`, [b.id, party, kind]);
        if (!claimed.rowCount) continue;
        if (kind === 'd6') await query(`INSERT INTO rating_reminders (booking_id, party, kind) VALUES ($1, $2, 'd2') ON CONFLICT DO NOTHING`, [b.id, party]);
        const [person, other] = await Promise.all([getUserById(b[whoCol]), getUserById(b[otherCol])]);
        if (!person || !other) continue;
        const when = timing({ answeredAt: b.answered_at, answerReleasedAt: b.answer_released_at });
        notify.notifyRateReminder(person, { role: party, name: other.name, revealsAt: when.revealsAt, final: kind === 'd6' });
        sent += 1;
      }
    }
  }
  return sent;
}

module.exports = {
  RatingError, TAGS, LIMITS, REPORT_REASONS, REVEAL_DAYS, WINDOW_DAYS, VISIBLE_AT,
  rateable, timing, submit, revealDue, forBooking, attach,
  mentorStats, askerStatsFor, askerBadge, askerView, topTags, afterAskerRating, mentorSummary, reviewsForMentor,
  reply, report, adminOverview, hide, unhide, resolveReport, sendReminders
};
