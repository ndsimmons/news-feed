-- Migration: Add embeddings support
-- Run this after initial schema

-- Store which articles user liked (for embedding-based recommendations)
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 1,
  article_id INTEGER,
  vote INTEGER, -- 1 for like, -1 for dislike
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (article_id) REFERENCES articles(id),
  UNIQUE(user_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_user_preferences ON user_preferences(user_id, vote);

-- Track embedding metadata in D1 (vectors stored in Vectorize)
CREATE TABLE IF NOT EXISTS article_embeddings (
  article_id INTEGER PRIMARY KEY,
  embedding_generated BOOLEAN DEFAULT 0,
  embedding_model TEXT DEFAULT 'bge-base-en-v1.5',
  generated_at TIMESTAMP,
  FOREIGN KEY (article_id) REFERENCES articles(id)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_generated ON article_embeddings(embedding_generated);
