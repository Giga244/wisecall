// How a withdrawal reaches a mentor's bank account. The mentor's side (the Balance card, "Withdraw") never changes; only this does.
//   manual    now: an admin sends the bank transfer by hand and records its reference in the admin panel
//   bank_api  later: the bank's API sends the transfer when an admin approves the request
//   split     later: a payment provider (Payze, Flitt) splits each payment at the source, so the mentor's part never reaches Wisecall
// A method: { name, automatic, onRequested(batch) } (automatic methods would also send(batch) and report the bank reference).
const config = require('../config');

const manual = {
  name: 'manual',
  automatic: false,
  async onRequested() { /* an admin is emailed and sees the request in the Payouts tab */ }
};

const METHODS = { manual };
const AVAILABLE = Object.keys(METHODS);

function current() {
  const m = METHODS[config.PAYOUT_METHOD];
  if (!m) throw new Error(`PAYOUT_METHOD "${config.PAYOUT_METHOD}" is not available (use: ${AVAILABLE.join(', ')})`);
  return m;
}

module.exports = { current, AVAILABLE };
