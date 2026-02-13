// Recommendation Algorithm for News Feed

import type { Article, ScoringWeights, ScoringParams, InterestWeight } from '../src/lib/types';

/**
 * Calculate article score based on various factors
 * 
 * Formula: score = (category_weight × source_weight × recency) + content_similarity_bonus
 */
export function calculateArticleScore(
  article: Article,
  weights: ScoringWeights,
  hasVoted: boolean = false,
  contentScore: number = 0 // NEW: embedding-based content similarity score
): number {
  // Base score starts at 100
  let score = 100;

  // 1. Category weight (learned from user behavior)
  const categoryWeight = weights.categories[article.category_id] || 1.0;
  score *= categoryWeight;

  // 2. Source weight (some sources preferred over others)
  const sourceWeight = weights.sources[article.source_id] || 1.0;
  score *= sourceWeight;

  // 3. Recency bonus (newer = better)
  const publishedAt = new Date(article.published_at);
  const now = new Date();
  const hoursOld = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
  
  // Decay over 72 hours (3 days), minimum multiplier of 0.2
  const recencyMultiplier = Math.max(0.2, 1 - (hoursOld / 72));
  score *= recencyMultiplier;

  // 4. Content-based similarity boost (NEW!)
  // This is the embedding magic - add similarity score to final result
  score += contentScore;

  // 5. Existing vote penalty (don't show already voted articles)
  if (hasVoted) {
    score *= 0.1; // heavily penalize
  }

  // 6. Boost very recent articles (< 2 hours old)
  if (hoursOld < 2) {
    score *= 1.5; // 50% boost for fresh content
  }

  return Math.round(score * 100) / 100; // Round to 2 decimal places
}

/**
 * Update user weights after a vote
 * Adjusts category and source weights by ±10% per vote
 */
export function updateWeights(
  vote: number, // -1 or 1
  article: Article,
  currentWeights: ScoringWeights
): ScoringWeights {
  const adjustment = vote === 1 ? 0.1 : -0.1; // +/-10% per vote
  const newWeights = JSON.parse(JSON.stringify(currentWeights)); // Deep clone

  // Update category weight (clamp between 0.1 and 2.0)
  const currentCategoryWeight = newWeights.categories[article.category_id] || 1.0;
  newWeights.categories[article.category_id] = clamp(
    currentCategoryWeight + adjustment,
    0.1,
    2.0
  );

  // Update source weight (clamp between 0.1 and 2.0)
  const currentSourceWeight = newWeights.sources[article.source_id] || 1.0;
  newWeights.sources[article.source_id] = clamp(
    currentSourceWeight + adjustment,
    0.1,
    2.0
  );

  return newWeights;
}

/**
 * Convert InterestWeight array to ScoringWeights object
 */
export function interestWeightsToScoringWeights(
  interestWeights: InterestWeight[]
): ScoringWeights {
  const weights: ScoringWeights = {
    categories: {},
    sources: {}
  };

  for (const iw of interestWeights) {
    if (iw.category_id) {
      weights.categories[iw.category_id] = iw.weight;
    }
    if (iw.source_id) {
      weights.sources[iw.source_id] = iw.weight;
    }
  }

  return weights;
}

/**
 * Clamp a number between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Score multiple articles and sort by score descending
 */
export function scoreAndSortArticles(
  articles: Article[],
  weights: ScoringWeights,
  votedArticleIds: Set<number>
): Article[] {
  return articles
    .map(article => ({
      ...article,
      score: calculateArticleScore(
        article,
        weights,
        votedArticleIds.has(article.id)
      )
    }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

/**
 * Get top N articles with highest scores
 */
export function getTopArticles(
  articles: Article[],
  weights: ScoringWeights,
  votedArticleIds: Set<number>,
  limit: number = 20
): Article[] {
  const scored = scoreAndSortArticles(articles, weights, votedArticleIds);
  return scored.slice(0, limit);
}
