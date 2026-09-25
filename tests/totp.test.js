// The one-time codes of an authenticator app, checked against the RFCs' own test vectors.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../server/totp');

const RFC_SECRET = totp.base32(Buffer.from('12345678901234567890')); // the secret every RFC vector uses (ASCII "12345678901234567890")

describe('the codes', () => {
  test('RFC 4226 (HOTP): the ten codes for counters 0 to 9', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => assert.equal(totp.codeAt(RFC_SECRET, counter), code, `counter ${counter}`));
  });

  test('RFC 6238 (TOTP, SHA-1): the codes at the times in the RFC (its 8-digit values, last 6 digits)', () => {
    for (const [seconds, eight] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
      assert.equal(totp.code(RFC_SECRET, seconds * 1000), eight.slice(2), `at ${seconds}`);
    }
  });

  test('a code lasts 30 seconds, and always has six digits', () => {
    assert.equal(totp.PERIOD, 30);
    assert.equal(totp.stepAt(59_999), 1);
    assert.equal(totp.stepAt(60_000), 2);
    for (let i = 0; i < 200; i++) assert.match(totp.codeAt(RFC_SECRET, i), /^\d{6}$/); // (including ones that start with 0)
    assert.equal(totp.codeAt(RFC_SECRET, 1_037_037_036 + 0).length, 6);
  });
});

describe('secrets', () => {
  test('a new secret is 160 random bits as base32 (32 letters), and base32 round-trips', () => {
    const a = totp.newSecret(), b = totp.newSecret();
    assert.match(a, /^[A-Z2-7]{32}$/);
    assert.notEqual(a, b);
    assert.equal(totp.fromBase32(a).length, 20);
    assert.equal(totp.base32(totp.fromBase32(a)), a);
    assert.equal(totp.fromBase32('gezd gnbv-gy3t=').toString(), '123456789'.slice(0, 0) + totp.fromBase32('GEZDGNBVGY3T').toString(), 'spaces, dashes, padding and case are ignored');
    assert.throws(() => totp.fromBase32('not base32!'));
    assert.equal(totp.base32(Buffer.from('foobar')), 'MZXW6YTBOI'); // RFC 4648
  });

  test('the address in the QR code names the account and Wisecall, with the parameters an app needs', () => {
    const url = totp.otpauthUrl({ secret: 'JBSWY3DPEHPK3PXP', account: 'test.admin@example.com', issuer: 'Wisecall' });
    assert.equal(url, 'otpauth://totp/Wisecall:test.admin%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Wisecall&algorithm=SHA1&digits=6&period=30');
  });
});

describe('checking what was typed', () => {
  const now = 1_700_000_010_000;
  const step = totp.stepAt(now);

  test('the current code is accepted, and so is one step either side (a phone clock a little off); two steps away is not', () => {
    assert.equal(totp.verify(RFC_SECRET, totp.codeAt(RFC_SECRET, step), { ms: now }), step);
    assert.equal(totp.verify(RFC_SECRET, totp.codeAt(RFC_SECRET, step - 1), { ms: now }), step - 1);
    assert.equal(totp.verify(RFC_SECRET, totp.codeAt(RFC_SECRET, step + 1), { ms: now }), step + 1);
    assert.equal(totp.verify(RFC_SECRET, totp.codeAt(RFC_SECRET, step + 2), { ms: now }), null);
    assert.equal(totp.verify(RFC_SECRET, totp.codeAt(RFC_SECRET, step - 2), { ms: now }), null);
  });

  test('a step that was already used is not accepted again (a code works once), but a later one is', () => {
    const code = totp.codeAt(RFC_SECRET, step);
    assert.equal(totp.verify(RFC_SECRET, code, { ms: now, afterStep: step }), null);
    assert.equal(totp.verify(RFC_SECRET, code, { ms: now, afterStep: step - 1 }), step);
    assert.equal(totp.verify(RFC_SECRET, totp.codeAt(RFC_SECRET, step + 1), { ms: now, afterStep: step }), step + 1);
  });

  test('anything that is not six digits is refused, spaces are ignored, and a wrong code is refused', () => {
    const code = totp.codeAt(RFC_SECRET, step);
    assert.equal(totp.verify(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { ms: now }), step);
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34', null, undefined, 123456, ['123456'], { a: 1 }]) assert.equal(totp.verify(RFC_SECRET, bad, { ms: now }), null, String(bad));
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    assert.equal(totp.verify(RFC_SECRET, wrong, { ms: now, window: 0 }), null);
  });
});
