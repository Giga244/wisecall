const express = require('express');
const { asyncHandler } = require('../util');
const mock = require('../pay/mock');

const router = express.Router();

// Endpoints behind the FAKE bank's payment page (public/mock-bank.html). Development only:
// index.js does not mount this router when NODE_ENV=production.
router.get('/orders/:id', (req, res) => {
  const o = mock.getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  res.json({ order: { id: o.orderId, amount: o.amount, status: o.status } });
});

router.post('/orders/:id/complete', asyncHandler(async (req, res) => {
  const outcome = req.body && req.body.outcome;
  if (!['success', 'fail', 'cancel'].includes(outcome)) return res.status(400).json({ error: 'invalid_outcome' });
  const redirect = await mock.complete(req.params.id, outcome);
  if (!redirect) return res.status(404).json({ error: 'not_found' });
  res.json({ redirect });
}));

module.exports = router;
