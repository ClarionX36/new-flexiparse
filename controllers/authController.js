function googleLogin(req, res, next) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).send('Login Google belum dikonfigurasi. Isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET.');
  }
  if (req.query.ref && /^[A-Z0-9]{6,20}$/i.test(req.query.ref)) {
    req.session.referralCode = req.query.ref.toUpperCase();
  }
  return next();
}

function googleCallback(req, res, next) {
  const passport = require('../config/passport');
  passport.authenticate('google', { failureRedirect: '/?login=failed' }, (error, user) => {
    if (error) return next(error);
    if (!user) return res.redirect('/?login=failed');
    req.logIn(user, (loginError) => {
      if (loginError) return next(loginError);
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        return res.redirect('/dashboard');
      });
    });
  })(req, res, next);
}

function logout(req, res, next) {
  req.logout((error) => {
    if (error) return next(error);
    req.session.destroy((sessionError) => {
      if (sessionError) return next(sessionError);
      res.clearCookie('flexiparse.sid');
      return res.json({ ok: true });
    });
  });
}

module.exports = { googleLogin, googleCallback, logout };
