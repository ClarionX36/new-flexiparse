function requireAuth(req, res, next) {
  if (!req.isAuthenticated?.()) {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
  return next();
}

function requireCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const supplied = req.get('x-csrf-token');
  if (!expected || !supplied || supplied !== expected) {
    return res.status(403).json({ error: 'Invalid request. Reload the page and try again.' });
  }
  return next();
}

module.exports = { requireAuth, requireCsrf };
