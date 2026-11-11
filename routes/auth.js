const express = require('express');
const passport = require('../config/passport');
const { googleLogin, googleCallback, logout } = require('../controllers/authController');
const { requireCsrf } = require('../middleware/authMiddleware');

const router = express.Router();
router.get('/google', googleLogin, passport.authenticate('google', { scope: ['profile', 'email'], state: true }));
router.get('/google/callback', googleCallback);
router.post('/logout', requireCsrf, logout);

module.exports = router;
