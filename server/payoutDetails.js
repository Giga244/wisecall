// A mentor's payout details: the account holder's full name and a Georgian IBAN. Never needed to be shown on the site; a mentor adds
// them in Settings → ანაზღაურება at any time, or right at their first withdrawal (server/withdrawals.js), with the same checks either way:
//   clean()      the name is a full name (two words, 5 to 100 characters), the IBAN is a valid Georgian one
//   nameFitsId() the account holder is the person on the verified ID (null: no approved ID check to compare with yet)
//   saveFirst()  the first details an account saves (a change of saved details has its own rules: server/routes/me.js)
const { isValidGeorgianIban, normalize } = require('./iban');
const { encrypt } = require('./cryptoBox');
const { updateUser } = require('./models');

// -> { name, iban } as they are stored, or { error: 'missing_fields' | 'invalid_payout_name' | 'invalid_iban' }
function clean(input) {
  const { name, iban } = input || {};
  if (typeof name !== 'string' || typeof iban !== 'string') return { error: 'missing_fields' };
  const cleanName = name.trim().replace(/\s+/g, ' ');
  if (cleanName.length < 5 || cleanName.length > 100 || !cleanName.includes(' ')) return { error: 'invalid_payout_name' };
  if (!isValidGeorgianIban(iban)) return { error: 'invalid_iban' };
  return { name: cleanName, iban: normalize(iban) };
}

// Whether this account holder's name matches the name on the mentor's verified ID: true | false | null (no verified ID name on record).
async function nameFitsId(userId, name) {
  const idName = await require('./verification/kyc').verifiedNameFor(userId);
  if (!idName) return null;
  return Boolean(require('./verification/names').compareNames(idName, name).match);
}

// The first payout details of an account (cleaned by clean()). -> the updated user
async function saveFirst(user, { name, iban }) {
  const updated = await updateUser(user.id, { payoutName: name, payoutIbanEnc: encrypt(iban), payoutIbanLast4: iban.slice(-4), payoutUpdatedAt: new Date() });
  // (the account holder's name is compared with the name on the ID: a mismatch is flagged, as from Settings)
  await require('./verification/names').recompute(user.id);
  return updated;
}

module.exports = { clean, nameFitsId, saveFirst };
