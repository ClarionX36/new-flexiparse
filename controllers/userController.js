const db = require('../config/db');

const tiers = {
  starter: { pages: 300, tables: 5, price: 9 },
  pro: { pages: 1000, tables: 25, price: 19 },
  scale: { pages: 3500, tables: 'unlimited', price: 49 }
};

async function dashboard(req, res, next) {
  try {
    const [userRows] = await db.execute(
      `SELECT id, email, name, avatar, plan_tier AS planTier, subscription_status AS subscriptionStatus,
              monthly_quota_remaining AS monthlyQuota, add_on_quota_remaining AS addonQuota,
              referral_code AS referralCode, referral_reward_choice AS referralRewardChoice, affiliate_balance AS affiliateBalance
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!userRows[0]) return res.status(401).json({ error: 'Sesi pengguna tidak lagi aktif.' });
    const [tableRows] = await db.execute('SELECT COUNT(*) AS count FROM parsed_tables WHERE user_id = ?', [req.user.id]);
    const [payoutRows] = await db.execute(
      'SELECT id, amount, payout_method AS payoutMethod, status, created_at AS createdAt FROM payouts WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [req.user.id]
    );
    return res.json({ user: userRows[0], tableCount: Number(tableRows[0].count), payouts: payoutRows, plans: tiers });
  } catch (error) {
    return next(error);
  }
}

async function setReferralReward(req, res, next) {
  const choice = req.body.choice;
  if (!['credits', 'cash'].includes(choice)) return res.status(400).json({ error: 'Pilihan reward tidak valid.' });
  try {
    await db.execute('UPDATE users SET referral_reward_choice = ? WHERE id = ?', [choice, req.user.id]);
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
}

async function requestPayout(req, res, next) {
  const method = String(req.body.method || '');
  const account = String(req.body.account || '').trim();
  if (!['paypal', 'wise'].includes(method) || account.length < 3 || account.length > 255) {
    return res.status(400).json({ error: 'Metode atau detail akun payout tidak valid.' });
  }
  let connection;
  let transactionStarted = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;
    const [users] = await connection.execute('SELECT affiliate_balance FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
    const balance = Number(users[0]?.affiliate_balance || 0);
    if (balance < 50) throw Object.assign(new Error('Saldo minimum untuk payout adalah $50.'), { status: 400 });
    const [pending] = await connection.execute("SELECT id FROM payouts WHERE user_id = ? AND status = 'requested' LIMIT 1", [req.user.id]);
    if (pending.length) throw Object.assign(new Error('Anda sudah memiliki permintaan payout yang sedang diproses.'), { status: 409 });
    await connection.execute(
      'INSERT INTO payouts (user_id, amount, payout_method, payout_account) VALUES (?, ?, ?, ?)',
      [req.user.id, balance, method, account]
    );
    await connection.execute('UPDATE users SET affiliate_balance = 0 WHERE id = ?', [req.user.id]);
    await connection.commit();
    return res.status(201).json({ ok: true });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    return next(error);
  } finally {
    connection?.release();
  }
}

module.exports = { dashboard, setReferralReward, requestPayout, tiers };
