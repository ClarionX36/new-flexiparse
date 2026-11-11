CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  google_id VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NULL,
  avatar VARCHAR(500) NULL,
  plan_tier ENUM('free', 'starter', 'pro', 'scale') NOT NULL DEFAULT 'free',
  subscription_status ENUM('active', 'canceled', 'expired') NOT NULL DEFAULT 'active',
  subscription_id VARCHAR(255) NULL,
  monthly_quota_remaining INT NOT NULL DEFAULT 5,
  add_on_quota_remaining INT NOT NULL DEFAULT 0,
  referral_code VARCHAR(50) NOT NULL UNIQUE,
  referred_by_id INT NULL,
  referral_reward_choice ENUM('credits', 'cash') NOT NULL DEFAULT 'credits',
  referred_rewarded_at TIMESTAMP NULL,
  affiliate_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_referrer FOREIGN KEY (referred_by_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_users_subscription (subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parsed_tables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  parsed_json LONGTEXT NOT NULL,
  total_pages INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_parsed_tables_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_parsed_tables_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS extraction_queue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  total_pages INT NOT NULL DEFAULT 1,
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  scheduled_at DATETIME NOT NULL,
  parsed_table_id INT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_extraction_queue_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_extraction_queue_table FOREIGN KEY (parsed_table_id) REFERENCES parsed_tables(id) ON DELETE SET NULL,
  INDEX idx_extraction_queue_pending (status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  payment_id VARCHAR(255) NOT NULL UNIQUE,
  type ENUM('subscription', 'topup') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  item_description VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payouts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payout_method VARCHAR(50) NOT NULL,
  payout_account VARCHAR(255) NOT NULL,
  status ENUM('requested', 'paid', 'rejected') NOT NULL DEFAULT 'requested',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payouts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_payouts_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
