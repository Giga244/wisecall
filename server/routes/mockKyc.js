const express = require('express');
const { asyncHandler } = require('../util');
const mock = require('../kyc/mock');

const router = express.Router();

// Endpoints behind the FAKE ID-check page (public/mock-kyc.html). Development only: index.js does
// not mount this router in production.
router.get('/sessions/:id', (req, res) => {
  const s = mock.getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not_found' });
  res.json({ session: { id: s.sessionId, status: s.status } });
});

router.post('/sessions/:id/complete', asyncHandler(async (req, res) => {
  const { outcome, fullName, dateOfBirth, country } = req.body || {};
  if (!['approve', 'decline', 'review'].includes(outcome)) return res.status(400).json({ error: 'invalid_outcome' });
  if (outcome !== 'decline' && (typeof fullName !== 'string' || !fullName.trim())) return res.status(400).json({ error: 'missing_fields' });
  const redirect = await mock.complete(req.params.id, {
    outcome, fullName: String(fullName || '').trim(), dateOfBirth: String(dateOfBirth || '1990-01-01'), country: String(country || 'GEO')
  });
  if (!redirect) return res.status(404).json({ error: 'not_found' });
  res.json({ redirect });
}));

module.exports = router;