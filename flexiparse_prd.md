# Product Requirement Document (PRD): FlexiParse

## 1. Executive Summary & Tech Stack

**FlexiParse** is a global AI-powered OCR and Document Data Extraction SaaS. It enables users to upload structured/unstructured documents (PDFs, images), extracts the content into customizable tabular format via Gemini API, and allows exporting to Excel (`.xlsx`) or CSV (`.csv`).

### Tech Stack Architecture
- **Language & Runtime:** Node.js (v18+ or v20+ LTS) via cPanel Node.js Selector.
- **Framework:** Express.js (REST API & Server-side rendering or Web API).
- **Database:** MySQL / MariaDB (Hosted on cPanel).
- **AI Engine:** `@google/genai` (Gemini API - Model: `gemini-1.5-flash`).
- **Authentication:** Google OAuth 2.0 (`passport-google-oauth20` or official SDK).
- **Security:** Google reCAPTCHA v2/v3, CORS, Helmet, Rate Limiter.
- **Financial Gateway (External):** Lemon Squeezy (Merchant of Record; off-server checkout with entitlements synced to cPanel via webhooks).
- **UI & Frontend:** HTML5, Tailwind CSS (via CDN or pre-compiled), Alpine.js / Vanilla JS (for interactive table preview).

---

## 2. Database Schema (MySQL)

Run this SQL script in your cPanel phpMyAdmin to initialize the complete database structure.

```sql
CREATE DATABASE IF NOT EXISTS `flexiparse` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `flexiparse`;

-- Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `google_id` VARCHAR(255) UNIQUE NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NULL,
  `avatar` VARCHAR(500) NULL,
  `plan_tier` ENUM('free', 'starter', 'pro', 'scale') DEFAULT 'free',
  `subscription_status` ENUM('active', 'canceled', 'expired') DEFAULT 'active',
  `subscription_id` VARCHAR(255) NULL,
  `monthly_quota_remaining` INT DEFAULT 5,
  `add_on_quota_remaining` INT DEFAULT 0,
  `referral_code` VARCHAR(50) UNIQUE NOT NULL,
  `referred_by_id` INT NULL,
  `referral_reward_choice` ENUM('credits', 'cash') DEFAULT 'credits',
  `affiliate_balance` DECIMAL(10,2) DEFAULT 0.00,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`referred_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Tables/Projects Saved
CREATE TABLE IF NOT EXISTS `parsed_tables` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `original_filename` VARCHAR(255) NOT NULL,
  `parsed_json` LONGTEXT NOT NULL, -- Holds column headers & rows JSON
  `total_pages` INT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Extraction Processing Queue
CREATE TABLE IF NOT EXISTS `extraction_queue` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `file_path` VARCHAR(500) NOT NULL,
  `status` ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
  `scheduled_at` DATETIME NOT NULL,
  `error_message` TEXT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Payment & Top-Up Transactions Log
CREATE TABLE IF NOT EXISTS `transactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `payment_id` VARCHAR(255) NOT NULL,
  `type` ENUM('subscription', 'topup') NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `item_description` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Referral Earnings & Payout Requests
CREATE TABLE IF NOT EXISTS `payouts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `amount` DECIMAL(10,2) NOT NULL,
  `payout_method` VARCHAR(50) NOT NULL, -- e.g., 'paypal' or 'wise'
  `payout_account` VARCHAR(255) NOT NULL,
  `status` ENUM('requested', 'paid', 'rejected') DEFAULT 'requested',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB;
```

---

## 3. Subscription Tiers, Table Limits & Top-Up Rules

| Parameter / Feature | Free Tier | Starter Plan | Pro Plan | Scale / Business Plan |
| :--- | :--- | :--- | :--- | :--- |
| **Price** | **$0** (Lifetime) | **$9 / month** | **$19 / month** | **$49 / month** |
| **Monthly Page Quota** | 5 Pages Total | 300 Pages / mo | 1,000 Pages / mo | 3,500 Pages / mo |
| **Active Table Limit** | **1 Table** | **5 Tables** | **25 Tables** | **Unlimited** |
| **Queue Interval** | Every 5 Minutes | Every 3 Minutes | Instant (Real-time) | Instant (Highest Priority) |
| **Top-Up Access** | ❌ Blocked | ✅ Allowed | ✅ Allowed | ✅ Allowed |

### Top-Up Add-ons (One-Time)
- **Eligibility:** Active subscribers of Starter ($9), Pro ($19), or Scale ($49) plans.
- **Top-Up Tier 1:** +500 Extra Pages for **$5** (No expiration).
- **Top-Up Tier 2:** +1,500 Extra Pages for **$12** (No expiration).
- **Quota Consumption Priority:** `monthly_quota_remaining` is deducted first. Once exhausted, `add_on_quota_remaining` is deducted.

---

## 4. Referral & Affiliate Logic

1. **Trigger:** Granted ONLY when Downline (User B) upgrades to a paid plan.
2. **Reward Selection (Set by User A in Dashboard):**
   - **Option A (Credits):** +300 permanent bonus pages added to `add_on_quota_remaining`.
   - **Option B (Cash 20% Recurring):**
     - Starter ($9) $\rightarrow$ **$1.80/mo**
     - Pro ($19) $\rightarrow$ **$3.80/mo**
     - Scale ($49) $\rightarrow$ **$9.80/mo**
3. **Withdrawal Threshold:** Minimum **$50** balance to submit a withdrawal request.

---

## 5. Node.js Project Structure for VS Code

Create the following folder structure in your VS Code workspace:

```text
flexiparse/
├── config/
│   ├── db.js             # MySQL database connection pool
│   ├── passport.js       # Google OAuth strategy
│   └── gemini.js         # Gemini API client instance
├── controllers/
│   ├── authController.js # Handles Google Login & Logout
│   ├── parseController.js# Upload, Gemini processing, table save
│   ├── userController.js # Dashboard, referrals, payouts
│   └── webhookController.js # Lemon Squeezy webhooks
├── middleware/
│   ├── authMiddleware.js # Session & auth checks
│   ├── quotaMiddleware.js# Checks page quota & table limits
│   └── recaptcha.js      # reCAPTCHA verification
├── queue/
│   └── cronWorker.js     # Queue processor & 24h file cleanup
├── routes/
│   ├── auth.js
│   ├── api.js
│   └── webhooks.js
├── views/                # EJS or HTML frontend templates
│   ├── index.html
│   ├── dashboard.html
│   └── editor.html
├── uploads/              # Temporary file directory (Auto-purged <24h)
├── .env.example          # Environment variable template
├── app.js                # Express app entry point
└── package.json
```

---

## 6. Guidance for Copilot / Coding Prompts

Use these exact prompts in VS Code Copilot to generate your code modules smoothly:

### Prompt 1: Express App & DB Config (`config/db.js` & `app.js`)
> "Write a Node.js Express setup file (`app.js`) and MySQL connection pool module using `mysql2/promise` (`config/db.js`). Include session management, CORS, Helmet security middleware, and set up dotenv environment configuration suitable for a cPanel Node.js application."

### Prompt 2: Gemini OCR Controller (`controllers/parseController.js`)
> "Create an Express controller that accepts an uploaded file (PDF/Image) using multer. Send the document file to the Gemini API (`@google/genai` model `gemini-1.5-flash`) with a prompt asking Gemini to extract all tabular data into JSON format with headers and rows. Return the extracted JSON to the frontend for interactive editing."

### Prompt 3: Lemon Squeezy Webhook Handler (`controllers/webhookController.js`)
> "Write a Lemon Squeezy webhook endpoint in Express. Verify the raw request body's HMAC-SHA256 signature from `X-Signature`, then process `order_created` using configured variant IDs and `meta.custom_data.user_id`. Activate subscriptions and monthly quota only for paid orders; grant top-up pages only to active paid subscribers. Handle subscription updates and expiration, and make all order processing idempotent."

### Prompt 4: Queue & Cleanup Cron (`queue/cronWorker.js`)
> "Write a Node.js cron job script using `node-cron`. The first cron job checks the `extraction_queue` table every 1 minute and processes pending documents according to user tier interval. The second cron job runs daily to search the `./uploads` directory and delete files older than 24 hours."

---

## 7. cPanel Deployment Instructions

1. **Upload Code:** Upload your project folder to your cPanel directory (e.g., `/home/username/flexiparse`).
2. **Setup Node.js App:**
   - Go to **cPanel > Setup Node.js App**.
   - Select Node.js Version: **18.x** or **20.x**.
   - Application Mode: **Production**.
   - Application Root: `flexiparse`.
   - Application Startup File: `app.js`.
3. **Environment Variables:** Set `.env` variables inside cPanel Node.js Selector:
   - `DB_HOST`, `DB_USER`, `DB_PASS`, `DB_NAME`
   - `GEMINI_API_KEY`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`
   - `LEMONSQUEEZY_VARIANT_STARTER`, `LEMONSQUEEZY_VARIANT_PRO`, `LEMONSQUEEZY_VARIANT_SCALE`
   - `LEMONSQUEEZY_VARIANT_TOPUP_500`, `LEMONSQUEEZY_VARIANT_TOPUP_1500`
4. **Run npm install:** Click **Run npm install** in the cPanel Node.js App interface or run it via cPanel Terminal.
5. **Setup Cron Job:**
   - Go to **cPanel > Cron Jobs**.
   - Add a cron job to run the worker every 5 minutes:
     `cd /home/username/flexiparse && /usr/local/bin/node queue/cronWorker.js`