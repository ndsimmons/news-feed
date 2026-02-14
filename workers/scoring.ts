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
 * Normalize scores to a bell curve distribution
 * Target: mean = 50, standard deviation = 20
 * This makes scores more intuitive and consistent across different feeds
 * Most scores will fall between 10-90 (within 2 standard deviations)
 */
export function normalizeScoresToBellCurve(articles: Article[]): Article[] {
  if (articles.length === 0) return articles;
  
  // Calculate mean and standard deviation of raw scores
  const scores = articles.map(a => a.score || 0);
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  
  // Avoid division by zero
  if (stdDev === 0) {
    return articles.map(a => ({ ...a, adjustedScore: 50 }));
  }
  
  // Transform each score: adjustedScore = 50 + 20 * (score - mean) / stdDev
  // This centers the distribution at 50 with a standard deviation of 20
  return articles.map(article => {
    const rawScore = article.score || 0;
    const zScore = (rawScore - mean) / stdDev; // How many std devs from mean
    const adjustedScore = Math.round(50 + 20 * zScore); // Scale to mean=50, stdDev=20
    
    return {
      ...article,
      adjustedScore: Math.max(0, adjustedScore) // Ensure non-negative
    };
  });
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
 * ========================================
 * ONBOARDING ALGORITHM
 * ========================================
 * For first-time users (0-24 votes)
 * 
 * Goals:
 * 1. Show balanced representation of ALL categories
 * 2. Minimize recency bias (all articles <24hrs are equal)
 * 3. Help users discover their interests across all topics
 * 
 * Strategy:
 * - Forces top article from each category in first 6 results
 * - Minimal recency decay (only filter out stale content)
 * - Strong diversity bonuses to ensure variety
 */
export function calculateOnboardingScore(
  article: Article,
  seenSourceIds: Set<number> = new Set(),
  seenCategoryIds: Set<number> = new Set()
): number {
  let score = 100;

  // 1. MINIMAL recency bias - only filter out old content
  // All articles within 24 hours are treated equally
  const publishedAt = new Date(article.published_at);
  const now = new Date();
  const hoursOld = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
  
  // Simple cutoff: <24hrs = full score, >24hrs = decay
  if (hoursOld < 24) {
    score *= 1.0; // No penalty for anything in last 24 hours
  } else {
    // Gradual decay for older content
    const recencyMultiplier = Math.max(0.3, 1 - (hoursOld / 48));
    score *= recencyMultiplier;
  }

  // 2. Diversity bonuses - reward variety
  if (!seenCategoryIds.has(article.category_id)) {
    score *= 2.0; // 100% bonus for new category
  }
  
  if (!seenSourceIds.has(article.source_id)) {
    score *= 1.5; // 50% bonus for new source
  }

  return Math.round(score * 100) / 100;
}

/**
 * ========================================
 * ADOPTION ALGORITHM
 * ========================================
 * For established logged-in users (10+ votes)
 * This is the FINAL algorithm state - users stay here permanently
 * 
 * Goals:
 * 1. Show fresh, breaking news
 * 2. Maintain category diversity
 * 3. Prioritize recency
 * 
 * Strategy:
 * - Strong recency bias (newer = better)
 * - Breaking news boost (<2 hours = 150%)
 * - Mandatory category rotation in first 6 articles
 * - Diversity bonuses to prevent category domination
 */
export function calculateAdoptionScore(
  article: Article,
  recencyDecayHours: number = 24,
  seenSourceIds: Set<number> = new Set(),
  seenCategoryIds: Set<number> = new Set(),
  weights: ScoringWeights = { categories: {}, sources: {} }
): number {
  let score = 100;

  // 1. Strong recency bias (newer = much better)
  const publishedAt = new Date(article.published_at);
  const now = new Date();
  const hoursOld = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
  
  // Exponential decay: very recent articles get big boost
  const recencyMultiplier = Math.max(0.1, 1 - (hoursOld / recencyDecayHours));
  score *= recencyMultiplier;

  // 2. Breaking news boost for very fresh content (< 2 hours)
  // High-volume sources (like Yahoo Finance) get reduced boost to prevent flooding
  if (hoursOld < 2) {
    // List of high-volume source IDs (>50 articles/day)
    const highVolumeSources = [4]; // Yahoo Finance
    const isHighVolume = highVolumeSources.includes(article.source_id);
    
    // High-volume sources get 1.4x, normal sources get 1.8x
    score *= isHighVolume ? 1.4 : 1.8;
  }

  // 3. PERSONALIZATION: Apply interest weights to boost preferred categories/sources
  const categoryWeight = weights.categories[article.category_id] || 1.0;
  const sourceWeight = weights.sources[article.source_id] || 1.0;
  score *= categoryWeight * sourceWeight;

  // 4. DIVERSITY bonus: reward unseen categories and sources (but smaller than personalization)
  // This ensures variety across the feed while still personalizing
  if (!seenCategoryIds.has(article.category_id)) {
    score *= 1.5; // 50% bonus for new category
  }
  
  if (!seenSourceIds.has(article.source_id)) {
    score *= 1.3; // 30% bonus for new source
  }

  // 5. Add fine-grained time variance to prevent clustering
  // Uses minutes/seconds of publish time to create natural variance
  const publishMinutes = publishedAt.getMinutes() + publishedAt.getSeconds() / 60;
  const timeVariation = (publishMinutes / 60) * 0.08 - 0.04; // Range: -0.04 to +0.04
  score *= (1 + timeVariation);

  // 6. Add article ID variation as tie-breaker
  const idVariation = ((article.id % 1000) / 1000) * 0.04 - 0.02; // Range: -0.02 to +0.02
  score *= (1 + idVariation);

  return Math.round(score * 100) / 100;
}

/**
 * Score and sort articles for ONBOARDING feed with SEED (first interaction)
 * Prioritizes articles similar to the seed article while maintaining category diversity
 */
export function scoreAndSortArticlesOnboardingWithSeed(
  articles: Article[],
  seedCategoryId: number,
  seedSourceId: number
): Article[] {
  const seenSourceIds = new Set<number>();
  const seenCategoryIds = new Set<number>();
  
  // Score all articles with seed boost
  const scoredArticles = articles.map(article => {
    let score = calculateOnboardingScore(article, seenSourceIds, seenCategoryIds);
    
    // MASSIVE boost for same category as seed (3x multiplier)
    if (article.category_id === seedCategoryId) {
      score *= 3.0;
    }
    
    // Strong boost for same source as seed (2x multiplier)
    if (article.source_id === seedSourceId) {
      score *= 2.0;
    }
    
    return {
      ...article,
      score
    };
  });

  // Sort by score
  scoredArticles.sort((a, b) => (b.score || 0) - (a.score || 0));

  // PHASE 1: PRIORITIZE SEED CATEGORY - First 3 articles from seed category
  const diverseArticles: Article[] = [];
  const articlePool = [...scoredArticles];
  
  // Get 3 best articles from seed category first
  for (let i = 0; i < 3 && articlePool.length > 0; i++) {
    const seedCategoryIndex = articlePool.findIndex(a => a.category_id === seedCategoryId);
    if (seedCategoryIndex >= 0) {
      const article = articlePool.splice(seedCategoryIndex, 1)[0];
      diverseArticles.push(article);
      seenCategoryIds.add(article.category_id);
      seenSourceIds.add(article.source_id);
    } else {
      break; // No more articles from seed category
    }
  }
  
  // PHASE 2: FILL WITH OTHER CATEGORIES - Ensure diversity
  const availableCategories = new Set(articlePool.map(a => a.category_id));
  const usedCategoriesInRotation = new Set<number>([seedCategoryId]); // Already used seed category
  
  // Add one article from each other category
  for (const catId of availableCategories) {
    if (usedCategoriesInRotation.has(catId)) continue;
    if (diverseArticles.length >= 6) break; // Limit to 6 for diversity
    
    const catIndex = articlePool.findIndex(a => a.category_id === catId);
    if (catIndex >= 0) {
      const article = articlePool.splice(catIndex, 1)[0];
      diverseArticles.push(article);
      usedCategoriesInRotation.add(catId);
      seenCategoryIds.add(article.category_id);
      seenSourceIds.add(article.source_id);
    }
  }
  
  // PHASE 3: CONTINUE WITH CATEGORY ROTATION (same as standard onboarding)
  const categoryCountMap = new Map<number, number>();
  
  // Initialize ALL available categories with count 0
  for (const catId of new Set([...availableCategories, seedCategoryId])) {
    categoryCountMap.set(catId, 0);
  }
  
  // Update counts from already selected articles
  for (const article of diverseArticles) {
    categoryCountMap.set(article.category_id, (categoryCountMap.get(article.category_id) || 0) + 1);
  }
  
  while (articlePool.length > 0 && diverseArticles.length < 100) {
    const leastUsedCount = Math.min(...Array.from(categoryCountMap.values()));
    
    let bestIndex = -1;
    let bestScore = -1;
    
    for (let i = 0; i < articlePool.length; i++) {
      const article = articlePool[i];
      const categoryCount = categoryCountMap.get(article.category_id) || 0;
      
      if (categoryCount <= leastUsedCount + 1) {
        const score = article.score || 0;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
    }
    
    if (bestIndex === -1 && articlePool.length > 0) {
      bestIndex = 0;
    }
    
    if (bestIndex >= 0) {
      const selectedArticle = articlePool.splice(bestIndex, 1)[0];
      diverseArticles.push(selectedArticle);
      categoryCountMap.set(selectedArticle.category_id, (categoryCountMap.get(selectedArticle.category_id) || 0) + 1);
      seenSourceIds.add(selectedArticle.source_id);
    } else {
      break;
    }
  }

  return diverseArticles;
}

/**
 * Score and sort articles for ONBOARDING feed (0-24 votes)
 * Ensures perfect category balance with minimal recency bias
 */
export function scoreAndSortArticlesOnboarding(
  articles: Article[]
): Article[] {
  const seenSourceIds = new Set<number>();
  const seenCategoryIds = new Set<number>();
  
  // Score all articles with onboarding algorithm
  const scoredArticles = articles.map(article => ({
    ...article,
    score: calculateOnboardingScore(
      article,
      seenSourceIds,
      seenCategoryIds
    )
  }));

  // Sort by score
  scoredArticles.sort((a, b) => (b.score || 0) - (a.score || 0));

  // PHASE 1: MANDATORY CATEGORY ROTATION - First 6 articles MUST be from different categories
  // This guarantees every category gets fair representation
  const diverseArticles: Article[] = [];
  const articlePool = [...scoredArticles];
  const usedCategoriesInFirstSix = new Set<number>();
  
  // Get all unique category IDs available
  const availableCategories = new Set(articlePool.map(a => a.category_id));
  
  // Force one article from each category in first 6 spots (up to 6 categories)
  const targetFirstArticles = Math.min(6, availableCategories.size);
  
  for (let slot = 0; slot < targetFirstArticles && articlePool.length > 0; slot++) {
    // Find the best article from an unseen category
    let bestIndex = -1;
    let bestScore = -1;
    
    for (let i = 0; i < articlePool.length; i++) {
      const article = articlePool[i];
      
      // Skip if we've already used this category in first 6
      if (usedCategoriesInFirstSix.has(article.category_id)) continue;
      
      const score = article.score || 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    
    if (bestIndex >= 0) {
      const selectedArticle = articlePool.splice(bestIndex, 1)[0];
      diverseArticles.push(selectedArticle);
      usedCategoriesInFirstSix.add(selectedArticle.category_id);
      seenCategoryIds.add(selectedArticle.category_id);
      seenSourceIds.add(selectedArticle.source_id);
    } else {
      break; // No more unique categories available
    }
  }
  
  // PHASE 2: CONTINUE WITH CATEGORY ROTATION
  // Keep rotating through categories to maintain balance throughout entire feed
  const categoryCountMap = new Map<number, number>();
  
  // Initialize ALL available categories with count 0
  for (const catId of availableCategories) {
    categoryCountMap.set(catId, 0);
  }
  
  // Update counts from first 6 articles
  for (const article of diverseArticles) {
    categoryCountMap.set(article.category_id, (categoryCountMap.get(article.category_id) || 0) + 1);
  }
  
  while (articlePool.length > 0 && diverseArticles.length < 100) {
    // Find the category that has been shown the LEAST so far
    const leastUsedCount = Math.min(...Array.from(categoryCountMap.values()));
    
    // Find best article from least-used categories
    let bestIndex = -1;
    let bestScore = -1;
    
    for (let i = 0; i < articlePool.length; i++) {
      const article = articlePool[i];
      const categoryCount = categoryCountMap.get(article.category_id) || 0;
      
      // Only consider articles from least-used categories (±1 for flexibility)
      if (categoryCount <= leastUsedCount + 1) {
        const score = article.score || 0;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
    }
    
    // If no articles found from least-used categories, just take the best remaining
    if (bestIndex === -1 && articlePool.length > 0) {
      bestIndex = 0;
    }
    
    if (bestIndex >= 0) {
      const selectedArticle = articlePool.splice(bestIndex, 1)[0];
      diverseArticles.push(selectedArticle);
      categoryCountMap.set(selectedArticle.category_id, (categoryCountMap.get(selectedArticle.category_id) || 0) + 1);
      seenSourceIds.add(selectedArticle.source_id);
    } else {
      break;
    }
  }

  return diverseArticles;
}

/**
 * Score and sort articles for ADOPTION feed (10+ votes, logged out)
 * Balances fresh breaking news with category diversity
 */
export function scoreAndSortArticlesAdoption(
  articles: Article[],
  recencyDecayHours: number = 24,
  weights: ScoringWeights = { categories: {}, sources: {} }
): Article[] {
  const seenSourceIds = new Set<number>();
  const seenCategoryIds = new Set<number>();
  
  // Score all articles with adoption algorithm
  const scoredArticles = articles.map(article => ({
    ...article,
    score: calculateAdoptionScore(
      article,
      recencyDecayHours,
      seenSourceIds,
      seenCategoryIds,
      weights
    )
  }));

  // Sort by score
  scoredArticles.sort((a, b) => (b.score || 0) - (a.score || 0));

  // PHASE 1: MANDATORY CATEGORY ROTATION - First 6 articles MUST be from different categories
  // This guarantees variety at the top of the feed
  const diverseArticles: Article[] = [];
  const articlePool = [...scoredArticles];
  const usedCategoriesInFirstSix = new Set<number>();
  
  // Get all unique category IDs available
  const availableCategories = new Set(articlePool.map(a => a.category_id));
  
  // Force one article from each category in first 6 spots (up to 6 categories)
  const targetFirstArticles = Math.min(6, availableCategories.size);
  
  for (let slot = 0; slot < targetFirstArticles && articlePool.length > 0; slot++) {
    // Find the best article from an unseen category
    let bestIndex = -1;
    let bestScore = -1;
    
    for (let i = 0; i < articlePool.length; i++) {
      const article = articlePool[i];
      
      // Skip if we've already used this category in first 6
      if (usedCategoriesInFirstSix.has(article.category_id)) continue;
      
      const score = article.score || 0;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    
    if (bestIndex >= 0) {
      const selectedArticle = articlePool.splice(bestIndex, 1)[0];
      diverseArticles.push(selectedArticle);
      usedCategoriesInFirstSix.add(selectedArticle.category_id);
      seenCategoryIds.add(selectedArticle.category_id);
      seenSourceIds.add(selectedArticle.source_id);
    } else {
      break; // No more unique categories available
    }
  }
  
  // PHASE 2: SCORE-BASED SELECTION WITH DIMINISHING RETURNS FOR REPEATED SOURCES
  // Apply penalty to prevent any single source from dominating the feed
  const sourceCountMap = new Map<number, number>();
  
  // Initialize counts from Phase 1
  for (const article of diverseArticles) {
    sourceCountMap.set(article.source_id, (sourceCountMap.get(article.source_id) || 0) + 1);
  }
  
  while (articlePool.length > 0 && diverseArticles.length < 100) {
    // Apply diminishing returns penalty to articles from repeated sources
    let bestIndex = -1;
    let bestAdjustedScore = -1;
    
    // Look at top 20 articles to find best considering diminishing returns
    for (let i = 0; i < Math.min(20, articlePool.length); i++) {
      const article = articlePool[i];
      const baseScore = article.score || 0;
      const sourceCount = sourceCountMap.get(article.source_id) || 0;
      
      // Apply diminishing returns: 1st=100%, 2nd=90%, 3rd=85%, 4th=80%, etc.
      const diminishingMultiplier = Math.max(0.7, 1 - (sourceCount * 0.05));
      const adjustedScore = baseScore * diminishingMultiplier;
      
      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestIndex = i;
      }
    }
    
    if (bestIndex >= 0) {
      const selectedArticle = articlePool.splice(bestIndex, 1)[0];
      diverseArticles.push(selectedArticle);
      seenCategoryIds.add(selectedArticle.category_id);
      seenSourceIds.add(selectedArticle.source_id);
      sourceCountMap.set(selectedArticle.source_id, (sourceCountMap.get(selectedArticle.source_id) || 0) + 1);
    } else {
      break;
    }
  }

  return diverseArticles;
}
