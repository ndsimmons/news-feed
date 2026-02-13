-- Seed Data for News Feed

-- Insert default user
INSERT INTO users (id, username, email) VALUES 
  (1, 'default_user', 'user@example.com');

-- Insert categories
INSERT INTO categories (id, name, slug, description) VALUES 
  (1, 'Tech/AI', 'tech-ai', 'Technology and Artificial Intelligence news'),
  (2, 'Business/Finance', 'business-finance', 'Business and Finance news'),
  (3, 'Sports', 'sports', 'Sports news and updates'),
  (4, 'Politics', 'politics', 'Political news and commentary');

-- Insert sources
-- Tech/AI Sources
INSERT INTO sources (name, url, category_id, fetch_method, config, active) VALUES 
  ('Techmeme', 'https://techmeme.com', 1, 'rss', '{"rss_url": "https://www.techmeme.com/feed.xml"}', 1),
  ('Stratechery', 'https://stratechery.com', 1, 'rss', '{"rss_url": "https://stratechery.com/feed/"}', 1),
  ('X (Tech)', 'https://x.com', 1, 'api', '{"type": "twitter", "lists": ["tech"], "keywords": ["AI", "ML", "tech"]}', 0);

-- Business/Finance Sources
INSERT INTO sources (name, url, category_id, fetch_method, config, active) VALUES 
  ('Yahoo Finance', 'https://finance.yahoo.com', 2, 'rss', '{"rss_url": "https://finance.yahoo.com/news/rssindex"}', 1),
  ('CNBC', 'https://cnbc.com', 2, 'rss', '{"rss_url": "https://www.cnbc.com/id/100003114/device/rss/rss.html"}', 1);

-- Sports Sources
INSERT INTO sources (name, url, category_id, fetch_method, config, active) VALUES 
  ('Sofascore', 'https://sofascore.com', 3, 'api', '{"type": "sofascore", "api_key_required": true}', 0);

-- Politics Sources
INSERT INTO sources (name, url, category_id, fetch_method, config, active) VALUES 
  ('Wide World of News', 'https://wideworld.news', 4, 'rss', '{"rss_url": "TBD"}', 0),
  ('2way', 'https://2way.com', 4, 'rss', '{"rss_url": "TBD"}', 0),
  ('X (Politics)', 'https://x.com', 4, 'api', '{"type": "twitter", "lists": ["politics"]}', 0);

-- Initialize interest weights for default user (neutral starting weights)
INSERT INTO interest_weights (user_id, category_id, source_id, weight) VALUES 
  -- Tech/AI weights
  (1, 1, 1, 1.0), -- Techmeme
  (1, 1, 2, 1.0), -- Stratechery
  (1, 1, 3, 1.0), -- X (Tech)
  -- Business/Finance weights
  (1, 2, 4, 1.0), -- Yahoo Finance
  (1, 2, 5, 1.0), -- CNBC
  -- Sports weights
  (1, 3, 6, 1.0), -- Sofascore
  -- Politics weights
  (1, 4, 7, 1.0), -- Wide World of News
  (1, 4, 8, 1.0), -- 2way
  (1, 4, 9, 1.0); -- X (Politics)
