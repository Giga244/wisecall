// Payout ledger (mentor earnings). Filled in by the payouts work; these hooks are called by the
// payment code whenever a booking is answered or refunded.
async function onAnswered() { /* records the mentor's earnings */ }
async function onRefundRequested() { /* voids or flags the mentor's earnings */ }

module.exports = { onAnswered, onRefundRequested };