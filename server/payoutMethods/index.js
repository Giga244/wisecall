// How a withdrawal reaches a mentor's bank account. The mentor's side (the Balance card, "Withdraw") never changes; only this does.
//   manual      an admin sends the bank transfer by hand and records its reference in the admin panel (the fallback)
//   flitt_iban  an admin presses "Send payout" (with a code from their authenticator app); Flitt's IBAN withdrawal sends the money
//               (server/pay/flitt.js ibanCredit), and the request becomes paid once Flitt confirms it (server/withdrawals.js sendPayout)
// A method: { name, automatic, onRequested(batch) }; an automatic one also has send(batch, { iban, name }) and status(batch).
const config = require('../config');

const manual = {
  name: 'manual',
  automatic: false,
  async onRequested() { /* an admin is emailed and sees the request in the Payouts tab */ }
};

const flittIban = {
  name: 'flitt_iban',
  automatic: true,
  async onRequested() { /* the same: an admin sends it from the Payouts tab, with a code (every payout) */ },
  send(batch, { iban, name }) {
    return require('../pay/flitt').ibanCredit({
      orderId: batch.provider_order_id, amount: batch.amount, iban, receiverName: name, description: 'Wisecall payout',
      callbackUrl: `${config.PUBLIC_URL}/api/payments/flitt/payout-callback`
    });
  },
  status(batch) { return require('../pay/flitt').payoutStatus(batch.provider_order_id); }
};

const METHODS = { manual, flitt_iban: flittIban };
const AVAILABLE = Object.keys(METHODS);

function current() {
  const m = METHODS[config.PAYOUT_METHOD];
  if (!m) throw new Error(`PAYOUT_METHOD "${config.PAYOUT_METHOD}" is not available (use: ${AVAILABLE.join(', ')})`);
  return m;
}
// (a request remembers how it was sent, so switching PAYOUT_METHOD never strands one that is being sent)
const byName = (name) => METHODS[name] || current();

module.exports = { current, byName, AVAILABLE };
