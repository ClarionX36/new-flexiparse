const Stripe = require('stripe');
const db = require('../config/db');
const { tiers } = require('./userController');

function stripeWebhook(req, res, next) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Stripe webhook belum dikonfigurasi.');
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    return res.status(400).send(`Webhook signature verification failed: ${error.message}`);
  }
  processEvent(event).then(() => res.json({ received: true })).catch(next);
}

async function processEvent(event) {
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const userId = Number(session.metadata?.userId);
    const type = session.metadata?.type;
    if (!userId || !session.id) throw new Error('Stripe checkout session is missing required metadata.');
    if (type === 'topup' && session.payment_status !== 'paid') return;
    if (type === 'subscription' && !['paid', 'no_payment_required'].includes(session.payment_status)) return;
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [seen] = await connection.execute('SELECT id FROM transactions WHERE payment_id = ?', [session.id]);
      if (seen.length) {
        await connection.commit();
        return;
      }
      const [users] = await connection.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [userId]);
      const user = users[0];
      if (!user) throw new Error(`Stripe checkout references unknown user ${userId}.`);
      if (type === 'subscription') {
        const tier = session.metadata?.plan;
        if (!tiers[tier]) throw new Error('Stripe checkout contains an unknown subscription plan.');
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null;
        await connection.execute(
          'UPDATE users SET plan_tier = ?, subscription_status = ?, subscription_id = ?, monthly_quota_remaining = ? WHERE id = ?',
          [tier, 'active', subscriptionId, tiers[tier].pages, userId]
        );
        await connection.execute(
          'INSERT INTO transactions (user_id, payment_id, type, amount, item_description) VALUES (?, ?, ?, ?, ?)',
          [userId, session.id, 'subscription', Number(session.amount_total || 0) / 100, `${tier} subscription`]
        );
        if (user.referred_by_id && !user.subscription_id && session.payment_status === 'paid' && Number(session.amount_total) > 0) {
          const [referrers] = await connection.execute('SELECT referral_reward_choice FROM users WHERE id = ? FOR UPDATE', [user.referred_by_id]);
          if (referrers[0]?.referral_reward_choice === 'credits' && !user.referred_rewarded_at) {
            await connection.execute('UPDATE users SET add_on_quota_remaining = add_on_quota_remaining + 300 WHERE id = ?', [user.referred_by_id]);
            await connection.execute('UPDATE users SET referred_rewarded_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
          } else if (referrers[0]?.referral_reward_choice === 'cash') {
            const commission = Math.round(tiers[tier].price * 20 * 100) / 100;
            await connection.execute('UPDATE users SET affiliate_balance = affiliate_balance + ? WHERE id = ?', [commission, user.referred_by_id]);
            await connection.execute('UPDATE users SET referred_rewarded_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
          }
        }
      } else if (type === 'topup') {
        const pages = Number(session.metadata?.pages);
        const amount = Number(session.amount_total || 0) / 100;
        if (![500, 1500].includes(pages)) throw new Error('Stripe checkout contains an invalid top-up amount.');
        if (!['starter', 'pro', 'scale'].includes(user.plan_tier) || user.subscription_status !== 'active') {
          throw new Error('Top-up purchase received for an ineligible account.');
        }
        await connection.execute('UPDATE users SET add_on_quota_remaining = add_on_quota_remaining + ? WHERE id = ?', [pages, userId]);
        await connection.execute(
          'INSERT INTO transactions (user_id, payment_id, type, amount, item_description) VALUES (?, ?, ?, ?, ?)',
          [userId, session.id, 'topup', amount, `${pages} page top-up`]
        );
      } else {
        throw new Error(`Unsupported Stripe checkout type: ${type}`);
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } else if (event.type === 'invoice.paid') {
    await applyRenewal(event.data.object);
  } else if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    await db.execute(
      "UPDATE users SET subscription_status = 'canceled', plan_tier = 'free', monthly_quota_remaining = 0 WHERE subscription_id = ?",
      [subscription.id]
    );
  }
}

async function applyRenewal(invoice) {
  const subscriptionId = invoice.subscription || invoice.parent?.subscription_details?.subscription;
  if (!subscriptionId || !invoice.id) return;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.execute(
      'SELECT id, plan_tier, referred_by_id, referred_rewarded_at FROM users WHERE subscription_id = ? LIMIT 1 FOR UPDATE',
      [subscriptionId]
    );
    const user = users[0];
    if (!user || !tiers[user.plan_tier]) {
      await connection.commit();
      return;
    }
    const [seen] = await connection.execute('SELECT id FROM transactions WHERE payment_id = ?', [invoice.id]);
    if (seen.length) {
      await connection.commit();
      return;
    }
    await connection.execute(
      'UPDATE users SET monthly_quota_remaining = ? WHERE id = ?',
      [tiers[user.plan_tier].pages, user.id]
    );
    await connection.execute(
      'INSERT INTO transactions (user_id, payment_id, type, amount, item_description) VALUES (?, ?, ?, ?, ?)',
      [user.id, invoice.id, 'subscription', Number(invoice.amount_paid || 0) / 100, `${user.plan_tier} renewal`]
    );
    if (user.referred_by_id && Number(invoice.amount_paid || 0) > 0) {
      const [referrers] = await connection.execute('SELECT referral_reward_choice FROM users WHERE id = ? FOR UPDATE', [user.referred_by_id]);
      if (invoice.billing_reason === 'subscription_create' && !user.referred_rewarded_at && referrers[0]?.referral_reward_choice === 'credits') {
        await connection.execute('UPDATE users SET add_on_quota_remaining = add_on_quota_remaining + 300 WHERE id = ?', [user.referred_by_id]);
        await connection.execute('UPDATE users SET referred_rewarded_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      } else if (referrers[0]?.referral_reward_choice === 'cash' && invoice.billing_reason !== 'subscription_create') {
        const commission = Math.round((Number(invoice.amount_paid || 0) / 100) * 20) / 100;
        if (commission > 0) await connection.execute('UPDATE users SET affiliate_balance = affiliate_balance + ? WHERE id = ?', [commission, user.referred_by_id]);
      } else if (invoice.billing_reason === 'subscription_create' && !user.referred_rewarded_at && referrers[0]?.referral_reward_choice === 'cash') {
        const commission = Math.round((Number(invoice.amount_paid || 0) / 100) * 20) / 100;
        if (commission > 0) await connection.execute('UPDATE users SET affiliate_balance = affiliate_balance + ? WHERE id = ?', [commission, user.referred_by_id]);
        await connection.execute('UPDATE users SET referred_rewarded_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { stripeWebhook, processEvent };
