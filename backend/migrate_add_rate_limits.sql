-- Migration: Add rate_limits table for IP-based rate limiting
-- Run this on the production database to enable rate limiting.

CREATE TABLE IF NOT EXISTS `rate_limits` (
  `id` varchar(36) NOT NULL,
  `action` varchar(50) NOT NULL,
  `ip_address` varchar(45) NOT NULL,
  `attempts` int(11) NOT NULL DEFAULT 1,
  `window_start` datetime NOT NULL,
  `blocked_until` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `action_ip` (`action`, `ip_address`),
  KEY `blocked_until` (`blocked_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
