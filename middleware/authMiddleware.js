function requireAuth(req, res, next) {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ error: 'Silakan masuk untuk melanjutkan.' });
  }
  return next();
}

function requireCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const supplied = req.get('x-csrf-token');
  if (!expected || !supplied || supplied !== expected) {
    return res.status(403).json({ error: 'Permintaan tidak valid. Muat ulang halaman dan coba lagi.' });
  }
  return next();
}

module.exports = { requireAuth, requireCsrf };
