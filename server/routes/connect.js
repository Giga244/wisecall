const express = require('express');
const { requireAuth } = require('../auth');
const { asyncHandler } = require('../util');
const { getUserById, updateUser } = require('../models');
const { accountIsReady } = require('../payments');
const config = require('../config');
const stripe = require('../stripeClient');

const router = express.Router();

// Asks Stripe for the current state of the mentor's payout account and stores the result, so
// the listing rules (mentors are only public once they can be paid) use fresh information.
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  if (!config.STRIPE_ENABLED) return res.json({ enabled: false, payoutsReady: false });
  const user = await getUserById(req.userToken.id);
  if (!user || !user.stripeAccountId) return res.json({ enabled: true, payoutsReady: false });

  try {
    const account = await stripe.accounts.retrieve(user.stripeAccountId);
    const ready = accountIsReady(account);
    if (ready !== user.payoutsEnabled) await updateUser(user.id, { payoutsEnabled: ready });
    res.json({ enabled: true, payoutsReady: ready, detailsSubmitted: Boolean(account.details_submitted) });
  } catch (err) {
    console.error('[connect] status lookup failed:', err.message);
    res.json({ enabled: true, payoutsReady: Boolean(user.payoutsEnabled) });
  }
}));

router.post('/onboard', requireAuth, asyncHandler(async (req, res) => {
  if (!config.STRIPE_ENABLED) {
    return res.status(400).json({ error: 'stripe_not_configured', message: 'Add STRIPE_SECRET_KEY to .env to enable mentor payouts.' });
  }

  let user = await getUserById(req.userToken.id);
  if (!user) return res.status(401).json({ error: 'not_authenticated' });
  if (user.role !== 'mentor' && user.role !== 'both') return res.status(400).json({ error: 'not_a_mentor' });
  // Only approved mentors may onboard, so we never hand payout accounts to unvetted applicants.
  if (user.verificationStatus !== 'verified') return res.status(400).json({ error: 'not_verified' });

  try {
    if (!user.stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        // Funds are held by the platform and transferred to the mentor, so they only need transfers.
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: { userId: user.id },
        ...(config.STRIPE_CROSS_BORDER_PAYOUTS ? { tos_acceptance: { service_agreement: 'recipient' } } : {})
      }, { idempotencyKey: `account-${user.id}` });
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
    console.error('[connect] onboarding failed:', err.message);
    res.status(502).json({ error: 'stripe_error', message: 'Could not start payout setup. Please try again.' });
  }
}));

module.exports = router;
