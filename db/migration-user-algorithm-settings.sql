-- Migration: Add user_algorithm_settings table for algorithm customization
-- Allows users to control recency decay and other algorithm parameters
-- NOTE: user_preferences already exists for article vote tracking (embeddings)

CREATE TABLE IF NOT EXISTS user_algorithm_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  recency_decay_hours INTEGER DEFAULT 24, -- How many hours until article scores decay to minimum (12, 24, 48, 72)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_user_algorithm_settings_user_id ON user_algorithm_settings(user_id);

-- Insert default preferences for existing users
INSERT OR IGNORE INTO user_algorithm_settings (user_id)
SELECT id FROM users;
