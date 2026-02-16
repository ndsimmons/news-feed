-- Add AI-generated summary column to saved_articles table
-- Stores a concise 35-word summary generated on save
ALTER TABLE saved_articles ADD COLUMN ai_summary TEXT;
