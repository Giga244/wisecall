const express = require('express');
const { requireAuth } = require('../auth');
const { asyncHandler } = require('../util');
const { getUserById, updateUser } = require('../models');
const config = require('../config');
const stripe = require('../stripeClient');

const router = express.Router();

router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  if (!config.STRIPE_ENABLED) return res.json({ enabled: false, payoutsReady: false });
  const user = await getUserById(req.userToken.id);
  if (!user || !user.stripeAccountId) return res.json({ enabled: true, payoutsReady: false });

  try {
    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    res.json({ enabled: true, payoutsReady: Boolean(account.charges_enabled), detailsSubmitted: account.details_submitted });
  } catch (err) {
    res.json({ enabled: true, payoutsReady: false, error: err.message });
  }
}));

router.post('/onboard', requireAuth, asyncHandler(async (req, res) => {
  if (!config.STRIPE_ENABLED) {
    return res.status(400).json({ error: 'stripe_not_configured', message: 'Add STRIPE_SECRET_KEY to .env to enable mentor payouts.' });
  }

  let user = await getUserById(req.userToken.id);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (user.role !== 'mentor' && user.role !== 'both') return res.status(400).json({ error: 'not_a_mentor' });

  try {
    if (!user.stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } }
      });
      user = await updateUser(user.id, { stripeAccountId: account.id });
    }

    const link = await stripe.accountLinks.create({
      account: user.stripeAccountId,
      refresh_url: `${config.APP_URL}/settings.html?connect=refresh`,
      return_url: `${config.APP_URL}/settings.html?connect=success`,
      type: 'account_onboarding'
    });
    res.json({ url: link.url });
  } catch (err) {
    res.status(502).json({ error: 'stripe_error', message: err.message });
  }
}));

module.exports = router;
