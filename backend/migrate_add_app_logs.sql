-- Migration: Add app_logs table for server-side event logging
-- Run this on the production database to enable admin logging.

DROP TABLE IF EXISTS `app_logs`;

CREATE TABLE IF NOT EXISTS `app_logs` (
  `id` varchar(36) NOT NULL,
  `level` enum('info','warning','error') NOT NULL DEFAULT 'info',
  `context` varchar(100) DEFAULT NULL,
  `message` text NOT NULL,
  `details` text DEFAULT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `level` (`level`),
  KEY `context` (`context`),
  KEY `created_at` (`created_at`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Optional: Foreign key to users table (soft link - allows logs to survive user deletion)
-- ALTER TABLE `app_logs`
--   ADD CONSTRAINT `app_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;
