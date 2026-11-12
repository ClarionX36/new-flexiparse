const express = require('express');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { requireAuth, requireCsrf } = require('../middleware/authMiddleware');
const { verifyRecaptcha } = require('../middleware/recaptcha');
const { upload, verifyFileSignature } = require('../middleware/upload');
const parse = require('../controllers/parseController');
const users = require('../controllers/userController');
const { createCheckout, getProductByVariantId, getVariantId } = require('../config/lemonsqueezy');

const router = express.Router();
const extractionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Extraction limit reached. Please try again in 15 minutes.' }
});

router.get('/me', (req, res) => {
  if (req.isAuthenticated?.()) {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    return res.json({
      authenticated: true,
      csrfToken: req.session.csrfToken,
      user: {
        id: req.user.id, name: req.user.name, email: req.user.email,
        avatar: req.user.avatar, planTier: req.user.plan_tier
      },
      recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || ''
    });
  }
  return res.json({ authenticated: false, recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || '' });
});

router.get('/dashboard', requireAuth, users.dashboard);
router.get('/extractions/:id', requireAuth, parse.getExtractionStatus);
router.get('/tables', requireAuth, parse.listTables);
router.get('/tables/:id', requireAuth, parse.getTable);
router.post('/extract', requireAuth, requireCsrf, extractionLimiter, verifyRecaptcha, upload.single('document'), verifyFileSignature, parse.uploadAndExtract);
router.put('/tables/:id', requireAuth, requireCsrf, parse.updateTable);
router.delete('/tables/:id', requireAuth, requireCsrf, parse.deleteTable);
router.get('/tables/:id/export', requireAuth, parse.exportTable);
router.put('/referral-reward', requireAuth, requireCsrf, users.setReferralReward);
router.post('/payouts', requireAuth, requireCsrf, users.requestPayout);

router.post('/checkout', requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const { type, plan, pages } = req.body;
    let product;
    if (type === 'subscription' && ['starter', 'pro', 'scale'].includes(plan)) {
      if (req.user.subscription_status === 'active' && req.user.plan_tier !== 'free') {
        return res.status(409).json({ error: 'You already have an active paid plan. Contact support to change your plan and avoid creating a duplicate subscription.' });
      }
      product = plan;
    } else if (type === 'topup' && [500, 1500].includes(Number(pages))) {
      if (!['starter', 'pro', 'scale'].includes(req.user.plan_tier) || req.user.subscription_status !== 'active') {
        return res.status(403).json({ error: 'Top-ups are only available to active paid subscribers.' });
      }
      product = `topup${Number(pages)}`;
    } else {
      return res.status(400).json({ error: 'Invalid payment product.' });
    }
    const variantId = getVariantId(product);
    if (!variantId || getProductByVariantId(variantId) !== product) {
      return res.status(503).json({ error: `A unique Lemon Squeezy variant has not been configured for ${product}.` });
    }
    const url = await createCheckout({
      variantId,
      email: req.user.email,
      name: req.user.name,
      userId: req.user.id,
      type,
      plan: type === 'subscription' ? plan : undefined,
      pages: type === 'topup' ? Number(pages) : undefined
    });
    return res.json({ url });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
