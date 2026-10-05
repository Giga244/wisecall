// A live session's cover picture: the same upload rules as profile photos (JPG, PNG or WebP, at most 5 MB, checked by its first
// bytes, EXIF and everything else dropped by re-encoding), but landscape, 1200 x 630 (the size social networks show).
const sharp = require('sharp');
const { query } = require('../db');
const { ImageError, sniff, MAX_BYTES } = require('../images');
const { LiveError } = require('./sessions');

const W = 1200;
const H = 630;

async function process(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new ImageError('empty_file');
  if (buf.length > MAX_BYTES) throw new ImageError('file_too_large');
  if (!sniff(buf)) throw new ImageError('unsupported_image_type');
  try {
    const data = await sharp(buf, { limitInputPixels: 50_000_000, failOn: 'error' }).rotate()
      .resize(W, H, { fit: 'cover', position: sharp.strategy.attention }).webp({ quality: 80 }).toBuffer();
    return { data, mime: 'image/webp' };
  } catch (e) { throw new ImageError('invalid_image'); }
}

async function owned(user, sessionId) {
  const { rows: [s] } = await query('SELECT * FROM live_sessions WHERE id = $1', [sessionId]);
  if (!s || s.mentor_id !== user.id) throw new LiveError('not_found');
  if (['ended', 'cancelled'].includes(s.status)) throw new LiveError('not_editable');
  return s;
}

async function set(user, sessionId, buf) {
  const s = await owned(user, sessionId);
  let img;
  try { img = await process(buf); } catch (e) {
    if (e instanceof ImageError) throw new LiveError(e.code);
    throw e;
  }
  await query(`INSERT INTO live_session_covers (session_id, mime, data) VALUES ($1, $2, $3)
               ON CONFLICT (session_id) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = now()`, [s.id, img.mime, img.data]);
  return { ok: true, coverUrl: `/api/live-covers/${s.id}.webp?v=${Date.now().toString(36)}` };
}
async function remove(user, sessionId) {
  const s = await owned(user, sessionId);
  await query('DELETE FROM live_session_covers WHERE session_id = $1', [s.id]);
  return { ok: true };
}

// The picture itself (public for published sessions; the mentor sees their drafts' too).
async function get(sessionId, viewerId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) return null;
  const { rows: [r] } = await query(
    `SELECT c.mime, c.data, c.updated_at FROM live_session_covers c JOIN live_sessions s ON s.id = c.session_id
      WHERE c.session_id = $1 AND (s.status IN ('published', 'live', 'ended', 'cancelled') OR s.mentor_id = $2)`, [sessionId, viewerId || null]);
  return r || null;
}

module.exports = { set, remove, get, process, W, H };
