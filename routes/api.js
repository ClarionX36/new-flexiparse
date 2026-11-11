const express = require('express');
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');
const { requireAuth, requireCsrf } = require('../middleware/authMiddleware');
const { verifyRecaptcha } = require('../middleware/recaptcha');
const { upload, verifyFileSignature } = require('../middleware/upload');
const parse = require('../controllers/parseController');
const users = require('../controllers/userController');

const router = express.Router();
const extractionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Batas ekstraksi tercapai. Silakan coba lagi dalam 15 menit.' }
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
    if (!process.env.STRIPE_SECRET_KEY) return res.status(503).json({ error: 'Pembayaran belum dikonfigurasi.' });
    if (!process.env.APP_URL) return res.status(503).json({ error: 'APP_URL belum dikonfigurasi untuk Stripe Checkout.' });
    const Stripe = require('stripe');
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const { type, plan, pages } = req.body;
    let priceId;
    let metadata;
    if (type === 'subscription' && ['starter', 'pro', 'scale'].includes(plan)) {
      if (req.user.subscription_status === 'active' && req.user.plan_tier !== 'free') {
        return res.status(409).json({ error: 'Anda sudah memiliki paket berbayar aktif. Hubungi dukungan untuk mengubah paket agar tidak membuat langganan ganda.' });
      }
      priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];
      metadata = { type, plan, userId: String(req.user.id) };
    } else if (type === 'topup' && [500, 1500].includes(Number(pages))) {
      if (!['starter', 'pro', 'scale'].includes(req.user.plan_tier) || req.user.subscription_status !== 'active') {
        return res.status(403).json({ error: 'Top-up hanya tersedia untuk pelanggan berbayar aktif.' });
      }
      priceId = process.env[`STRIPE_PRICE_TOPUP_${Number(pages)}`];
      metadata = { type, pages: String(pages), userId: String(req.user.id) };
    } else {
      return res.status(400).json({ error: 'Produk pembayaran tidak valid.' });
    }
    if (!priceId) return res.status(503).json({ error: 'Price ID Stripe untuk produk ini belum dikonfigurasi.' });
    const session = await stripe.checkout.sessions.create({
      mode: type === 'subscription' ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/dashboard?payment=success`,
      cancel_url: `${process.env.APP_URL}/dashboard?payment=cancelled`,
      client_reference_id: String(req.user.id),
      customer_email: req.user.email,
      metadata,
      subscription_data: type === 'subscription' ? { metadata } : undefined
    });
    return res.json({ url: session.url });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
