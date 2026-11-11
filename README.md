# FlexiParse

AI-assisted PDF/image table extraction with a browser editor and CSV/XLSX exports. The server is designed for cPanel's Node.js Application Manager and MySQL/MariaDB.

## Requirements

- Node.js 20 LTS (recommended in cPanel Node.js Selector)
- MySQL/MariaDB database and user
- Google OAuth credentials and a Gemini API key for sign-in and extraction
- Lemon Squeezy store, API key, webhook secret, and variant IDs to enable paid plans

The server can start without Google, Gemini, and Lemon Squeezy credentials, but those specific integrations return an explicit configuration error until configured. Database configuration is required.

## Local setup

1. Copy `.env.example` to `.env` and set database and session values.
2. Create a database and import `database/schema.sql` using phpMyAdmin. The MySQL session store creates its own `sessions` table on first start.
3. Install and start:

   ```sh
   npm install
   npm start
   ```

4. Open `http://localhost:3000/health` and then `http://localhost:3000`.

Run `npm test` for unit tests and `npm run check` for syntax checks.

## cPanel deployment

1. Create a MySQL database and database user in cPanel, grant the user all privileges on that database, then import `database/schema.sql` in phpMyAdmin. Prefixes added by cPanel must be included in `DB_NAME` and `DB_USER`.
2. Upload this project to a directory outside `public_html` if your hosting account allows it (for example `~/flexiparse`). Do not upload `.env` publicly. Ensure the `uploads` directory is writable by the Node.js application.
3. In **cPanel → Setup Node.js App**, create an application using Node.js 20, production mode, the project directory as the application root, and `app.js` as the startup file. Set the application's domain/subdomain and create the application.
4. Add the environment variables from `.env.example` in Node.js Selector. Use a unique random `SESSION_SECRET` of at least 32 characters. `APP_URL`, `GOOGLE_CALLBACK_URL`, and `CORS_ORIGIN` must use the exact HTTPS domain. Save and restart the app.
5. In the application terminal, run `npm install --omit=dev` (or use cPanel's **Run NPM Install**). Restart the app after installation. Check `https://your-domain.com/health`.
6. Configure Google OAuth's authorized redirect URI to `https://your-domain.com/auth/google/callback` and set the Gemini API key. In Lemon Squeezy, create three monthly subscription variants ($9/$19/$49) and two one-time variants (+500 pages/$5 and +1,500 pages/$12). Set `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, and each matching `LEMONSQUEEZY_VARIANT_*` ID in cPanel. To test, use test-mode variants and set `LEMONSQUEEZY_TEST_MODE=true`.
7. Create a Lemon Squeezy webhook at `https://your-domain.com/webhooks/lemon-squeezy`, set its signing secret as `LEMONSQUEEZY_WEBHOOK_SECRET`, and enable `order_created`, `subscription_created`, `subscription_updated`, `subscription_resumed`, `subscription_unpaused`, `subscription_cancelled`, `subscription_paused`, and `subscription_expired`. Checkout and webhook use `meta.custom_data.user_id` to associate an order with the app account.
8. Add a cPanel Cron Job to process queued extractions and clean old files, for example:

   ```sh
   cd /home/CPANEL_USER/flexiparse && /usr/local/bin/node queue/cronWorker.js
   ```

   Set it to run every minute (as supported by the hosting plan), and update the paths to match the server's Node.js binary and application root. Pro/Scale jobs also start immediately in the web process; the cron job is required for Free/Starter queue scheduling and recovery after a process restart. Uploads expire after 24 hours, and completed/failed queue records are pruned after 30 days.

## Environment notes

- `DB_HOST`, `DB_USER`, `DB_PASS`, and `DB_NAME` are required. cPanel commonly uses `localhost`.
- `SESSION_SECRET` is required in production and must be 32+ characters.
- `GEMINI_MODEL` defaults to `gemini-2.5-flash`; set a model available to your Gemini project.
- `MAX_UPLOAD_MB` defaults to 15. Supported file types: PDF, JPEG, PNG, and WEBP.
- reCAPTCHA v3 is optional. When `RECAPTCHA_SECRET_KEY` is configured, extraction requests require a valid token; configure the matching site key in `RECAPTCHA_SITE_KEY`.
- Lemon Squeezy variant IDs must match their corresponding monthly subscription and one-time top-up products. Webhook signing is verified against the raw request body.

## Current product scope

Included: Google OAuth, MySQL-backed sessions and workspace, Gemini extraction, quota/table limits, tier-based extraction queue with polling, table editing/deletion, CSV/XLSX export, referral links/reward choice/payout requests, Lemon Squeezy Checkout/webhooks, security headers, API rate limiting, optional reCAPTCHA, and 24-hour upload cleanup.

Payouts are recorded for manual administrator processing; no money transfer is initiated by the app. Paid subscription orders refresh monthly quota and top-up orders add permanent pages. Existing active paid plans cannot be checked out again from the pricing buttons, to avoid duplicate subscriptions; cancel existing subscriptions with the old provider before re-subscribing through Lemon Squeezy. Existing provider subscriptions are not imported automatically. If migrating existing Stripe users, first cancel their Stripe subscriptions and wait until their paid access ends, then review and clear their old `subscription_id` and reset their tier in MySQL before they subscribe through Lemon Squeezy; do not run a bulk update until cancellations are confirmed. Extractions are queued on disk and completed by a one-minute cPanel Cron Job, so no continuously running worker daemon is needed. Administrators must configure Google, Gemini, Lemon Squeezy, DNS/SSL, and cPanel Cron outside the codebase.
