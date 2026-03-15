-- phpMyAdmin SQL Dump
-- Database: `taubennester_db`

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

CREATE DATABASE IF NOT EXISTS `d0464a4c` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `d0464a4c`;

-- --------------------------------------------------------

--
-- Table structure for table `taubennester`
--

CREATE TABLE `taubennester` (
  `id` varchar(36) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `photo_filename` varchar(255) DEFAULT NULL,
  `lat` decimal(10,8) NOT NULL,
  `lng` decimal(11,8) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------

--
-- Table structure for table `taubennest_logs`
--

CREATE TABLE `taubennest_logs` (
  `id` varchar(36) NOT NULL,
  `nest_id` varchar(36) NOT NULL,
  `user_id` varchar(36) DEFAULT NULL,
  `action` varchar(255) NOT NULL,
  `timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- Indexes
--
ALTER TABLE `taubennester`
  ADD PRIMARY KEY (`id`);

ALTER TABLE `taubennest_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `nest_id` (`nest_id`),
  ADD KEY `user_id` (`user_id`);

--
-- Constraints
--
ALTER TABLE `taubennest_logs`
  ADD CONSTRAINT `taubennest_logs_ibfk_1` FOREIGN KEY (`nest_id`) REFERENCES `taubennester` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `taubennest_logs_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `username` varchar(50) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `is_admin` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------

--
-- Table structure for table `user_tokens`
--

CREATE TABLE `user_tokens` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `token` varchar(64) NOT NULL,
  `expires_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------

--
-- Table structure for table `password_resets`
--

CREATE TABLE `password_resets` (
  `id` varchar(36) NOT NULL,
  `email` varchar(255) NOT NULL,
  `token` varchar(64) NOT NULL,
  `expires_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- Indexes for auth tables
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `username` (`username`),
  ADD UNIQUE KEY `email` (`email`);

ALTER TABLE `user_tokens`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`),
  ADD UNIQUE KEY `token` (`token`);

ALTER TABLE `password_resets`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `token` (`token`);

--
-- Constraints for auth tables
--
ALTER TABLE `user_tokens`
  ADD CONSTRAINT `user_tokens_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

-- --------------------------------------------------------

--
-- Table structure for table `app_logs`
--

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


COMMIT;
