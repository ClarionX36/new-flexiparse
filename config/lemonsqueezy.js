const PRODUCT_ENV = {
  starter: 'LEMONSQUEEZY_VARIANT_STARTER',
  pro: 'LEMONSQUEEZY_VARIANT_PRO',
  scale: 'LEMONSQUEEZY_VARIANT_SCALE',
  topup500: 'LEMONSQUEEZY_VARIANT_TOPUP_500',
  topup1500: 'LEMONSQUEEZY_VARIANT_TOPUP_1500'
};

function getVariantId(product) {
  const variable = PRODUCT_ENV[product];
  if (!variable) return null;
  return process.env[variable]?.trim() || null;
}

function getProductByVariantId(variantId) {
  if (!variantId) return null;
  const matches = [];
  for (const [product, variable] of Object.entries(PRODUCT_ENV)) {
    const configuredId = process.env[variable]?.trim();
    if (configuredId && configuredId === String(variantId)) matches.push(product);
  }
  return matches.length === 1 ? matches[0] : null;
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !secret) return false;
  const expected = require('crypto').createHmac('sha256', secret).update(rawBody).digest();
  if (!/^[\da-f]{64}$/i.test(signature)) return false;
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && require('crypto').timingSafeEqual(supplied, expected);
}

async function createCheckout({ variantId, email, name, userId, type, plan, pages }) {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  const appUrl = process.env.APP_URL;
  if (!apiKey || !storeId || !appUrl) {
    throw Object.assign(new Error('Pembayaran Lemon Squeezy belum dikonfigurasi. Periksa API key, store ID, dan APP_URL.'), { status: 503 });
  }

  const custom = { user_id: String(userId), product_type: type };
  if (plan) custom.plan = plan;
  if (pages) custom.pages = String(pages);

  const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: {
      accept: 'application/vnd.api+json',
      'content-type': 'application/vnd.api+json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      data: {
        type: 'checkouts',
        attributes: {
          test_mode: process.env.LEMONSQUEEZY_TEST_MODE === 'true',
          checkout_data: { email, name: name || undefined, custom },
          checkout_options: { locale: 'id' },
          product_options: { redirect_url: `${appUrl}/dashboard?payment=success` }
        },
        relationships: {
          store: { data: { type: 'stores', id: String(storeId) } },
          variant: { data: { type: 'variants', id: String(variantId) } }
        }
      }
    })
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    console.error('[FlexiParse] Lemon Squeezy checkout failed with status:', response.status);
    throw Object.assign(
      new Error('Checkout Lemon Squeezy gagal dibuat. Periksa konfigurasi produk dan coba lagi.'),
      { status: 502 }
    );
  }

  const url = result?.data?.attributes?.url;
  let checkoutUrl;
  try {
    checkoutUrl = new URL(url);
  } catch (error) {
    throw Object.assign(new Error('Lemon Squeezy mengembalikan tautan checkout yang tidak valid.'), { status: 502 });
  }
  if (checkoutUrl.protocol !== 'https:' || checkoutUrl.username || checkoutUrl.password) {
    throw Object.assign(new Error('Lemon Squeezy mengembalikan tautan checkout yang tidak aman.'), { status: 502 });
  }
  return checkoutUrl.href;
}

module.exports = { createCheckout, getProductByVariantId, getVariantId, verifyWebhookSignature };
