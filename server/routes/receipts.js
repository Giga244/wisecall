// Receipts (the asker, or an admin) and mentors' monthly statements, as PDF (and statements as CSV too). ?lang=ka|en picks the
// language; otherwise the account's.
const express = require('express');
const { requireAuth } = require('../auth');
const { isVerifiedAdmin } = require('../adminAuth');
const { asyncHandler } = require('../util');
const { getUserById } = require('../models');
const receipts = require('../receipts');

const router = express.Router();
const langOf = (req, user) => (['ka', 'en'].includes(req.query.lang) ? req.query.lang : (user && user.language) || 'en');

router.get('/receipts/:id.pdf', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  // (any receipt for an admin, but only after the second step in this session: docs/security-audit C2)
  const r = await receipts.loadFor(user, req.params.id, { admin: isVerifiedAdmin(user, req.userToken) });
  if (!r) return res.status(404).json({ error: 'not_found' });
  const body = await receipts.receiptPdf(r, langOf(req, user));
  res.set('Cache-Control', 'private, no-store');
  res.type('application/pdf').attachment(`wisecall-${receipts.numberOf(r.number)}.pdf`).send(body);
}));

const isMentor = (u) => u && (u.role === 'mentor' || u.role === 'both');

router.get('/me/statements', requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!isMentor(user)) return res.json({ months: [] });
  res.json({ months: await receipts.statementMonths(user.id) });
}));

router.get(/^\/me\/statements\/(\d{4}-\d{2})\.(csv|pdf)$/, requireAuth, asyncHandler(async (req, res) => {
  const user = await getUserById(req.userToken.id);
  if (!isMentor(user)) return res.status(404).json({ error: 'not_found' });
  const [month, format] = [req.params[0], req.params[1]];
  const s = await receipts.statement(user.id, month);
  if (!s) return res.status(404).json({ error: 'not_found' });
  const lang = langOf(req, user);
  res.set('Cache-Control', 'private, no-store');
  if (format === 'csv') return res.type('text/csv; charset=utf-8').attachment(`wisecall-statement-${month}.csv`).send(receipts.statementCsv(s, lang));
  res.type('application/pdf').attachment(`wisecall-statement-${month}.pdf`).send(await receipts.statementPdf(s, user.name, lang));
}));

module.exports = router;
