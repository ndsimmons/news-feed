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
  contentScore: number = 0, // NEW: embedding-based content similarity score
  recencyDecayHours: number = 24 // User's recency preference (12, 24, 48, or 72)
): number {
  // Base score starts at 100
  let score = 100;

  // 1. Category weight (learned from user behavior)
  const categoryWeight = weights.categories[article.category_id] || 1.0;
  score *= categoryWeight;

  // 2. Source weight (some sources preferred over others)
  const sourceWeight = weights.sources[article.source_id] || 1.0;
  score *= sourceWeight;

  // 3. Recency bonus (newer = better) - User-customizable decay
  const publishedAt = new Date(article.published_at);
  const now = new Date();
  const hoursOld = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
  
  // Decay over user's preference (default 24 hours), minimum multiplier of 0.1
  const recencyMultiplier = Math.max(0.1, 1 - (hoursOld / recencyDecayHours));
  score *= recencyMultiplier;

  // 4. Content-based similarity boost (NEW!)
  // This is the embedding magic - add similarity score to final result
  score += contentScore;

  // 5. Existing vote penalty (don't show already voted articles)
  if (hasVoted) {
    score *= 0.1; // heavily penalize
  }

  // 6. Boost very recent articles (< 2 hours old) - INCREASED BOOST
  if (hoursOld < 2) {
    score *= 2.0; // 100% boost for fresh content (was 1.5)
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

/**
 * Diverse scoring for logged-out or first-time users
 * Balances across categories and sources to show variety
 * Prioritizes recency with max diversity
 */
export function calculateDiverseScore(
  article: Article,
  recencyDecayHours: number = 24,
  seenSourceIds: Set<number> = new Set(),
  seenCategoryIds: Set<number> = new Set()
): number {
  let score = 100;

  // 1. Strong recency bias (newer = much better)
  const publishedAt = new Date(article.published_at);
  const now = new Date();
  const hoursOld = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
  
  // Exponential decay: very recent articles get big boost
  const recencyMultiplier = Math.max(0.1, 1 - (hoursOld / recencyDecayHours));
  score *= recencyMultiplier;

  // 2. Massive boost for very fresh content (< 2 hours)
  if (hoursOld < 2) {
    score *= 2.5; // 150% boost for breaking news
  }

  // 3. Diversity bonus: reward unseen categories and sources
  // This ensures variety across the feed
  if (!seenCategoryIds.has(article.category_id)) {
    score *= 1.3; // 30% bonus for new category
  }
  
  if (!seenSourceIds.has(article.source_id)) {
    score *= 1.2; // 20% bonus for new source
  }

  return Math.round(score * 100) / 100;
}

/**
 * Score and sort articles for diverse feed (logged-out/new users)
 * Ensures balanced distribution across categories and sources
 */
export function scoreAndSortArticlesDiverse(
  articles: Article[],
  recencyDecayHours: number = 24
): Article[] {
  const seenSourceIds = new Set<number>();
  const seenCategoryIds = new Set<number>();
  
  // Score all articles
  const scoredArticles = articles.map(article => ({
    ...article,
    score: calculateDiverseScore(
      article,
      recencyDecayHours,
      seenSourceIds,
      seenCategoryIds
    )
  }));

  // Sort by score
  scoredArticles.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Apply diversity: re-rank to ensure category/source variety
  const diverseArticles: Article[] = [];
  const articlePool = [...scoredArticles];
  
  while (articlePool.length > 0 && diverseArticles.length < 100) {
    // Find next article that maximizes diversity
    let bestIndex = 0;
    let bestScore = -1;
    
    for (let i = 0; i < Math.min(articlePool.length, 10); i++) {
      const article = articlePool[i];
      let diversityScore = article.score || 0;
      
      // Heavy bonus for unseen categories/sources
      if (!seenCategoryIds.has(article.category_id)) {
        diversityScore *= 1.5;
      }
      if (!seenSourceIds.has(article.source_id)) {
        diversityScore *= 1.3;
      }
      
      if (diversityScore > bestScore) {
        bestScore = diversityScore;
        bestIndex = i;
      }
    }
    
    const selectedArticle = articlePool.splice(bestIndex, 1)[0];
    diverseArticles.push(selectedArticle);
    seenCategoryIds.add(selectedArticle.category_id);
    seenSourceIds.add(selectedArticle.source_id);
  }

  return diverseArticles;
}
