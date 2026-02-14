-- Migration: Add Saved Articles Feature
-- Allows users to bookmark articles for later reading
-- Saves also count as "likes" for algorithm training

CREATE TABLE IF NOT EXISTS saved_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  article_id INTEGER NOT NULL,
  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT, -- Optional: for future feature to add notes
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (article_id) REFERENCES articles(id),
  UNIQUE(user_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_articles_user ON saved_articles(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_articles_article ON saved_articles(article_id);
CREATE INDEX IF NOT EXISTS idx_saved_articles_saved_at ON saved_articles(user_id, saved_at DESC);
