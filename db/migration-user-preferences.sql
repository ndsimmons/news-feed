-- Migration: Add user preferences table for algorithm customization
-- Allows users to control recency decay and other algorithm parameters

CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  recency_decay_hours INTEGER DEFAULT 24, -- How many hours until article scores decay to minimum (12, 24, 48, 72)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- Insert default preferences for existing users
INSERT OR IGNORE INTO user_preferences (user_id)
SELECT id FROM users;
