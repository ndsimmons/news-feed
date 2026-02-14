-- Advanced Algorithm Settings
-- Add user preferences for enhanced recommendation algorithm

ALTER TABLE user_algorithm_settings ADD COLUMN include_metadata_in_embeddings BOOLEAN DEFAULT 1;
ALTER TABLE user_algorithm_settings ADD COLUMN dynamic_similarity_strength REAL DEFAULT 0.5;
ALTER TABLE user_algorithm_settings ADD COLUMN exploration_factor REAL DEFAULT 0.1;

-- include_metadata_in_embeddings: Whether to include author/source in embedding text (1 = yes, 0 = no)
-- dynamic_similarity_strength: Scale factor for boost/penalty (0.0 = weak +10/-10, 1.0 = strong +100/-100)
-- exploration_factor: Percentage of feed to fill with diverse articles (0.0 = none, 0.3 = 30%)
