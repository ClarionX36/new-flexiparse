require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const db = require('./config/db');
const passport = require('./config/passport');

if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters in production.');
}

const app = express();
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
      frameSrc: ["'self'", 'https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'],
      connectSrc: ["'self'", 'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com']
    }
  }
}));
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((item) => item.trim()) : false,
  credentials: true
}));
app.use('/webhooks', require('./routes/webhooks'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME,
  createDatabaseTable: true,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 24 * 60 * 60 * 1000
});
app.use(session({
  name: 'flexiparse.sid',
  secret: process.env.SESSION_SECRET || 'development-only-secret-change-before-deploy',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' }
}));

app.use('/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', async (req, res, next) => {
  try {
    await db.query('SELECT 1');
    return res.json({ status: 'ok' });
  } catch (error) {
    return next(error);
  }
});
app.use((req, res) => res.status(404).json({ error: 'Page not found.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File size exceeds the ${process.env.MAX_UPLOAD_MB || 15} MB limit.` });
  if (error.message?.startsWith('Files must be')) return res.status(400).json({ error: error.message });
  const status = Number(error.status) || 500;
  if (status >= 500) console.error('[FlexiParse]', error);
  return res.status(status).json({ error: status >= 500 ? 'A server error occurred. Please try again.' : error.message });
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => console.log(`FlexiParse listening on port ${port}`));
}

module.exports = app;
