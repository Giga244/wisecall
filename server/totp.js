// Time-based one-time passwords (RFC 6238, with RFC 4226 HMAC-SHA1 codes): the 6-digit codes an authenticator app shows, changing every 30 seconds.
// Written with node's crypto only. Tested against the RFC's own test vectors (tests/totp.test.js).
const crypto = require('crypto');

const PERIOD = 30;   // seconds a code lasts
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// A new secret: 20 random bytes (160 bits, the size HMAC-SHA1 wants), as the base32 text an authenticator app takes.
const newSecret = () => base32(crypto.randomBytes(20));

function base32(buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text) {
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of String(text).toUpperCase().replace(/[\s=-]/g, '')) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
}

// The 30-second step a moment belongs to.
const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / PERIOD);

// The code for one step (HOTP over the step number).
function codeAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

const code = (secret, ms = Date.now()) => codeAt(secret, stepAt(ms));

// Checks what was typed against the steps around now (one step either side: a phone clock a little off). Returns the step that matched, or
// null. `afterStep` is the last step already used: a step at or before it does not count, so one code cannot be used twice.
function verify(secret, typed, { ms = Date.now(), window = 1, afterStep = null } = {}) {
  const given = String(typed || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return null;
  const now = stepAt(ms);
  for (let step = now - window; step <= now + window; step += 1) {
    if (afterStep !== null && afterStep !== undefined && step <= Number(afterStep)) continue;
    const want = codeAt(secret, step);
    if (want.length === given.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(given))) return step;
  }
  return null;
}

// The address an authenticator app reads from the QR code.
function otpauthUrl({ secret, account, issuer }) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`;
}

module.exports = { newSecret, base32, fromBase32, stepAt, codeAt, code, verify, otpauthUrl, PERIOD, DIGITS };
