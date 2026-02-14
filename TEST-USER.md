# Test User - First-Time Experience

## Overview
A dedicated test user account that simulates the first-time user experience on Nicofeed.

**Email:** `test-firsttime@nicofeed.com`  
**User ID:** 999

## Purpose
Use this account to:
- Test the onboarding experience
- See what feed rankings look like with zero personalization
- Verify the algorithm learns correctly from scratch
- Demo the product to others
- QA new features with a fresh slate

## Current State
- ✅ No votes (0 upvotes, 0 downvotes)
- ✅ No saved articles
- ✅ No article impressions
- ✅ Default algorithm profile (neutral weights)
- ✅ All sources enabled
- ✅ Fresh category/source weights (all 1.0)

## How to Use

### 1. Sign In
Visit https://nicofeed.com and sign in with:
```
test-firsttime@nicofeed.com
```

Check your email for the magic link (or use the Cloudflare Workers logs to get the link).

### 2. Experience the First-Time Feed
- Feed will show articles ranked by recency and default scoring
- No personalization (algorithm hasn't learned your preferences yet)
- All categories weighted equally
- Mix of all content types

### 3. Start Voting
- Upvote/downvote articles to train the algorithm
- Watch the feed adapt in real-time
- See how different categories/sources get boosted/penalized

### 4. Reset Anytime
When you want to return to the fresh state:

```bash
./reset-test-user.sh
```

Or manually:
```bash
npx wrangler d1 execute news-feed-db --remote --file=./db/reset-test-user.sql
```

## What Gets Reset
- All votes deleted
- All saved articles removed
- All article impressions cleared
- All learned interest weights reset to 1.0
- Algorithm profile reset to default settings
- User source preferences cleared

## What Stays
- The user account itself (user 999)
- Available articles in the feed
- Source configurations

## Feed Behavior (Fresh State)

**Ranking Algorithm:**
```
Base Score = recency_weight × source_weight × category_weight × content_similarity

Where:
- recency_weight: Decays over 24 hours
- source_weight: 1.0 (neutral, no preference)
- category_weight: 1.0 (neutral, all equal)
- content_similarity: 0.5 (default exploration factor)
```

**First Feed:**
- Shows most recent articles first
- All categories equally represented
- No personalization
- Pure chronological + quality scoring

**After 5-10 votes:**
- Algorithm starts learning
- Upvoted categories/sources get boosted
- Downvoted categories/sources get penalized
- Content similarity kicks in (more like what you liked)

## Use Cases

### Testing Onboarding
```bash
./reset-test-user.sh
# Sign in as test-firsttime@nicofeed.com
# Walk through first-time experience
```

### Demo to Stakeholders
```bash
./reset-test-user.sh
# Show clean slate → personalized feed transformation
```

### QA New Features
```bash
./reset-test-user.sh
# Test feature with fresh user
# Verify algorithm adapts correctly
```

### A/B Testing Algorithm Changes
```bash
# Baseline: Use test user, note feed ranking
./reset-test-user.sh
# Changed algo: See how different settings affect fresh users
```

## Notes
- User 999 is reserved for testing - don't use in production
- Reset script is safe to run anytime
- This user will never receive actual emails (use worker logs to get magic links)
- Keep this user clean - don't use for personal testing that you want to persist

## Quick Reference

**Reset:** `./reset-test-user.sh`  
**Sign in:** test-firsttime@nicofeed.com  
**User ID:** 999  
**Purpose:** First-time experience testing  
