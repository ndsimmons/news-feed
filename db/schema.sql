-- News Feed Database Schema
-- Cloudflare D1 (SQLite-based)

-- Users table (ready for multi-user, start with single default user)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Categories (easily configurable)
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sources (easily add/remove/modify)
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT,
  category_id INTEGER,
  fetch_method TEXT NOT NULL, -- 'rss', 'api', 'scrape', 'manual'
  config TEXT, -- JSON config: API keys, RSS URLs, selectors, etc.
  active BOOLEAN DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Articles
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT UNIQUE NOT NULL,
  source_id INTEGER,
  category_id INTEGER,
  published_at TIMESTAMP,
  fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  image_url TEXT,
  author TEXT,
  content TEXT, -- Full article text if available
  FOREIGN KEY (source_id) REFERENCES sources(id),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_id);

-- User votes
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 1,
  article_id INTEGER,
  vote INTEGER NOT NULL, -- 1 for upvote, -1 for downvote
  voted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (article_id) REFERENCES articles(id),
  UNIQUE(user_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_article ON votes(article_id);

-- User interest weights (learned from votes)
CREATE TABLE IF NOT EXISTS interest_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 1,
  category_id INTEGER,
  source_id INTEGER,
  weight REAL DEFAULT 1.0, -- adjusted based on votes (0.1 to 2.0)
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (source_id) REFERENCES sources(id),
  UNIQUE(user_id, category_id, source_id)
);

-- Article scores cache (pre-computed for performance)
CREATE TABLE IF NOT EXISTS article_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 1,
  article_id INTEGER,
  score REAL NOT NULL,
  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (article_id) REFERENCES articles(id),
  UNIQUE(user_id, article_id)
);

CREATE INDEX IF NOT EXISTS idx_scores_user_score ON article_scores(user_id, score DESC);
