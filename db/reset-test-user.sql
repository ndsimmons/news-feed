-- Reset Test User to First-Time Experience
-- Run this anytime to reset user 999 (test-firsttime@nicofeed.com) back to pristine state
-- Usage: npx wrangler d1 execute news-feed-db --remote --file=./db/reset-test-user.sql

-- Delete all user activity
DELETE FROM votes WHERE user_id = 999;
DELETE FROM saved_articles WHERE user_id = 999;
DELETE FROM article_impressions WHERE user_id = 999;
DELETE FROM interest_weights WHERE user_id = 999;
DELETE FROM user_preferences WHERE user_id = 999;
DELETE FROM algorithm_profiles WHERE user_id = 999;
DELETE FROM user_source_preferences WHERE user_id = 999;

-- Recreate default algorithm profile
INSERT INTO algorithm_profiles (
  user_id, 
  name, 
  description,
  is_active, 
  is_default,
  recency_decay_hours,
  source_diversity_multiplier,
  include_metadata_in_embeddings,
  dynamic_similarity_strength,
  exploration_factor
) VALUES (
  999,
  'Default',
  'Default algorithm settings',
  1,
  1,
  24,
  0.5,
  1,
  0.5,
  0.1
);

-- Initialize neutral interest weights for all categories and sources
INSERT INTO interest_weights (user_id, category_id, source_id, weight)
SELECT 999, id, NULL, 1.0 FROM categories;

INSERT INTO interest_weights (user_id, category_id, source_id, weight)
SELECT 999, NULL, id, 1.0 FROM sources;

-- Confirm reset
SELECT 'Test user reset complete!' as message,
       (SELECT COUNT(*) FROM votes WHERE user_id = 999) as votes,
       (SELECT COUNT(*) FROM saved_articles WHERE user_id = 999) as saved,
       (SELECT COUNT(*) FROM article_impressions WHERE user_id = 999) as impressions;
