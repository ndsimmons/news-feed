-- Migration: Add article impressions tracking
-- Tracks when users see articles to auto-hide after multiple views without interaction

CREATE TABLE IF NOT EXISTS article_impressions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  impression_count INTEGER DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, article_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

-- Index for fast lookups when filtering feed
CREATE INDEX IF NOT EXISTS idx_article_impressions_user_article 
  ON article_impressions(user_id, article_id, impression_count, last_seen_at);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_article_impressions_last_seen 
  ON article_impressions(last_seen_at);
