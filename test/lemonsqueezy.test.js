const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.DB_HOST ||= '127.0.0.1';
process.env.DB_USER ||= 'test';
process.env.DB_NAME ||= 'test';

const lemonSqueezy = require('../config/lemonsqueezy');
const {
  normalizeSubscriptionStatus,
  getOrderAmountUsd,
  getReferralBasisUsd
} = require('../controllers/webhookController');

test('Lemon Squeezy webhook signature validates the exact raw payload', () => {
  const secret = 'test-secret';
  const payload = Buffer.from('{"meta":{"event_name":"order_created"}}');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  assert.equal(lemonSqueezy.verifyWebhookSignature(payload, signature, secret), true);
  assert.equal(lemonSqueezy.verifyWebhookSignature(Buffer.from(`${payload} `), signature, secret), false);
  assert.equal(lemonSqueezy.verifyWebhookSignature(payload, 'not-a-signature', secret), false);
  assert.equal(lemonSqueezy.verifyWebhookSignature(payload, signature, ''), false);
});

test('Configured variant IDs map to one product unambiguously', () => {
  process.env.LEMONSQUEEZY_VARIANT_STARTER = '101';
  process.env.LEMONSQUEEZY_VARIANT_TOPUP_500 = '201';
  assert.equal(lemonSqueezy.getProductByVariantId('101'), 'starter');
  assert.equal(lemonSqueezy.getProductByVariantId('201'), 'topup500');
  assert.equal(lemonSqueezy.getProductByVariantId('unknown'), null);
});

test('Duplicate variant configuration is rejected as ambiguous', () => {
  process.env.LEMONSQUEEZY_VARIANT_PRO = process.env.LEMONSQUEEZY_VARIANT_STARTER;
  assert.equal(lemonSqueezy.getProductByVariantId('101'), null);
  delete process.env.LEMONSQUEEZY_VARIANT_PRO;
});

test('Subscriptions retain access until Lemon Squeezy reports expiration', () => {
  for (const status of ['on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled']) {
    assert.equal(normalizeSubscriptionStatus(status), 'active');
  }
  assert.equal(normalizeSubscriptionStatus('expired'), 'expired');
});

test('Order totals use USD cents and affiliate commissions exclude tax and discounts', () => {
  const attributes = {
    currency: 'EUR',
    total: 1300,
    total_usd: 1400,
    subtotal_usd: 1200,
    discount_total_usd: 200
  };
  assert.equal(getOrderAmountUsd(attributes), 14);
  assert.equal(getReferralBasisUsd(attributes, 14), 10);
  assert.equal(getOrderAmountUsd({ currency: 'USD', total: 900 }), 9);
});

test('Checkout uses API credentials, configured store/variant, and per-user custom data', async () => {
  const previousFetch = global.fetch;
  const previousEnv = {
    apiKey: process.env.LEMONSQUEEZY_API_KEY,
    storeId: process.env.LEMONSQUEEZY_STORE_ID,
    appUrl: process.env.APP_URL
  };
  process.env.LEMONSQUEEZY_API_KEY = 'test-api-key';
  process.env.LEMONSQUEEZY_STORE_ID = '77';
  process.env.APP_URL = 'https://flexiparse.example';

  let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      json: async () => ({ data: { attributes: { url: 'https://test-store.lemonsqueezy.com/checkout/buy/101' } } })
    };
  };

  try {
    const checkoutUrl = await lemonSqueezy.createCheckout({
      variantId: '101',
      email: 'user@example.com',
      name: 'Test User',
      userId: 12,
      type: 'subscription',
      plan: 'starter'
    });

    assert.equal(checkoutUrl, 'https://test-store.lemonsqueezy.com/checkout/buy/101');
    assert.equal(request.url, 'https://api.lemonsqueezy.com/v1/checkouts');
    assert.equal(request.options.headers.authorization, 'Bearer test-api-key');
    assert.equal(request.body.data.relationships.store.data.id, '77');
    assert.equal(request.body.data.relationships.variant.data.id, '101');
    assert.deepEqual(request.body.data.attributes.checkout_data.custom, {
      user_id: '12',
      product_type: 'subscription',
      plan: 'starter'
    });
    assert.equal(request.body.data.attributes.product_options.redirect_url, 'https://flexiparse.example/dashboard?payment=success');
  } finally {
    global.fetch = previousFetch;
    if (previousEnv.apiKey === undefined) delete process.env.LEMONSQUEEZY_API_KEY;
    else process.env.LEMONSQUEEZY_API_KEY = previousEnv.apiKey;
    if (previousEnv.storeId === undefined) delete process.env.LEMONSQUEEZY_STORE_ID;
    else process.env.LEMONSQUEEZY_STORE_ID = previousEnv.storeId;
    if (previousEnv.appUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousEnv.appUrl;
  }
});
