#!/bin/bash
# Reset test user to first-time experience
# Usage: ./reset-test-user.sh

echo "🔄 Resetting test user (test-firsttime@nicofeed.com) to fresh state..."
npx wrangler d1 execute news-feed-db --remote --file=./db/reset-test-user.sql
echo "✅ Test user reset complete!"
echo ""
echo "📧 To test the first-time experience:"
echo "   1. Sign in with: test-firsttime@nicofeed.com"
echo "   2. Feed will show default rankings (no personalization)"
echo "   3. Start voting to see algorithm learn your preferences"
echo ""
echo "🔄 Run this script anytime to reset back to fresh state"
