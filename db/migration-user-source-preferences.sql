-- User-specific source preferences
-- Allows users to enable/disable specific news sources

CREATE TABLE IF NOT EXISTS user_source_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, source_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX idx_user_source_prefs_user ON user_source_preferences(user_id);
CREATE INDEX idx_user_source_prefs_source ON user_source_preferences(source_id);
