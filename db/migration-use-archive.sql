-- Add use_archive flag to sources table
-- When enabled, article links from this source are redirected through archive.is
ALTER TABLE sources ADD COLUMN use_archive BOOLEAN DEFAULT 0;

-- Enable for paywalled sources
UPDATE sources SET use_archive = 1 WHERE url LIKE '%nytimes.com%';
UPDATE sources SET use_archive = 1 WHERE url LIKE '%wsj.com%';
