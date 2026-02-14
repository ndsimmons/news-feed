-- Migration: Add source diversity multiplier to user algorithm settings
-- Allows users to control how much they want to see variety vs. concentration of sources

-- Add source_diversity_multiplier column (default 0.5 = balanced)
ALTER TABLE user_algorithm_settings ADD COLUMN source_diversity_multiplier REAL DEFAULT 0.5;

-- Valid range: 0.0 (maximum diversity) to 1.0 (no diversity penalty)
-- 0.0 = Heavy penalty for repeated sources (max variety)
-- 0.5 = Balanced (default)
-- 1.0 = No penalty (let scoring decide, more concentration)
