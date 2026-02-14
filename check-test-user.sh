#!/bin/bash
# Check test user current state
# Usage: ./check-test-user.sh

echo "📊 Test User Stats (test-firsttime@nicofeed.com)"
echo "================================================"
echo ""

npx wrangler d1 execute news-feed-db --remote --command "
SELECT 
  (SELECT COUNT(*) FROM votes WHERE user_id = 999 AND vote = 1) as upvotes,
  (SELECT COUNT(*) FROM votes WHERE user_id = 999 AND vote = -1) as downvotes,
  (SELECT COUNT(*) FROM saved_articles WHERE user_id = 999) as saved,
  (SELECT COUNT(DISTINCT article_id) FROM article_impressions WHERE user_id = 999) as impressions,
  (SELECT name FROM algorithm_profiles WHERE user_id = 999 AND is_active = 1) as profile
"

echo ""
echo "To reset to fresh state: ./reset-test-user.sh"
