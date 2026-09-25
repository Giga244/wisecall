// Profile photos. Whatever is uploaded (JPG, PNG or WebP, at most 5 MB) is checked by its first bytes, turned upright,
// cropped to a square, resized to 512 x 512 and re-encoded as WebP. Re-encoding drops everything else in the file:
// EXIF (camera, place, time), embedded thumbnails, colour profiles, comments. What is stored is only the picture.
const sharp = require('sharp');
const config = require('./config');

const MAX_BYTES = 5 * 1024 * 1024;
const SIZE = 512;
const MAX_INPUT_PIXELS = 50_000_000; // refuses "image bombs" (a tiny file that expands into gigapixels)

class ImageError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// What the file really is, from its first bytes, whatever the browser or the file name says.
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

async function processPhoto(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new ImageError('empty_file');
  if (buf.length > MAX_BYTES) throw new ImageError('file_too_large');
  if (!sniff(buf)) throw new ImageError('unsupported_image_type');
  try {
    const data = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate() // uses the EXIF orientation once, then the EXIF is gone
      .resize(SIZE, SIZE, { fit: 'cover', position: sharp.strategy.attention })
      .webp({ quality: 82 })
      .toBuffer();
    return { data, mime: 'image/webp', width: SIZE, height: SIZE };
  } catch (e) {
    throw new ImageError('invalid_image');
  }
}

// A picture from Google's servers (the person's Google account photo), fetched once when they sign up. Only Google's
// own image hosts are ever fetched.
const GOOGLE_HOST = /(^|\.)(googleusercontent\.com|ggpht\.com)$/i;
async function fetchGooglePhoto(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  // (Outside production the fake Google of the tests may serve the picture from its own address.)
  const testHost = !config.IS_PROD && u.origin === new URL(config.GOOGLE_ISSUER).origin;
  if (!testHost && (u.protocol !== 'https:' || !GOOGLE_HOST.test(u.hostname))) return null;
  u.search = '';
  // Google's picture addresses end in a size hint such as "=s96-c": ask for a larger one, we resize it ourselves.
  if (!testHost) u.pathname = u.pathname.replace(/=[swh]\d+(-[a-z0-9-]+)?$/i, '') + '=s512-c';
  try {
    const res = await fetch(u.toString(), { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await processPhoto(buf);
  } catch (e) {
    return null; // a missing photo is not a reason to fail a sign-in
  }
}

module.exports = { processPhoto, fetchGooglePhoto, ImageError, sniff, MAX_BYTES, SIZE };
