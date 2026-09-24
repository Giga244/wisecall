// Georgian IBANs: "GE" + 2 check digits + 2-letter bank code + 16 digits = 22 characters,
// for example GE29NB0000000101904917. The check digits are verified with the ISO 7064 mod-97 rule.

function normalize(input) {
  return String(input || '').replace(/[\s-]+/g, '').toUpperCase();
}

function mod97(iban) {
  // Move the first four characters to the end, turn letters into numbers (A=10 ... Z=35),
  // and the remainder of the resulting big number divided by 97 must be 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

function isValidGeorgianIban(input) {
  const iban = normalize(input);
  return /^GE\d{2}[A-Z]{2}\d{16}$/.test(iban) && mod97(iban);
}

// "GE29 NB00 0000 0101 9049 17" -> "GE29 •••• •••• •••• •••• 4917"
function mask(iban) {
  const n = normalize(iban);
  return n ? `${n.slice(0, 4)} •••• •••• •••• •••• ${n.slice(-4)}` : '';
}

// Groups of four, for showing a full IBAN to its owner or an admin.
const pretty = (iban) => normalize(iban).replace(/(.{4})/g, '$1 ').trim();

module.exports = { normalize, isValidGeorgianIban, mask, pretty };
