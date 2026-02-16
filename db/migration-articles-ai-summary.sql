-- Add ai_summary column to articles table (unified summary storage)
-- Previously summaries were stored per-user in saved_articles.ai_summary
-- Now stored once per article in articles.ai_summary
ALTER TABLE articles ADD COLUMN ai_summary TEXT DEFAULT NULL;
