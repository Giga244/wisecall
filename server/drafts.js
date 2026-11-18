// Drafts: what a signed-in person has typed into a long text field and not saved yet, kept on the server so it is never lost (the page
// keeps its own copy in the browser too: public/js/drafts.js). A draft is private to its owner, never shown to anyone else, never
// checked or changed (it is exactly what was typed), encrypted at rest, and deleted when the text is saved, when the account is deleted
// (server/account.js), or by itself after KEEP_DAYS days.
//   key    which field: "question:<mentor id>", "answer:<booking id>", "story" (My path, About and the sample answer in Settings),
//          "apply-story" (the same form on the application), "bio" (About me on the Profile tab)
//   value  the text (or the form's values as JSON), up to MAX_CHARS characters
//   base   optional: what the server had saved when the draft was typed (the page restores a draft only over that)
const { query } = require('./db');
const { encrypt, decrypt } = require('./cryptoBox');

const KEEP_DAYS = 60;
const MAX_CHARS = 12000; // (the longest field, an answer, is 8000)
const MAX_PER_USER = 40;
const KEY = /^(?:(?:question|answer):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|story|apply-story|bio)$/i;

class DraftError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const cleanKey = (key) => { if (typeof key !== 'string' || !KEY.test(key)) throw new DraftError('invalid_draft_key'); return key.toLowerCase(); };

async function get(userId, key) {
  const { rows } = await query('SELECT value_enc, base, updated_at FROM user_drafts WHERE user_id = $1 AND key = $2', [userId, cleanKey(key)]);
  if (!rows[0]) return null;
  return { value: decrypt(rows[0].value_enc), base: rows[0].base, updatedAt: rows[0].updated_at };
}

// An empty text is no draft: it removes the one that was there.
async function put(userId, key, value, base) {
  const k = cleanKey(key);
  if (typeof value !== 'string') throw new DraftError('invalid_draft');
  if ([...value].length > MAX_CHARS || (base !== undefined && base !== null && (typeof base !== 'string' || base.length > MAX_CHARS * 2))) throw new DraftError('draft_too_long');
  if (!value.trim()) { await remove(userId, k); return null; }
  await query(
    `INSERT INTO user_drafts (user_id, key, value_enc, base, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id, key) DO UPDATE SET value_enc = EXCLUDED.value_enc, base = EXCLUDED.base, updated_at = now()`,
    [userId, k, encrypt(value), base === undefined ? null : base]);
  // (at most MAX_PER_USER drafts a person: the oldest go)
  await query(
    `DELETE FROM user_drafts WHERE user_id = $1 AND key IN (SELECT key FROM user_drafts WHERE user_id = $1 ORDER BY updated_at DESC OFFSET $2)`, [userId, MAX_PER_USER]);
  return { ok: true };
}

async function remove(userId, key) {
  await query('DELETE FROM user_drafts WHERE user_id = $1 AND key = $2', [userId, cleanKey(key)]);
}

// Housekeeping (server/jobs.js): drafts nobody came back to.
async function sweep() {
  const r = await query(`DELETE FROM user_drafts WHERE updated_at < now() - make_interval(days => $1)`, [KEEP_DAYS]);
  return r.rowCount;
}

module.exports = { get, put, remove, sweep, DraftError, KEEP_DAYS, MAX_CHARS, MAX_PER_USER };
