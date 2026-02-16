-- Add click_treatment column to sources table
-- Consolidates use_archive, is_aggregator, and spotify_url into a single column
-- Values: 'direct' (default), 'archive', 'aggregator', 'spotify'
ALTER TABLE sources ADD COLUMN click_treatment TEXT DEFAULT 'direct';

-- Migrate existing flags into click_treatment
UPDATE sources SET click_treatment = 'archive' WHERE use_archive = 1;
UPDATE sources SET click_treatment = 'aggregator' WHERE is_aggregator = 1;
UPDATE sources SET click_treatment = 'spotify' WHERE spotify_url IS NOT NULL AND spotify_url != '';
