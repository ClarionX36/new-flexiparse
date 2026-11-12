const db = require('../config/db');
const { tiers } = require('./userController');
const { getProductByVariantId, verifyWebhookSignature } = require('../config/lemonsqueezy');

function lemonSqueezyWebhook(req, res, next) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !process.env.LEMONSQUEEZY_STORE_ID) {
    return res.status(503).send('Lemon Squeezy webhook is not configured.');
  }
  if (secret.length < 6 || secret.length > 40) {
    return res.status(503).send('The Lemon Squeezy signing secret must be 6–40 characters long.');
  }
  if (!verifyWebhookSignature(req.body, req.get('x-signature'), secret)) {
    return res.status(401).send('Invalid webhook signature.');
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (error) {
    return res.status(400).send('Invalid webhook payload.');
  }
  const eventName = req.get('x-event-name') || payload.meta?.event_name;
  processEvent(eventName, payload).then(() => res.json({ received: true })).catch(next);
}

async function processEvent(eventName, payload) {
  if (eventName === 'order_created') {
    await processOrder(payload);
  } else if ([
    'subscription_created',
    'subscription_updated',
    'subscription_resumed',
    'subscription_unpaused',
    'subscription_cancelled',
    'subscription_paused',
    'subscription_expired'
  ].includes(eventName)) {
    await updateSubscription(eventName, payload);
  }
}

async function processOrder(payload) {
  const orderId = payload.data?.id;
  const attributes = payload.data?.attributes;
  const customData = payload.meta?.custom_data || {};
  const userId = Number(customData.user_id);
  const product = getProductByVariantId(attributes?.first_order_item?.variant_id);
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!orderId || !attributes || !userId || !product) {
    throw new Error('Lemon Squeezy order is missing a configured store, product, or user ID.');
  }
  if (storeId && String(attributes.store_id) !== String(storeId)) {
    throw new Error(`Lemon Squeezy order ${orderId} belongs to an unexpected store.`);
  }
  if (attributes.status !== 'paid') return;

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const paymentId = `lemonsqueezy:order:${orderId}`;
    const [seen] = await connection.execute('SELECT id FROM transactions WHERE payment_id = ?', [paymentId]);
    if (seen.length) {
      await connection.commit();
      return;
    }
    const [users] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [userId]);
    const user = users[0];
    if (!user) throw new Error(`Lemon Squeezy order ${orderId} references unknown user ${userId}.`);
    const [duplicate] = await connection.execute('SELECT id FROM transactions WHERE payment_id = ?', [paymentId]);
    if (duplicate.length) {
      await connection.commit();
      return;
    }

    const amountUsd = getOrderAmountUsd(attributes);
    const referralBasisUsd = getReferralBasisUsd(attributes, amountUsd);
    if (['starter', 'pro', 'scale'].includes(product)) {
      await connection.execute(
        'UPDATE users SET plan_tier = ?, subscription_status = ?, monthly_quota_remaining = ? WHERE id = ?',
        [product, 'active', tiers[product].pages, userId]
      );
      await connection.execute(
        'INSERT INTO transactions (user_id, payment_id, type, amount, item_description) VALUES (?, ?, ?, ?, ?)',
        [userId, paymentId, 'subscription', amountUsd, `${product} subscription`]
      );
      await awardReferral(connection, user, referralBasisUsd, true);
    } else {
      const pages = product === 'topup500' ? 500 : 1500;
      if (!['starter', 'pro', 'scale'].includes(user.plan_tier) || user.subscription_status !== 'active') {
        throw Object.assign(new Error('Top-up order belongs to an account without an active paid plan.'), { status: 409 });
      }
      await connection.execute(
        'UPDATE users SET add_on_quota_remaining = add_on_quota_remaining + ? WHERE id = ?',
        [pages, userId]
      );
      await connection.execute(
        'INSERT INTO transactions (user_id, payment_id, type, amount, item_description) VALUES (?, ?, ?, ?, ?)',
        [userId, paymentId, 'topup', amountUsd, `${pages} page top-up`]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function getOrderAmountUsd(attributes) {
  const totalInCents = attributes.total_usd ?? (attributes.currency === 'USD' ? attributes.total : NaN);
  const amount = Number(totalInCents);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Lemon Squeezy order has an invalid USD total.');
  return amount / 100;
}

function getReferralBasisUsd(attributes, fallback) {
  const subtotal = Number(attributes.subtotal_usd);
  if (!Number.isFinite(subtotal) || subtotal < 0) return fallback;
  const discount = Number(attributes.discount_total_usd || 0);
  if (!Number.isFinite(discount) || discount < 0) return fallback;
  return Math.max(0, subtotal - discount) / 100;
}

async function awardReferral(connection, referredUser, amountUsd, subscriptionOrder) {
  if (!subscriptionOrder || !referredUser.referred_by_id || amountUsd <= 0) return;
  const [referrers] = await connection.execute(
    'SELECT referral_reward_choice FROM users WHERE id = ? FOR UPDATE',
    [referredUser.referred_by_id]
  );
  const referrer = referrers[0];
  if (!referrer) return;

  if (referrer.referral_reward_choice === 'credits' && !referredUser.referred_rewarded_at) {
    await connection.execute(
      'UPDATE users SET add_on_quota_remaining = add_on_quota_remaining + 300 WHERE id = ?',
      [referredUser.referred_by_id]
    );
    await connection.execute(
      'UPDATE users SET referred_rewarded_at = CURRENT_TIMESTAMP WHERE id = ?',
      [referredUser.id]
    );
  } else if (referrer.referral_reward_choice === 'cash') {
    await connection.execute(
      'UPDATE users SET affiliate_balance = affiliate_balance + ? WHERE id = ?',
      [Math.round(amountUsd * 20) / 100, referredUser.referred_by_id]
    );
    if (!referredUser.referred_rewarded_at) {
      await connection.execute(
        'UPDATE users SET referred_rewarded_at = CURRENT_TIMESTAMP WHERE id = ?',
        [referredUser.id]
      );
    }
  }
}

function normalizeSubscriptionStatus(status) {
  return status === 'expired' ? 'expired' : 'active';
}

async function updateSubscription(eventName, payload) {
  const attributes = payload.data?.attributes;
  const subscriptionId = payload.data?.id;
  if (!attributes || !subscriptionId) throw new Error('Lemon Squeezy subscription webhook is missing its subscription ID.');
  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (storeId && String(attributes.store_id) !== String(storeId)) {
    throw new Error(`Lemon Squeezy subscription ${subscriptionId} belongs to an unexpected store.`);
  }

  const status = normalizeSubscriptionStatus(attributes.status);
  const product = getProductByVariantId(attributes.variant_id);
  const plan = ['starter', 'pro', 'scale'].includes(product) ? product : null;
  const userId = Number(payload.meta?.custom_data?.user_id) || null;
  if (status === 'expired') {
    if (userId) {
      await db.execute(
        "UPDATE users SET subscription_status = 'expired', plan_tier = 'free', monthly_quota_remaining = 0 WHERE id = ? AND (subscription_id IS NULL OR subscription_id = ?)",
        [userId, String(subscriptionId)]
      );
    } else {
      await db.execute(
        "UPDATE users SET subscription_status = 'expired', plan_tier = 'free', monthly_quota_remaining = 0 WHERE subscription_id = ?",
        [String(subscriptionId)]
      );
    }
    return;
  }
  if (userId && eventName === 'subscription_created') {
    await db.execute(
      `UPDATE users SET subscription_id = ?, subscription_status = 'active',
         plan_tier = COALESCE(?, plan_tier)
       WHERE id = ? AND (subscription_id IS NULL OR subscription_id = ? OR subscription_status IN ('expired', 'canceled'))`,
      [String(subscriptionId), plan, userId, String(subscriptionId)]
    );
    return;
  }
  await db.execute(
    `UPDATE users SET subscription_status = 'active',
       plan_tier = COALESCE(?, plan_tier)
     WHERE subscription_id = ? AND subscription_status <> 'expired'`,
    [plan, String(subscriptionId)]
  );
}

module.exports = {
  lemonSqueezyWebhook,
  processEvent,
  processOrder,
  updateSubscription,
  normalizeSubscriptionStatus,
  getOrderAmountUsd,
  getReferralBasisUsd
};
