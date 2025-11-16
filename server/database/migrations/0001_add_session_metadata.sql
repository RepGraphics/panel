-- Session metadata for device and IP tracking
CREATE TABLE IF NOT EXISTS `session_metadata` (
  `session_token` text PRIMARY KEY REFERENCES `sessions`(`session_token`) ON DELETE CASCADE,
  `first_seen_at` integer,
  `last_seen_at` integer,
  `ip_address` text,
  `user_agent` text,
  `device_name` text,
  `browser_name` text,
  `os_name` text
);
