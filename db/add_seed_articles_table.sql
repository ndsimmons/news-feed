-- Create table to track user's first interaction for algorithm seeding
CREATE TABLE IF NOT EXISTS user_seed_articles (
  user_id INTEGER PRIMARY KEY,
  article_id INTEGER NOT NULL,
  interaction_type TEXT NOT NULL, -- 'click', 'upvote', 'downvote', 'save'
  category_id INTEGER NOT NULL,
  source_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (article_id) REFERENCES articles(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS idx_user_seed_articles_user_id ON user_seed_articles(user_id);
