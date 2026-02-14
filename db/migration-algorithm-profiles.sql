-- Algorithm Profiles
-- Allows users to create, save, and switch between different algorithm configurations
-- This enables "Work Mode", "Discovery Mode", etc.

CREATE TABLE IF NOT EXISTS algorithm_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT 0,
  is_default BOOLEAN DEFAULT 0,
  
  -- Algorithm settings (same as user_algorithm_settings)
  recency_decay_hours INTEGER DEFAULT 24,
  source_diversity_multiplier REAL DEFAULT 0.5,
  include_metadata_in_embeddings BOOLEAN DEFAULT 1,
  dynamic_similarity_strength REAL DEFAULT 0.5,
  exploration_factor REAL DEFAULT 0.1,
  
  -- Future extensibility - JSON blob for advanced settings
  advanced_config TEXT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_profile_user_active ON algorithm_profiles(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_profile_user_default ON algorithm_profiles(user_id, is_default);

-- Migrate existing user_algorithm_settings to Default profiles
INSERT INTO algorithm_profiles (
  user_id,
  name,
  description,
  is_active,
  is_default,
  recency_decay_hours,
  source_diversity_multiplier,
  include_metadata_in_embeddings,
  dynamic_similarity_strength,
  exploration_factor,
  created_at,
  updated_at
)
SELECT 
  user_id,
  'Default' as name,
  'Your default algorithm settings' as description,
  1 as is_active,
  1 as is_default,
  COALESCE(recency_decay_hours, 24),
  COALESCE(source_diversity_multiplier, 0.5),
  COALESCE(include_metadata_in_embeddings, 1),
  COALESCE(dynamic_similarity_strength, 0.5),
  COALESCE(exploration_factor, 0.1),
  created_at,
  updated_at
FROM user_algorithm_settings
WHERE NOT EXISTS (
  SELECT 1 FROM algorithm_profiles 
  WHERE algorithm_profiles.user_id = user_algorithm_settings.user_id
);
