async function verifyRecaptcha(req, res, next) {
  if (!process.env.RECAPTCHA_SECRET_KEY) return next();
  const token = req.get('x-recaptcha-token');
  if (!token) return res.status(400).json({ error: 'reCAPTCHA verification is required.' });

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: process.env.RECAPTCHA_SECRET_KEY, response: token })
    });
    const result = await response.json();
    const expectedHost = process.env.APP_URL ? new URL(process.env.APP_URL).hostname.toLowerCase() : null;
    if (!result.success || result.action !== 'extract' ||
      (expectedHost && result.hostname?.toLowerCase() !== expectedHost) ||
      (typeof result.score === 'number' && result.score < 0.5)) {
      return res.status(403).json({ error: 'reCAPTCHA verification failed.' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { verifyRecaptcha };
