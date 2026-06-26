const crypto = require('crypto');

// AES-256-GCM encryption for secrets at rest (Plaid access tokens).
// TOKEN_ENC_KEY must be a 64-char hex string (32 bytes). Stored values are
// prefixed so we can tell encrypted from legacy plaintext and migrate safely.
const PREFIX = 'enc:v1:';

function getKey() {
  const hex = process.env.TOKEN_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENC_KEY must be set to a 64-char hex string (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext) {
  if (plaintext == null) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(stored) {
  if (stored == null) return stored;
  const s = String(stored);
  if (!s.startsWith(PREFIX)) return s; // legacy plaintext — return as-is
  const [ivB, tagB, ctB] = s.slice(PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}

// True if the stored value is already encrypted (used by the migration)
function isEncrypted(stored) {
  return stored != null && String(stored).startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted };
