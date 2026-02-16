-- Add is_aggregator flag to sources table
-- Aggregator sources link to articles from other publications.
-- When a user clicks an aggregator article, the original publication
-- can be auto-added as a source for that user.
ALTER TABLE sources ADD COLUMN is_aggregator BOOLEAN DEFAULT 0;

-- Techmeme is an aggregator (RSS parser already extracts original URLs)
UPDATE sources SET is_aggregator = 1 WHERE id = 1;
