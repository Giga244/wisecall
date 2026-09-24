// Encrypts small secrets (mentors' IBANs) before they are stored in the database.
// AES-256-GCM with a random nonce per value; the key comes from DATA_ENCRYPTION_KEY.
// Format: "v1:<iv>:<tag>:<ciphertext>" (base64).
const crypto = require('crypto');
const config = require('./config');

// Any string works as the key material; it is stretched to 32 bytes.
const key = crypto.createHash('sha256').update(config.DATA_ENCRYPTION_KEY).digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

// Returns the original text, or null if the value is missing or cannot be decrypted
// (wrong key, tampering).
function decrypt(stored) {
  if (!stored) return null;
  const [version, iv, tag, data] = String(stored).split(':');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

// Files. Layout of the stored bytes: 12-byte nonce, 16-byte authentication tag, then the ciphertext.
function encryptBytes(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

// Returns the original bytes, or null if they cannot be decrypted (wrong key, tampering).
function decryptBytes(stored) {
  if (!stored || stored.length < 29) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, stored.subarray(0, 12));
    decipher.setAuthTag(stored.subarray(12, 28));
    return Buffer.concat([decipher.update(stored.subarray(28)), decipher.final()]);
  } catch (e) {
    return null;
  }
}

module.exports = { encrypt, decrypt, encryptBytes, decryptBytes };
