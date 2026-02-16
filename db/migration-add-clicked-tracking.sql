-- Migration: Add click tracking to article impressions
-- Tracks when users actually click on articles vs just seeing them in the feed

ALTER TABLE article_impressions ADD COLUMN clicked BOOLEAN DEFAULT 0;
ALTER TABLE article_impressions ADD COLUMN clicked_at TEXT;

-- Index for fast lookups when analyzing click-through rates
CREATE INDEX IF NOT EXISTS idx_article_impressions_clicked 
  ON article_impressions(user_id, clicked);
