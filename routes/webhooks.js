const express = require('express');
const { lemonSqueezyWebhook } = require('../controllers/webhookController');

const router = express.Router();
router.post('/lemon-squeezy', express.raw({ type: 'application/json', limit: '1mb' }), lemonSqueezyWebhook);

module.exports = router;
