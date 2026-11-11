const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('./db');

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && !process.env.GOOGLE_CALLBACK_URL && !process.env.APP_URL) {
  throw new Error('Set GOOGLE_CALLBACK_URL or APP_URL to enable Google OAuth.');
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || `${process.env.APP_URL}/auth/google/callback`,
    proxy: process.env.NODE_ENV === 'production',
    passReqToCallback: true
  }, async (req, accessToken, refreshToken, profile, done) => {
    let connection;
    let transactionStarted = false;
    try {
      connection = await db.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      const googleId = profile.id;
      const email = profile.emails?.[0]?.value;
      if (!email) throw new Error('Google account did not provide an email address.');
      if (profile._json?.email_verified === false) throw new Error('Google account email is not verified.');

      const [existing] = await connection.execute(
        'SELECT id, google_id, email, name, avatar, plan_tier, subscription_status, monthly_quota_remaining, add_on_quota_remaining, referral_code, referral_reward_choice, affiliate_balance FROM users WHERE google_id = ? FOR UPDATE',
        [googleId]
      );
      let user = existing[0];
      if (user) {
        await connection.execute(
          'UPDATE users SET email = ?, name = ?, avatar = ? WHERE id = ?',
          [email, profile.displayName || null, profile.photos?.[0]?.value || null, user.id]
        );
        user = { ...user, email, name: profile.displayName || null, avatar: profile.photos?.[0]?.value || null };
      } else {
        const [referrerRows] = await connection.execute(
          'SELECT id FROM users WHERE referral_code = ? LIMIT 1',
          [req.session?.referralCode || '']
        );
        const referrerId = referrerRows[0]?.id || null;
        const referralCode = require('crypto').randomBytes(6).toString('hex').toUpperCase();
        const [insert] = await connection.execute(
          `INSERT INTO users
            (google_id, email, name, avatar, referral_code, referred_by_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [googleId, email, profile.displayName || null, profile.photos?.[0]?.value || null, referralCode, referrerId]
        );
        const [created] = await connection.execute(
          'SELECT id, google_id, email, name, avatar, plan_tier, subscription_status, monthly_quota_remaining, add_on_quota_remaining, referral_code, referral_reward_choice, affiliate_balance FROM users WHERE id = ?',
          [insert.insertId]
        );
        user = created[0];
      }

      await connection.commit();
      if (req.session) delete req.session.referralCode;
      return done(null, user);
    } catch (error) {
      if (connection && transactionStarted) await connection.rollback();
      return done(error);
    } finally {
      connection?.release();
    }
  }));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await db.execute(
      'SELECT id, google_id, email, name, avatar, plan_tier, subscription_status, monthly_quota_remaining, add_on_quota_remaining, referral_code, referral_reward_choice, affiliate_balance FROM users WHERE id = ?',
      [id]
    );
    done(null, rows[0] || false);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;
