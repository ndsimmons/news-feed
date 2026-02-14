-- Migration: Deduplicate Articles
-- Removes duplicate articles that have the same URL (with CDATA normalized)
-- Keeps the newer article (higher ID) and removes older duplicates

-- Disable foreign key constraints temporarily
PRAGMA foreign_keys = OFF;

-- Step 1: Clean up related data for duplicate articles (keep only highest ID per normalized URL)
-- Clean up article_embeddings
DELETE FROM article_embeddings
WHERE article_id IN (
  SELECT a1.id 
  FROM articles a1
  WHERE EXISTS (
    SELECT 1 
    FROM articles a2 
    WHERE REPLACE(REPLACE(a2.url, '<![CDATA[', ''), ']]>', '') = REPLACE(REPLACE(a1.url, '<![CDATA[', ''), ']]>', '')
    AND a2.id > a1.id
  )
);

-- Clean up votes
DELETE FROM votes
WHERE article_id IN (
  SELECT a1.id 
  FROM articles a1
  WHERE EXISTS (
    SELECT 1 
    FROM articles a2 
    WHERE REPLACE(REPLACE(a2.url, '<![CDATA[', ''), ']]>', '') = REPLACE(REPLACE(a1.url, '<![CDATA[', ''), ']]>', '')
    AND a2.id > a1.id
  )
);

-- Clean up article_impressions
DELETE FROM article_impressions
WHERE article_id IN (
  SELECT a1.id 
  FROM articles a1
  WHERE EXISTS (
    SELECT 1 
    FROM articles a2 
    WHERE REPLACE(REPLACE(a2.url, '<![CDATA[', ''), ']]>', '') = REPLACE(REPLACE(a1.url, '<![CDATA[', ''), ']]>', '')
    AND a2.id > a1.id
  )
);

-- Step 2: Delete duplicate articles (keep only highest ID per normalized URL)
DELETE FROM articles
WHERE id IN (
  SELECT a1.id 
  FROM articles a1
  WHERE EXISTS (
    SELECT 1 
    FROM articles a2 
    WHERE REPLACE(REPLACE(a2.url, '<![CDATA[', ''), ']]>', '') = REPLACE(REPLACE(a1.url, '<![CDATA[', ''), ']]>', '')
    AND a2.id > a1.id
  )
);

-- Step 3: Normalize URLs on remaining articles (remove CDATA wrappers)
UPDATE articles 
SET url = REPLACE(REPLACE(url, '<![CDATA[', ''), ']]>', '')
WHERE url LIKE '%CDATA%';

-- Re-enable foreign key constraints
PRAGMA foreign_keys = ON;
