// Cloudflare Workers API
// Handles all API endpoints for the news feed

import type { 
  Article, 
  FeedResponse, 
  VoteRequest, 
  VoteResponse,
  Category,
  Source 
} from '../src/lib/types';
import { 
  calculateArticleScore, 
  updateWeights, 
  interestWeightsToScoringWeights,
  getTopArticles,
  scoreAndSortArticlesOnboarding,
  scoreAndSortArticlesOnboardingWithSeed,
  scoreAndSortArticlesAdoption,
  normalizeScoresToBellCurve
} from './scoring';
import {
  generateArticleEmbedding,
  storeEmbedding
} from './embeddings';

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (normA * normB);
}

/**
 * Calculate content score by comparing article directly to user's liked/disliked embeddings
 * @param strengthMultiplier - User preference 0.0-1.0 (weak to strong similarity impact)
 */
function calculateDirectContentScore(
  articleEmbedding: number[],
  likedEmbeddings: number[][],
  dislikedEmbeddings: number[][],
  strengthMultiplier: number = 0.5
): number {
  let score = 0;
  
  // Calculate dynamic boost/penalty range based on user preference
  // strengthMultiplier 0.0 = weak (+10/-10), 0.5 = medium (+55/-55), 1.0 = strong (+100/-100)
  const maxBoost = 10 + (strengthMultiplier * 90);    // 10 to 100
  const maxPenalty = 10 + (strengthMultiplier * 90);  // 10 to 100
  
  // Compare to liked articles
  if (likedEmbeddings.length > 0) {
    let totalSimilarity = 0;
    for (const likedEmbed of likedEmbeddings) {
      const similarity = cosineSimilarity(articleEmbedding, likedEmbed);
      totalSimilarity += similarity;
    }
    const avgLikedSimilarity = totalSimilarity / likedEmbeddings.length;
    score += avgLikedSimilarity * maxBoost;
  }
  
  // Compare to disliked articles
  if (dislikedEmbeddings.length > 0) {
    let totalSimilarity = 0;
    for (const dislikedEmbed of dislikedEmbeddings) {
      const similarity = cosineSimilarity(articleEmbedding, dislikedEmbed);
      totalSimilarity += similarity;
    }
    const avgDislikedSimilarity = totalSimilarity / dislikedEmbeddings.length;
    score -= avgDislikedSimilarity * maxPenalty;
  }
  
  return Math.round(score * 100) / 100;
}

interface Env {
  DB: D1Database;
  KV: KVNamespace;
  AI: any; // Cloudflare AI binding
  VECTORIZE: any; // Vectorize binding
  RESEND_API_KEY: string; // Resend API key for magic links
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers with aggressive anti-caching for mobile browsers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, private',
      'Pragma': 'no-cache',
      'Expires': '0'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route handlers
      if (path === '/api/feed' && request.method === 'GET') {
        return await handleGetFeed(request, env, corsHeaders);
      }

      if (path === '/api/vote' && request.method === 'POST') {
        return await handleVote(request, env, corsHeaders);
      }

      if (path === '/api/categories' && request.method === 'GET') {
        return await handleGetCategories(env, corsHeaders);
      }

      if (path === '/api/sources' && request.method === 'GET') {
        return await handleGetSources(env, corsHeaders);
      }

      if (path.startsWith('/api/sources/') && request.method === 'PUT') {
        return await handleUpdateSource(request, env, corsHeaders);
      }

      if (path === '/api/sources' && request.method === 'POST') {
        return await handleAddSource(request, env, corsHeaders);
      }

      if (path.startsWith('/api/sources/') && request.method === 'DELETE') {
        return await handleDeleteSource(request, env, corsHeaders);
      }

      // Auth endpoints
      if (path === '/api/auth/send-magic-link' && request.method === 'POST') {
        return await handleSendMagicLink(request, env, corsHeaders);
      }

      if (path === '/api/auth/verify' && request.method === 'POST') {
        return await handleVerifyToken(request, env, corsHeaders);
      }

      if (path === '/api/auth/check-session' && request.method === 'POST') {
        return await handleCheckSession(request, env, corsHeaders);
      }

      if (path === '/api/auth/validate-session' && request.method === 'POST') {
        return await handleValidateSession(request, env, corsHeaders);
      }

      if (path === '/api/refresh' && request.method === 'POST') {
        return await handleRefreshFeed(request, env, corsHeaders);
      }

      if (path === '/api/preferences' && request.method === 'GET') {
        return await handleGetPreferences(request, env, corsHeaders);
      }

      if (path === '/api/preferences' && request.method === 'POST') {
        return await handleSavePreferences(request, env, corsHeaders);
      }

      if (path === '/api/impressions' && request.method === 'POST') {
        return await handleTrackImpression(request, env, corsHeaders);
      }

      if (path === '/api/sources' && request.method === 'GET') {
        return await handleGetSources(request, env, corsHeaders);
      }

      if (path === '/api/user-sources' && request.method === 'GET') {
        return await handleGetUserSources(request, env, corsHeaders);
      }

      if (path === '/api/user-sources' && request.method === 'POST') {
        return await handleSaveUserSources(request, env, corsHeaders);
      }

      if (path === '/api/user/stats' && request.method === 'GET') {
        return await handleGetUserStats(request, env, corsHeaders);
      }

      if (path === '/api/user/display-name' && request.method === 'POST') {
        return await handleUpdateDisplayName(request, env, corsHeaders);
      }

      if (path === '/api/recalculate-score' && request.method === 'POST') {
        return await handleRecalculateScore(request, env, corsHeaders);
      }

      if (path === '/api/seed-algorithm' && request.method === 'POST') {
        return await handleSeedAlgorithm(request, env, corsHeaders);
      }

      if (path === '/api/backfill-weights' && request.method === 'POST') {
        return await handleBackfillWeights(request, env, corsHeaders);
      }

      // TEST ENDPOINT - Auto login as test user 999 (ONLY for development/testing)
      if (path === '/api/test-login' && request.method === 'POST') {
        return await handleTestLogin(request, env, corsHeaders);
      }

      // Profile management endpoints
      if (path === '/api/profiles' && request.method === 'GET') {
        return await handleGetProfiles(request, env, corsHeaders);
      }

      if (path === '/api/profiles' && request.method === 'POST') {
        return await handleCreateProfile(request, env, corsHeaders);
      }

      if (path.startsWith('/api/profiles/') && request.method === 'PUT') {
        return await handleUpdateProfile(request, env, corsHeaders);
      }

      if (path.startsWith('/api/profiles/') && path.endsWith('/activate') && request.method === 'POST') {
        return await handleActivateProfile(request, env, corsHeaders);
      }

      if (path.startsWith('/api/profiles/') && request.method === 'DELETE') {
        return await handleDeleteProfile(request, env, corsHeaders);
      }

      // Saved Articles endpoints
      if (path === '/api/saved' && request.method === 'GET') {
        return await handleGetSavedArticles(request, env, corsHeaders);
      }

      if (path === '/api/saved' && request.method === 'POST') {
        return await handleSaveArticle(request, env, corsHeaders);
      }

      if (path.startsWith('/api/saved/') && request.method === 'DELETE') {
        return await handleUnsaveArticle(request, env, corsHeaders);
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('API Error:', error);
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * GET /api/feed - Get personalized article feed with embedding-based content scoring
 */
async function handleGetFeed(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const categorySlug = url.searchParams.get('category');
  const userId = parseInt(url.searchParams.get('userId') || '1');

  // Get user's algorithm preferences from active profile (or fallback to old table)
  let prefsResult = await env.DB.prepare(
    'SELECT recency_decay_hours, source_diversity_multiplier, include_metadata_in_embeddings, dynamic_similarity_strength, exploration_factor FROM algorithm_profiles WHERE user_id = ? AND is_active = 1'
  ).bind(userId).first();
  
  // Fallback to old table if no active profile
  if (!prefsResult) {
    prefsResult = await env.DB.prepare(
      'SELECT recency_decay_hours, source_diversity_multiplier, include_metadata_in_embeddings, dynamic_similarity_strength, exploration_factor FROM user_algorithm_settings WHERE user_id = ?'
    ).bind(userId).first();
  }
  
  const recencyDecayHours = (prefsResult?.recency_decay_hours as number) || 24;
  const sourceDiversityMultiplier = (prefsResult?.source_diversity_multiplier as number) ?? 0.5;
  const includeMetadata = (prefsResult?.include_metadata_in_embeddings as number) !== 0; // Default true
  const similarityStrength = (prefsResult?.dynamic_similarity_strength as number) ?? 0.5;
  const explorationFactor = (prefsResult?.exploration_factor as number) ?? 0.1;

  // Get user's interest weights
  const weightsResult = await env.DB.prepare(
    'SELECT * FROM interest_weights WHERE user_id = ?'
  ).bind(userId).all();

  const weights = interestWeightsToScoringWeights(weightsResult.results as any[]);

  // Get voted article IDs
  const votedResult = await env.DB.prepare(
    'SELECT article_id FROM votes WHERE user_id = ?'
  ).bind(userId).all();

  const votedArticleIds = new Set(
    votedResult.results.map((v: any) => v.article_id)
  );

  // ========================================
  // ALGORITHM SELECTION LOGIC (2-Tier System)
  // ========================================
  // LOGGED OUT: Cannot vote. Shows generic diverse feed.
  // LOGGED IN + 0-24 votes: ONBOARDING ALGORITHM (balanced categories, minimal recency)
  // LOGGED IN + 10+ votes: ADOPTION ALGORITHM (recency-focused, breaking news)
  // ========================================
  
  const voteCount = votedResult.results.length;
  const isLoggedOut = userId === 0;
  const isOnboarding = !isLoggedOut && voteCount < 10; // First 10 votes = onboarding phase
  const isAdoption = !isLoggedOut && voteCount >= 10; // 10+ votes = adoption phase

  // NEW: Get user's liked and disliked articles for content-based scoring
  // Include both upvoted articles AND saved articles (saves count as likes for algorithm)
  const likedArticlesResult = await env.DB.prepare(`
    SELECT DISTINCT article_id FROM (
      SELECT article_id FROM votes WHERE user_id = ? AND vote = 1
      UNION
      SELECT article_id FROM saved_articles WHERE user_id = ?
    )
  `).bind(userId, userId).all();
  const likedArticleIds = likedArticlesResult.results.map((v: any) => v.article_id);

  const dislikedArticlesResult = await env.DB.prepare(
    'SELECT article_id FROM votes WHERE user_id = ? AND vote = -1'
  ).bind(userId).all();
  const dislikedArticleIds = dislikedArticlesResult.results.map((v: any) => v.article_id);

  // Build query for articles - exclude those seen 2+ times in last 7 days
  // AND respect user source preferences
  // AND exclude downvoted articles
  let query = `
    SELECT a.*, s.name as source_name, s.spotify_url as spotify_url, c.name as category_name, c.slug as category_slug
    FROM articles a
    LEFT JOIN sources s ON a.source_id = s.id
    LEFT JOIN categories c ON a.category_id = c.id
    LEFT JOIN user_source_preferences usp ON a.source_id = usp.source_id AND usp.user_id = ?
    WHERE a.published_at > datetime('now', '-7 days')
    AND NOT EXISTS (
      SELECT 1 FROM article_impressions ai
      WHERE ai.user_id = ?
        AND ai.article_id = a.id
        AND ai.impression_count >= 2
        AND ai.last_seen_at > datetime('now', '-7 days')
    )
    AND NOT EXISTS (
      SELECT 1 FROM votes v
      WHERE v.user_id = ?
        AND v.article_id = a.id
        AND v.vote = -1
    )
    AND (usp.active IS NULL OR usp.active = 1)
  `;

  const params: any[] = [userId, userId, userId]; // Add userId for source prefs, impression filter, and downvote filter

  if (categorySlug) {
    query += ' AND c.slug = ?';
    params.push(categorySlug);
  }

  // For logged-in users (onboarding + adoption), fetch balanced sample from each category
  // For logged-out users, also fetch balanced to show variety
  let articles: Article[] = [];
  
   if (!categorySlug) {
     // Fetch 1000 most recent articles regardless of category
     // Larger sample = better normalization + let scores determine what rises to the top
     const allQuery = query + ' ORDER BY a.published_at DESC LIMIT 1000';
     const allResult = await env.DB.prepare(allQuery).bind(...params).all();
     articles = allResult.results as Article[];
     
     console.log(`Fetched ${articles.length} articles (all categories, scored on merit)`);
   } else {
    // CATEGORY FILTERED: Fetch by recency for specific category
    query += ' ORDER BY a.published_at DESC LIMIT 100';
    const articlesResult = await env.DB.prepare(query).bind(...params).all();
    articles = articlesResult.results as Article[];
    console.log(`Processing ${articles.length} articles for category filter`);
  }
  
   console.log(`User has ${likedArticleIds.length} liked and ${dislikedArticleIds.length} disliked articles`);

   // ========================================
   // CONTENT SCORING: Fetch embeddings and compute content similarity scores
   // This runs BEFORE algorithm selection so all paths can use content scores
   // ========================================
   const contentScoreMap = new Map<number, number>();
   
   if (!isLoggedOut && (likedArticleIds.length > 0 || dislikedArticleIds.length > 0)) {
     try {
       // Fetch user's liked/disliked embeddings
       let likedEmbeddings: Array<{id: string, values: number[]}> = [];
       let dislikedEmbeddings: Array<{id: string, values: number[]}> = [];
       
       if (likedArticleIds.length > 0) {
         for (let i = 0; i < likedArticleIds.length; i += 20) {
           const batch = likedArticleIds.slice(i, i + 20);
           const batchResult = await env.VECTORIZE.getByIds(batch.map((id: number) => id.toString()));
           if (batchResult) likedEmbeddings.push(...batchResult);
         }
         console.log(`Retrieved ${likedEmbeddings.length} liked article embeddings`);
       }
       
       if (dislikedArticleIds.length > 0) {
         for (let i = 0; i < dislikedArticleIds.length; i += 20) {
           const batch = dislikedArticleIds.slice(i, i + 20);
           const batchResult = await env.VECTORIZE.getByIds(batch.map((id: number) => id.toString()));
           if (batchResult) dislikedEmbeddings.push(...batchResult);
         }
         console.log(`Retrieved ${dislikedEmbeddings.length} disliked article embeddings`);
       }
       
       if (likedEmbeddings.length > 0 || dislikedEmbeddings.length > 0) {
         // Batch fetch which articles have embeddings
         const articleIds = articles.map(a => a.id);
         const placeholders = articleIds.map(() => '?').join(',');
         const embeddingStatusResult = await env.DB.prepare(`
           SELECT article_id 
           FROM article_embeddings 
           WHERE article_id IN (${placeholders}) 
             AND embedding_generated = 1
         `).bind(...articleIds).all();
         
         const hasEmbeddingSet = new Set(
           embeddingStatusResult.results.map((r: any) => r.article_id)
         );
         
         console.log(`${hasEmbeddingSet.size} out of ${articleIds.length} articles have embeddings`);
         
         // Batch fetch article embeddings from Vectorize
         const articlesWithEmbeddings = articleIds.filter(id => hasEmbeddingSet.has(id));
         const allArticleEmbeddings = new Map<number, number[]>();
         
         if (articlesWithEmbeddings.length > 0) {
           const batchSize = 20;
           const batches = [];
           for (let i = 0; i < articlesWithEmbeddings.length; i += batchSize) {
             batches.push(articlesWithEmbeddings.slice(i, i + batchSize));
           }
           
           const embeddingBatchResults = await Promise.all(
             batches.map(batch => 
               env.VECTORIZE.getByIds(batch.map(id => id.toString()))
             )
           );
           
           embeddingBatchResults.forEach(results => {
             if (results) {
               results.forEach((emb: any) => {
                 allArticleEmbeddings.set(parseInt(emb.id), emb.values);
               });
             }
           });
           
           console.log(`Successfully retrieved ${allArticleEmbeddings.size} article embeddings`);
           
           // Calculate content scores for each article
           const likedEmbeddingValues = likedEmbeddings.map(e => e.values);
           const dislikedEmbeddingValues = dislikedEmbeddings.map(e => e.values);
           
           for (const article of articles) {
             const articleEmbedding = allArticleEmbeddings.get(article.id);
             if (articleEmbedding) {
               const score = calculateDirectContentScore(
                 articleEmbedding,
                 likedEmbeddingValues,
                 dislikedEmbeddingValues,
                 similarityStrength
               );
               if (score !== 0) {
                 contentScoreMap.set(article.id, score);
               }
             }
           }
           
           console.log(`Computed content scores for ${contentScoreMap.size} articles`);
         }
       }
     } catch (error) {
       console.error('Error computing content scores:', error);
     }
   }

   // Attach content scores to articles for use by all algorithm paths
   articles = articles.map(a => ({
     ...a,
     contentScore: contentScoreMap.get(a.id) || 0
   }));
   
   // ========================================
   // LOGGED OUT FEED (Generic Diverse Content)
   // ========================================
  // Users must log in to vote and progress through algorithms
  // Show balanced, recent content to encourage signup
  if (isLoggedOut) {
    console.log(`LOGGED OUT FEED: Showing generic diverse content`);
    
    // Use onboarding scoring for logged-out users (balanced, no recency bias)
    const diverseArticles = scoreAndSortArticlesOnboarding(articles);
    
    // Normalize scores to bell curve (mean=100, stdDev=20) before pagination
    const normalizedArticles = normalizeScoresToBellCurve(diverseArticles);
    
    // Apply pagination
    const topArticles = normalizedArticles.slice(offset, offset + limit);
    
    // Add user vote status (always 0 for logged out)
    const enrichedArticles = topArticles.map(article => ({
      ...article,
      userVote: 0
    }));
    
    // DEBUG: Log first article to verify adjustedScore is present
    if (enrichedArticles.length > 0) {
      const first = enrichedArticles[0];
      console.log(`📤 API Response - First article: id=${first.id}, score=${first.score}, adjustedScore=${first.adjustedScore}`);
    }
    
    const response: FeedResponse = {
      articles: enrichedArticles,
      total: diverseArticles.length,
      hasMore: offset + limit < diverseArticles.length
    };
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  
  // ========================================
  // ONBOARDING ALGORITHM (Logged in, 0-24 votes)
  // ========================================
  // Goal: Help users discover their interests across ALL categories
  // Strategy: Perfect category balance, minimal recency bias
  // Seeding: If user has a seed article, boost similar content (same category/source)
  // Transition: After 10 votes → Adoption Algorithm
  if (isOnboarding) {
    console.log(`ONBOARDING ALGORITHM: User ${userId} has ${voteCount}/10 votes`);
    
    // Check if user has a seed article from first interaction
    const seedResult = await env.DB.prepare(
      'SELECT category_id, source_id FROM user_seed_articles WHERE user_id = ?'
    ).bind(userId).first();
    
    let onboardingArticles;
    
    if (seedResult) {
      console.log(`User ${userId} has seed article: category=${seedResult.category_id}, source=${seedResult.source_id}`);
      
      // Score with seed boost - articles from same category/source get higher scores
      onboardingArticles = scoreAndSortArticlesOnboardingWithSeed(
        articles, 
        seedResult.category_id as number, 
        seedResult.source_id as number
      );
    } else {
      // Use standard onboarding scoring: balanced categories, minimal recency bias
      onboardingArticles = scoreAndSortArticlesOnboarding(articles);
    }
    
    // Normalize scores to bell curve (mean=100, stdDev=20) before pagination
    const normalizedArticles = normalizeScoresToBellCurve(onboardingArticles);
    
    // Apply pagination
    const topArticles = normalizedArticles.slice(offset, offset + limit);
    
    // Add user vote status
    const enrichedArticles = topArticles.map(article => ({
      ...article,
      userVote: votedArticleIds.has(article.id) ? 
        (votedResult.results.find((v: any) => v.article_id === article.id)?.vote || 0) : 0
    }));
    
    // DEBUG: Log first article to verify adjustedScore is present
    if (enrichedArticles.length > 0) {
      const first = enrichedArticles[0];
      console.log(`📤 API Response - First article: id=${first.id}, score=${first.score}, adjustedScore=${first.adjustedScore}`);
    }
    
    const response: FeedResponse = {
      articles: enrichedArticles,
      total: onboardingArticles.length,
      hasMore: offset + limit < onboardingArticles.length
    };
    
    return new Response(JSON.stringify(response), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'X-Algorithm': 'onboarding',
        'X-User-Id': userId.toString(),
        'X-Vote-Count': voteCount.toString()
      }
    });
  }
  
  // ========================================
  // ADOPTION ALGORITHM (Logged in, 10+ votes)
  // ========================================
  // Goal: Show fresh breaking news with category diversity
  // Strategy: Strong recency bias, breaking news boost, diversity bonuses
  // This is the FINAL algorithm state - no further transitions
  if (isAdoption) {
    console.log(`ADOPTION ALGORITHM: User ${userId} with ${voteCount} votes (established user)`);
    console.log('Interest weights:', JSON.stringify(weights));
    
    // Use adoption scoring: fresh content, balanced categories, WITH personalization
    const adoptionArticles = scoreAndSortArticlesAdoption(articles, recencyDecayHours, weights);
    
    // Normalize scores to bell curve (mean=100, stdDev=20) before pagination
    const normalizedArticles = normalizeScoresToBellCurve(adoptionArticles);
    
    // Apply pagination
    const topArticles = normalizedArticles.slice(offset, offset + limit);
    
    // Add user vote status
    const enrichedArticles = topArticles.map(article => ({
      ...article,
      userVote: votedArticleIds.has(article.id) ? 
        (votedResult.results.find((v: any) => v.article_id === article.id)?.vote || 0) : 0
    }));
    
    // DEBUG: Log first article to verify adjustedScore is present
    if (enrichedArticles.length > 0) {
      const first = enrichedArticles[0];
      console.log(`📤 API Response - First article: id=${first.id}, score=${first.score}, adjustedScore=${first.adjustedScore}`);
    }
    
    const response: FeedResponse = {
      articles: enrichedArticles,
      total: adoptionArticles.length,
      hasMore: offset + limit < adoptionArticles.length
    };
    
    return new Response(JSON.stringify(response), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'X-Algorithm': 'adoption',
        'X-User-Id': userId.toString(),
        'X-Vote-Count': voteCount.toString()
      }
    });
  }
  
   // ========================================
   // FALLBACK: Should never reach here
   // ========================================
   console.error(`ERROR: No algorithm matched for userId=${userId}, voteCount=${voteCount}`);
   
   // Return error response
   return new Response(JSON.stringify({ 
     error: 'Algorithm selection failed',
     userId,
     voteCount,
     isLoggedOut,
     isOnboarding,
     isAdoption
   }), {
     status: 500,
     headers: { ...corsHeaders, 'Content-Type': 'application/json' }
   });

}

/**
 * POST /api/vote - Vote on an article
 */
async function handleVote(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const body: VoteRequest = await request.json();
  const userId = body.userId || 1;

  // Get article
  const article = await env.DB.prepare(
    'SELECT * FROM articles WHERE id = ?'
  ).bind(body.articleId).first();

  if (!article) {
    return new Response(JSON.stringify({ error: 'Article not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Insert, update, or delete vote
  if (body.vote === 0) {
    // Unvote - delete the vote record
    await env.DB.prepare(`
      DELETE FROM votes WHERE user_id = ? AND article_id = ?
    `).bind(userId, body.articleId).run();
  } else {
    // Insert or update vote
    await env.DB.prepare(`
      INSERT INTO votes (user_id, article_id, vote) 
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, article_id) 
      DO UPDATE SET vote = ?, voted_at = CURRENT_TIMESTAMP
    `).bind(userId, body.articleId, body.vote, body.vote).run();
  }

  // Get current weights
  const weightsResult = await env.DB.prepare(
    'SELECT * FROM interest_weights WHERE user_id = ?'
  ).bind(userId).all();

  const currentWeights = interestWeightsToScoringWeights(weightsResult.results as any[]);

  // Update weights
  const newWeights = updateWeights(body.vote, article as Article, currentWeights);

  // Save updated weights to database
  const categoryWeight = newWeights.categories[article.category_id as number];
  const sourceWeight = newWeights.sources[article.source_id as number];

  // Update category weight (separate row where source_id IS NULL)
  console.log(`Updating category ${article.category_id} weight to ${categoryWeight} for user ${userId}`);
  await env.DB.prepare(`
    INSERT INTO interest_weights (user_id, category_id, source_id, weight, updated_at)
    VALUES (?, ?, NULL, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, category_id, source_id)
    DO UPDATE SET weight = ?, updated_at = CURRENT_TIMESTAMP
  `).bind(userId, article.category_id, categoryWeight, categoryWeight).run();

  // Update source weight (separate row where category_id IS NULL)
  console.log(`Updating source ${article.source_id} weight to ${sourceWeight} for user ${userId}`);
  await env.DB.prepare(`
    INSERT INTO interest_weights (user_id, category_id, source_id, weight, updated_at)
    VALUES (?, NULL, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, category_id, source_id)
    DO UPDATE SET weight = ?, updated_at = CURRENT_TIMESTAMP
  `).bind(userId, article.source_id, sourceWeight, sourceWeight).run();

  // NEW: Store preference for embedding-based recommendations
  await env.DB.prepare(`
    INSERT INTO user_preferences (user_id, article_id, vote) 
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, article_id) 
    DO UPDATE SET vote = ?, created_at = CURRENT_TIMESTAMP
  `).bind(userId, body.articleId, body.vote, body.vote).run();

  // NEW: Generate and store embedding if not exists (async, don't wait)
  try {
    const hasEmbedding = await env.DB.prepare(
      'SELECT embedding_generated FROM article_embeddings WHERE article_id = ?'
    ).bind(body.articleId).first();

    if (!hasEmbedding) {
      // Generate embedding in background
      const embResult = await generateArticleEmbedding(env.AI, article as Article);
      await storeEmbedding(env.VECTORIZE, body.articleId, embResult.embedding, {
        title: article.title,
        category_id: article.category_id,
        source_id: article.source_id
      });
      
      // Mark as generated
      await env.DB.prepare(`
        INSERT INTO article_embeddings (article_id, embedding_generated, embedding_model, generated_at)
        VALUES (?, 1, ?, CURRENT_TIMESTAMP)
      `).bind(body.articleId, embResult.model).run();
    }
  } catch (embError) {
    // Don't fail the vote if embedding fails
    console.error('Error generating embedding:', embError);
  }

  const response: VoteResponse = {
    success: true,
    vote: {
      id: 0, // Would be from INSERT result
      user_id: userId,
      article_id: body.articleId,
      vote: body.vote,
      voted_at: new Date().toISOString()
    }
  };

  return new Response(JSON.stringify(response), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * GET /api/categories - Get all categories
 */
async function handleGetCategories(
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const result = await env.DB.prepare('SELECT * FROM categories ORDER BY name').all();

  return new Response(JSON.stringify(result.results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * PUT /api/sources/:id - Update source
 */
async function handleUpdateSource(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();
  const body = await request.json();

  await env.DB.prepare(`
    UPDATE sources 
    SET name = ?, url = ?, config = ?, active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(body.name, body.url, body.config, body.active, id).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * POST /api/sources - Add new source
 */
async function handleAddSource(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const body = await request.json();

  const result = await env.DB.prepare(`
    INSERT INTO sources (name, url, category_id, fetch_method, config, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    body.name, 
    body.url, 
    body.category_id, 
    body.fetch_method, 
    body.config, 
    body.active
  ).run();

  return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * DELETE /api/sources/:id - Delete source
 */
async function handleDeleteSource(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();

  await env.DB.prepare('DELETE FROM sources WHERE id = ?').bind(id).run();

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Send a magic link to the user's email
 */
async function handleSendMagicLink(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { email } = await request.json() as { email: string };

  if (!email || !email.includes('@')) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Generate secure random token and session ID
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store token in database
  await env.DB.prepare(`
    INSERT INTO magic_links (email, token, expires_at)
    VALUES (?, ?, ?)
  `).bind(email, token, expiresAt.toISOString()).run();

  // Create active session for cross-device polling
  await env.DB.prepare(`
    INSERT INTO active_sessions (email, session_id, expires_at)
    VALUES (?, ?, ?)
  `).bind(email, sessionId, expiresAt.toISOString()).run();

  // Create or get user
  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  
  if (!user) {
    // Extract username from email (part before @)
    const username = email.split('@')[0];
    
    const result = await env.DB.prepare(`
      INSERT INTO users (email, username) VALUES (?, ?)
    `).bind(email, username).run();
    
    // Also initialize interest weights for new user
    const userId = result.meta.last_row_id;
    await env.DB.prepare(`
      INSERT INTO interest_weights (user_id, category_id, source_id, weight)
      SELECT ?, id, NULL, 1.0 FROM categories
      UNION ALL
      SELECT ?, NULL, id, 1.0 FROM sources
    `).bind(userId, userId).run();
  }

  // Send email via Resend (include sessionId in magic link)
  const magicLink = `https://nicofeed.com/?token=${token}&session=${sessionId}`;
  
  try {
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Nicofeed <login@nicofeed.com>',
        to: [email],
        subject: '🐔 Your Nicofeed Magic Link',
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #2563eb;">Welcome to Nicofeed!</h1>
            <p>Click the button below to sign in and start personalizing your news feed:</p>
            <div style="margin: 30px 0;">
              <a href="${magicLink}" 
                 style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                Sign in to Nicofeed
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">This link expires in 15 minutes.</p>
            <p style="color: #999; font-size: 12px;">If you didn't request this email, you can safely ignore it.</p>
          </div>
        `
      })
    });

    if (!emailResponse.ok) {
      console.error('Resend API error:', await emailResponse.text());
      throw new Error('Failed to send email');
    }
  } catch (error) {
    console.error('Error sending email:', error);
    return new Response(JSON.stringify({ error: 'Failed to send email' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ success: true, sessionId }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Verify a magic link token and return user session
 */
async function handleVerifyToken(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { token, sessionId } = await request.json() as { token: string; sessionId?: string };

  if (!token) {
    return new Response(JSON.stringify({ error: 'Token required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check if token exists and is valid
  const magicLink = await env.DB.prepare(`
    SELECT * FROM magic_links 
    WHERE token = ? AND used = 0 AND expires_at > datetime('now')
  `).bind(token).first();

  if (!magicLink) {
    return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Mark token as used
  await env.DB.prepare('UPDATE magic_links SET used = 1 WHERE token = ?').bind(token).run();

  // Get user
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
    .bind(magicLink.email as string)
    .first();

  if (!user) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Generate a new long-lived session token (30 days)
  const sessionToken = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  
  // Get device info from User-Agent
  const userAgent = request.headers.get('User-Agent') || 'Unknown';
  const deviceInfo = userAgent.substring(0, 200); // Store first 200 chars

  // Create session in database
  await env.DB.prepare(`
    INSERT INTO user_sessions (user_id, token, device_info, expires_at, last_used_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).bind(user.id, sessionToken, deviceInfo, expiresAt.toISOString()).run();

  // If sessionId provided, mark the session as authenticated for cross-device login
  if (sessionId) {
    await env.DB.prepare(`
      UPDATE active_sessions 
      SET authenticated = 1, auth_token = ? 
      WHERE session_id = ? AND email = ?
    `).bind(sessionToken, sessionId, magicLink.email).run();
  }

  return new Response(JSON.stringify({ 
    success: true, 
    user: {
      id: user.id,
      email: user.email
    },
    token: sessionToken // Return the new session token
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Check if a session has been authenticated (for cross-device polling)
 */
async function handleCheckSession(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { sessionId } = await request.json() as { sessionId: string };

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Session ID required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check if session is authenticated
  const session = await env.DB.prepare(`
    SELECT authenticated, auth_token, email 
    FROM active_sessions 
    WHERE session_id = ? AND expires_at > datetime('now')
  `).bind(sessionId).first();

  if (!session) {
    return new Response(JSON.stringify({ 
      authenticated: false,
      expired: true 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  if (!session.authenticated) {
    return new Response(JSON.stringify({ 
      authenticated: false 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Session is authenticated! Get user info and return token
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?')
    .bind(session.email as string)
    .first();

  return new Response(JSON.stringify({ 
    authenticated: true,
    user: {
      id: user?.id,
      email: user?.email
    },
    token: session.auth_token
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Validate a session token and refresh its expiration (sliding window)
 */
async function handleValidateSession(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { token } = await request.json() as { token: string };

  if (!token) {
    return new Response(JSON.stringify({ error: 'Token required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Check if session exists and is valid
  const session = await env.DB.prepare(`
    SELECT s.*, u.email, u.display_name 
    FROM user_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ 
      valid: false,
      error: 'Invalid or expired session' 
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Refresh session: update last_used_at and extend expiration by 30 days (sliding window)
  const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await env.DB.prepare(`
    UPDATE user_sessions 
    SET last_used_at = datetime('now'), expires_at = ?
    WHERE token = ?
  `).bind(newExpiresAt.toISOString(), token).run();

  return new Response(JSON.stringify({ 
    valid: true,
    user: {
      id: session.user_id,
      email: session.email,
      displayName: session.display_name || session.email?.split('@')[0] || 'User'
    }
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Trigger manual feed refresh - fetches latest articles
 */
async function handleRefreshFeed(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Trigger the fetcher worker to get fresh articles
    const fetcherUrl = 'https://news-feed-fetcher.nsimmons.workers.dev/api/fetch-now';
    
    // Fire and forget - don't wait for response
    fetch(fetcherUrl, { method: 'POST' }).catch(err => 
      console.error('Error triggering fetcher:', err)
    );
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Feed refresh triggered'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in refresh handler:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: 'Failed to trigger refresh'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * GET /api/preferences - Get user's algorithm preferences
 */
async function handleGetPreferences(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Validate token and get user
  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Get preferences from active profile (or fallback to old table)
  let prefs = await env.DB.prepare(`
    SELECT id as profile_id, name as profile_name, recency_decay_hours, source_diversity_multiplier, include_metadata_in_embeddings, dynamic_similarity_strength, exploration_factor 
    FROM algorithm_profiles 
    WHERE user_id = ? AND is_active = 1
  `).bind(session.user_id).first();

  // Fallback to old table if no active profile
  if (!prefs) {
    prefs = await env.DB.prepare(`
      SELECT recency_decay_hours, source_diversity_multiplier, include_metadata_in_embeddings, dynamic_similarity_strength, exploration_factor 
      FROM user_algorithm_settings 
      WHERE user_id = ?
    `).bind(session.user_id).first();
  }

  return new Response(JSON.stringify(prefs || { 
    recency_decay_hours: 24,
    source_diversity_multiplier: 0.5,
    include_metadata_in_embeddings: 1,
    dynamic_similarity_strength: 0.5,
    exploration_factor: 0.1
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * POST /api/preferences - Save user's algorithm preferences
 */
async function handleSavePreferences(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const { recency_decay_hours, source_diversity_multiplier, include_metadata_in_embeddings, dynamic_similarity_strength, exploration_factor } = await request.json() as { 
    recency_decay_hours?: number;
    source_diversity_multiplier?: number;
    include_metadata_in_embeddings?: boolean;
    dynamic_similarity_strength?: number;
    exploration_factor?: number;
  };

  // Validate recency_decay_hours if provided
  if (recency_decay_hours !== undefined && ![12, 24, 48, 72].includes(recency_decay_hours)) {
    return new Response(JSON.stringify({ error: 'Invalid recency_decay_hours' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Validate source_diversity_multiplier if provided (0.0 to 1.0)
  if (source_diversity_multiplier !== undefined && (source_diversity_multiplier < 0 || source_diversity_multiplier > 1)) {
    return new Response(JSON.stringify({ error: 'Invalid source_diversity_multiplier (must be 0.0-1.0)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Validate dynamic_similarity_strength if provided (0.0 to 1.0)
  if (dynamic_similarity_strength !== undefined && (dynamic_similarity_strength < 0 || dynamic_similarity_strength > 1)) {
    return new Response(JSON.stringify({ error: 'Invalid dynamic_similarity_strength (must be 0.0-1.0)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Validate exploration_factor if provided (0.0 to 0.5)
  if (exploration_factor !== undefined && (exploration_factor < 0 || exploration_factor > 0.5)) {
    return new Response(JSON.stringify({ error: 'Invalid exploration_factor (must be 0.0-0.5)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Validate token and get user
  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Build update query dynamically based on what's provided
  const updates: string[] = [];
  const values: any[] = [];

  if (recency_decay_hours !== undefined) {
    updates.push('recency_decay_hours = ?');
    values.push(recency_decay_hours);
  }
  if (source_diversity_multiplier !== undefined) {
    updates.push('source_diversity_multiplier = ?');
    values.push(source_diversity_multiplier);
  }
  if (include_metadata_in_embeddings !== undefined) {
    updates.push('include_metadata_in_embeddings = ?');
    values.push(include_metadata_in_embeddings ? 1 : 0);
  }
  if (dynamic_similarity_strength !== undefined) {
    updates.push('dynamic_similarity_strength = ?');
    values.push(dynamic_similarity_strength);
  }
  if (exploration_factor !== undefined) {
    updates.push('exploration_factor = ?');
    values.push(exploration_factor);
  }

  if (updates.length > 0) {
    updates.push('updated_at = datetime("now")');
    const updateClause = updates.join(', ');
    
    // Try to update active profile first
    const result = await env.DB.prepare(`
      UPDATE algorithm_profiles 
      SET ${updateClause}
      WHERE user_id = ? AND is_active = 1
    `).bind(...values, session.user_id).run();
    
    // Fallback: update old table if no profile updated
    if (result.meta.changes === 0) {
      await env.DB.prepare(`
        INSERT INTO user_algorithm_settings (
          user_id, 
          recency_decay_hours, 
          source_diversity_multiplier, 
          include_metadata_in_embeddings,
          dynamic_similarity_strength,
          exploration_factor,
          updated_at
        )
        VALUES (?, 24, 0.5, 1, 0.5, 0.1, datetime('now'))
        ON CONFLICT(user_id) DO UPDATE SET ${updateClause}
      `).bind(session.user_id, ...values).run();
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * POST /api/impressions - Track article impression (view)
 */
async function handleTrackImpression(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { articleIds, userId } = await request.json() as { articleIds: number[]; userId: number };

    if (!articleIds || !Array.isArray(articleIds) || articleIds.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid articleIds' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Batch upsert impressions
    for (const articleId of articleIds) {
      await env.DB.prepare(`
        INSERT INTO article_impressions (user_id, article_id, impression_count, first_seen_at, last_seen_at)
        VALUES (?, ?, 1, datetime('now'), datetime('now'))
        ON CONFLICT(user_id, article_id) DO UPDATE SET 
          impression_count = impression_count + 1,
          last_seen_at = datetime('now')
      `).bind(userId, articleId).run();
    }

    return new Response(JSON.stringify({ success: true, tracked: articleIds.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error tracking impression:', error);
    return new Response(JSON.stringify({ error: 'Failed to track impression' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * GET /api/sources - Get all active sources grouped by category
 */
async function handleGetSources(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const sources = await env.DB.prepare(`
      SELECT s.id, s.name, s.url, s.category_id, c.name as category_name, s.active
      FROM sources s
      JOIN categories c ON s.category_id = c.id
      WHERE s.active = 1
      ORDER BY c.name, s.name
    `).all();

    return new Response(JSON.stringify({ sources: sources.results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching sources:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch sources' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * GET /api/user-sources - Get user's source preferences
 */
async function handleGetUserSources(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Get all sources with user preferences
    const sources = await env.DB.prepare(`
      SELECT 
        s.id, 
        s.name, 
        s.url, 
        s.category_id, 
        c.name as category_name,
        COALESCE(usp.active, 1) as user_active
      FROM sources s
      JOIN categories c ON s.category_id = c.id
      LEFT JOIN user_source_preferences usp ON s.id = usp.source_id AND usp.user_id = ?
      WHERE s.active = 1
      ORDER BY c.name, s.name
    `).bind(session.user_id).all();

    return new Response(JSON.stringify({ sources: sources.results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching user sources:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch user sources' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * GET /api/user/stats - Get user statistics (vote count, etc.)
 */
async function handleGetUserStats(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const userId = parseInt(url.searchParams.get('userId') || '0');

  if (!userId) {
    return new Response(JSON.stringify({ error: 'User ID required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Get vote count
    const voteCountResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM votes WHERE user_id = ?'
    ).bind(userId).first();

    const voteCount = (voteCountResult as any)?.count || 0;

    return new Response(JSON.stringify({ 
      voteCount,
      isOnboarding: voteCount < 10
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch user stats' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/seed-algorithm - Seed algorithm based on first interaction
 */
async function handleSeedAlgorithm(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { userId, interactionType, articleId, categoryId, sourceId } = await request.json();

    console.log(`Seeding algorithm for user ${userId} based on ${interactionType} interaction with article ${articleId}`);

    // Store the seed article for this user
    await env.DB.prepare(`
      INSERT OR REPLACE INTO user_seed_articles (user_id, article_id, interaction_type, category_id, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(userId, articleId, interactionType, categoryId, sourceId).run();

    // If interaction was upvote or downvote, actually cast the vote
    if (interactionType === 'upvote' || interactionType === 'downvote') {
      const voteValue = interactionType === 'upvote' ? 1 : -1;
      
      await env.DB.prepare(`
        INSERT INTO votes (user_id, article_id, vote)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, article_id) 
        DO UPDATE SET vote = ?, voted_at = datetime('now')
      `).bind(userId, articleId, voteValue, voteValue).run();
      
      console.log(`Cast ${interactionType} vote for user ${userId} on article ${articleId}`);
    }

    // If interaction was save, save the article
    if (interactionType === 'save') {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO saved_articles (user_id, article_id, saved_at)
        VALUES (?, ?, datetime('now'))
      `).bind(userId, articleId).run();
      
      console.log(`Saved article ${articleId} for user ${userId}`);
    }

    // If interaction was upvote, save, or click, boost that category and source
    if (interactionType === 'upvote' || interactionType === 'save' || interactionType === 'click') {
      // Boost category weight
      await env.DB.prepare(`
        INSERT INTO interest_weights (user_id, category_id, weight)
        VALUES (?, ?, 1.3)
        ON CONFLICT(user_id, category_id, source_id) 
        DO UPDATE SET weight = 1.3
      `).bind(userId, categoryId, null).run();

      // Boost source weight
      await env.DB.prepare(`
        INSERT INTO interest_weights (user_id, source_id, weight)
        VALUES (?, ?, 1.2)
        ON CONFLICT(user_id, category_id, source_id) 
        DO UPDATE SET weight = 1.2
      `).bind(userId, null, sourceId).run();

      console.log(`Boosted category ${categoryId} to 1.3 and source ${sourceId} to 1.2 for user ${userId}`);
    }

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Algorithm seeded successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error seeding algorithm:', error);
    return new Response(JSON.stringify({ error: 'Failed to seed algorithm' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/backfill-weights - Rebuild interest_weights from existing votes
 * This processes all past votes to build personalization profile retroactively
 */
async function handleBackfillWeights(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = await request.json();
    const userId = body.userId;

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Backfilling interest_weights for user ${userId}`);

    // Get all votes for this user (ordered by date to replay them chronologically)
    const votesResult = await env.DB.prepare(`
      SELECT v.vote, v.article_id, a.category_id, a.source_id
      FROM votes v
      JOIN articles a ON v.article_id = a.id
      WHERE v.user_id = ?
      ORDER BY v.voted_at ASC
    `).bind(userId).all();

    const votes = votesResult.results;
    console.log(`Found ${votes.length} votes to process`);

    if (votes.length === 0) {
      return new Response(JSON.stringify({ 
        success: true,
        message: 'No votes to process',
        votesProcessed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Clear existing weights to start fresh
    await env.DB.prepare('DELETE FROM interest_weights WHERE user_id = ?').bind(userId).run();
    console.log(`Cleared existing weights for user ${userId}`);

    // Initialize weights object
    let weights: ScoringWeights = {
      categories: {},
      sources: {}
    };

    // Process each vote chronologically to build up weights
    for (const vote of votes) {
      const article = {
        category_id: vote.category_id as number,
        source_id: vote.source_id as number
      };

      // Apply the weight update
      weights = updateWeights(vote.vote as number, article as Article, weights);
    }

    // Now save all the final weights to the database
    const categoryEntries = Object.entries(weights.categories);
    const sourceEntries = Object.entries(weights.sources);

    console.log(`Saving ${categoryEntries.length} category weights and ${sourceEntries.length} source weights`);

    // Insert category weights
    for (const [categoryId, weight] of categoryEntries) {
      await env.DB.prepare(`
        INSERT INTO interest_weights (user_id, category_id, source_id, weight, updated_at)
        VALUES (?, ?, NULL, ?, CURRENT_TIMESTAMP)
      `).bind(userId, parseInt(categoryId), weight).run();
    }

    // Insert source weights
    for (const [sourceId, weight] of sourceEntries) {
      await env.DB.prepare(`
        INSERT INTO interest_weights (user_id, category_id, source_id, weight, updated_at)
        VALUES (?, NULL, ?, ?, CURRENT_TIMESTAMP)
      `).bind(userId, parseInt(sourceId), weight).run();
    }

    console.log(`Successfully backfilled interest_weights for user ${userId}`);

    return new Response(JSON.stringify({ 
      success: true,
      message: 'Interest weights backfilled successfully',
      votesProcessed: votes.length,
      categoryWeights: categoryEntries.length,
      sourceWeights: sourceEntries.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error backfilling weights:', error);
    return new Response(JSON.stringify({ error: 'Failed to backfill weights' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/test-login - Auto-login as test user 999 (TESTING ONLY)
 * Also resets all test user data
 */
async function handleTestLogin(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const TEST_USER_ID = 999;
    
    // First, reset the test user's data
    await env.DB.prepare('DELETE FROM votes WHERE user_id = ?').bind(TEST_USER_ID).run();
    await env.DB.prepare('DELETE FROM saved_articles WHERE user_id = ?').bind(TEST_USER_ID).run();
    await env.DB.prepare('DELETE FROM user_seed_articles WHERE user_id = ?').bind(TEST_USER_ID).run();
    await env.DB.prepare('DELETE FROM interest_weights WHERE user_id = ?').bind(TEST_USER_ID).run();
    await env.DB.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(TEST_USER_ID).run();
    
    console.log('Test user 999 data reset');
    
    // Get test user info
    const user = await env.DB.prepare(
      'SELECT id, email FROM users WHERE id = ?'
    ).bind(TEST_USER_ID).first();
    
    if (!user) {
      return new Response(JSON.stringify({ error: 'Test user not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // Generate a session token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    
    await env.DB.prepare(`
      INSERT INTO user_sessions (user_id, token, expires_at)
      VALUES (?, ?, ?)
    `).bind(TEST_USER_ID, token, expiresAt.toISOString()).run();
    
    console.log(`Test login token created for user ${TEST_USER_ID}`);
    
    return new Response(JSON.stringify({
      token,
      user: {
        id: user.id,
        email: user.email
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in test login:', error);
    return new Response(JSON.stringify({ error: 'Test login failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/user-sources - Save user's source preferences
 */
async function handleSaveUserSources(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { sources } = await request.json() as { sources: Array<{ id: number; active: boolean }> };

    // Update user source preferences
    for (const source of sources) {
      await env.DB.prepare(`
        INSERT INTO user_source_preferences (user_id, source_id, active, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, source_id) DO UPDATE SET 
          active = ?,
          updated_at = datetime('now')
      `).bind(session.user_id, source.id, source.active ? 1 : 0, source.active ? 1 : 0).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error saving user sources:', error);
    return new Response(JSON.stringify({ error: 'Failed to save user sources' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * GET /api/profiles - Get all profiles for user
 */
async function handleGetProfiles(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const profiles = await env.DB.prepare(`
      SELECT * FROM algorithm_profiles 
      WHERE user_id = ? 
      ORDER BY is_default DESC, is_active DESC, created_at ASC
    `).bind(session.user_id).all();

    return new Response(JSON.stringify({ profiles: profiles.results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error fetching profiles:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch profiles' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/profiles - Create new profile
 */
async function handleCreateProfile(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { name, description, settings } = await request.json() as {
      name: string;
      description?: string;
      settings?: any;
    };

    if (!name || name.trim().length === 0) {
      return new Response(JSON.stringify({ error: 'Profile name is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const result = await env.DB.prepare(`
      INSERT INTO algorithm_profiles (
        user_id, name, description,
        recency_decay_hours, source_diversity_multiplier,
        include_metadata_in_embeddings, dynamic_similarity_strength, exploration_factor
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      session.user_id,
      name.trim(),
      description || '',
      settings?.recency_decay_hours || 24,
      settings?.source_diversity_multiplier ?? 0.5,
      settings?.include_metadata_in_embeddings !== false ? 1 : 0,
      settings?.dynamic_similarity_strength ?? 0.5,
      settings?.exploration_factor ?? 0.1
    ).run();

    return new Response(JSON.stringify({ success: true, profile_id: result.meta.last_row_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    if (error.message?.includes('UNIQUE constraint')) {
      return new Response(JSON.stringify({ error: 'A profile with this name already exists' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    console.error('Error creating profile:', error);
    return new Response(JSON.stringify({ error: 'Failed to create profile' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * PUT /api/profiles/:id - Update profile
 */
async function handleUpdateProfile(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const profileId = parseInt(url.pathname.split('/').pop() || '0');

  try {
    const { name, description, settings } = await request.json() as {
      name?: string;
      description?: string;
      settings?: any;
    };

    const updates: string[] = [];
    const values: any[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name.trim());
    }
    if (description !== undefined) {
      updates.push('description = ?');
      values.push(description);
    }
    if (settings?.recency_decay_hours !== undefined) {
      updates.push('recency_decay_hours = ?');
      values.push(settings.recency_decay_hours);
    }
    if (settings?.source_diversity_multiplier !== undefined) {
      updates.push('source_diversity_multiplier = ?');
      values.push(settings.source_diversity_multiplier);
    }
    if (settings?.include_metadata_in_embeddings !== undefined) {
      updates.push('include_metadata_in_embeddings = ?');
      values.push(settings.include_metadata_in_embeddings ? 1 : 0);
    }
    if (settings?.dynamic_similarity_strength !== undefined) {
      updates.push('dynamic_similarity_strength = ?');
      values.push(settings.dynamic_similarity_strength);
    }
    if (settings?.exploration_factor !== undefined) {
      updates.push('exploration_factor = ?');
      values.push(settings.exploration_factor);
    }

    if (updates.length > 0) {
      updates.push('updated_at = datetime("now")');
      const updateClause = updates.join(', ');

      await env.DB.prepare(`
        UPDATE algorithm_profiles 
        SET ${updateClause}
        WHERE id = ? AND user_id = ?
      `).bind(...values, profileId, session.user_id).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    return new Response(JSON.stringify({ error: 'Failed to update profile' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/profiles/:id/activate - Activate profile
 */
async function handleActivateProfile(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const profileId = parseInt(url.pathname.split('/')[3]);

  try {
    // Deactivate all profiles for user
    await env.DB.prepare(`
      UPDATE algorithm_profiles 
      SET is_active = 0 
      WHERE user_id = ?
    `).bind(session.user_id).run();

    // Activate selected profile
    await env.DB.prepare(`
      UPDATE algorithm_profiles 
      SET is_active = 1, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).bind(profileId, session.user_id).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error activating profile:', error);
    return new Response(JSON.stringify({ error: 'Failed to activate profile' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * DELETE /api/profiles/:id - Delete profile
 */
async function handleDeleteProfile(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const session = await env.DB.prepare(`
    SELECT user_id FROM user_sessions WHERE token = ? AND expires_at > datetime('now')
  `).bind(token).first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const profileId = parseInt(url.pathname.split('/').pop() || '0');

  try {
    // Check if this is the default profile
    const profile = await env.DB.prepare(`
      SELECT is_default, is_active FROM algorithm_profiles 
      WHERE id = ? AND user_id = ?
    `).bind(profileId, session.user_id).first();

    if (!profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (profile.is_default) {
      return new Response(JSON.stringify({ error: 'Cannot delete default profile' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Delete the profile
    await env.DB.prepare(`
      DELETE FROM algorithm_profiles 
      WHERE id = ? AND user_id = ?
    `).bind(profileId, session.user_id).run();

    // If deleted profile was active, activate default
    if (profile.is_active) {
      await env.DB.prepare(`
        UPDATE algorithm_profiles 
        SET is_active = 1 
        WHERE user_id = ? AND is_default = 1
      `).bind(session.user_id).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error deleting profile:', error);
    return new Response(JSON.stringify({ error: 'Failed to delete profile' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * GET /api/saved - Get user's saved articles
 */
async function handleGetSavedArticles(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const userId = parseInt(url.searchParams.get('userId') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    const result = await env.DB.prepare(`
      SELECT 
        a.*,
        s.name as source_name,
        c.name as category_name,
        c.slug as category_slug,
        sa.saved_at,
        v.vote as userVote
      FROM saved_articles sa
      JOIN articles a ON sa.article_id = a.id
      LEFT JOIN sources s ON a.source_id = s.id
      LEFT JOIN categories c ON a.category_id = c.id
      LEFT JOIN votes v ON a.id = v.article_id AND v.user_id = ?
      WHERE sa.user_id = ?
      ORDER BY sa.saved_at DESC
      LIMIT ? OFFSET ?
    `).bind(userId, userId, limit, offset).all();

    return new Response(JSON.stringify({ 
      articles: result.results,
      count: result.results.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error getting saved articles:', error);
    return new Response(JSON.stringify({ error: 'Failed to get saved articles' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/saved - Save an article
 */
async function handleSaveArticle(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { articleId, userId } = await request.json() as { articleId: number; userId: number };

    if (!articleId || !userId) {
      return new Response(JSON.stringify({ error: 'Missing articleId or userId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Save the article
    await env.DB.prepare(`
      INSERT OR IGNORE INTO saved_articles (user_id, article_id)
      VALUES (?, ?)
    `).bind(userId, articleId).run();

    // Also register as a like for algorithm (if not already voted)
    await env.DB.prepare(`
      INSERT OR IGNORE INTO votes (user_id, article_id, vote)
      VALUES (?, ?, 1)
    `).bind(userId, articleId).run();

    // Update interest weights based on the article
    const article = await env.DB.prepare(
      'SELECT category_id, source_id FROM articles WHERE id = ?'
    ).bind(articleId).first() as { category_id: number; source_id: number } | null;

    if (article) {
      // Increase category weight
      await env.DB.prepare(`
        INSERT INTO interest_weights (user_id, category_id, source_id, weight)
        VALUES (?, ?, NULL, 1.1)
        ON CONFLICT(user_id, category_id, source_id)
        DO UPDATE SET weight = MIN(weight * 1.1, 2.0), updated_at = CURRENT_TIMESTAMP
      `).bind(userId, article.category_id).run();

      // Increase source weight
      await env.DB.prepare(`
        INSERT INTO interest_weights (user_id, category_id, source_id, weight)
        VALUES (?, NULL, ?, 1.1)
        ON CONFLICT(user_id, category_id, source_id)
        DO UPDATE SET weight = MIN(weight * 1.1, 2.0), updated_at = CURRENT_TIMESTAMP
      `).bind(userId, article.source_id).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error saving article:', error);
    return new Response(JSON.stringify({ error: 'Failed to save article' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * DELETE /api/saved/:articleId - Unsave an article
 */
async function handleUnsaveArticle(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const articleId = parseInt(url.pathname.split('/').pop() || '0');
    const userId = parseInt(url.searchParams.get('userId') || '1');

    if (!articleId || !userId) {
      return new Response(JSON.stringify({ error: 'Missing articleId or userId' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await env.DB.prepare(`
      DELETE FROM saved_articles
      WHERE user_id = ? AND article_id = ?
    `).bind(userId, articleId).run();

    // Note: We don't remove the vote - the like still happened for algorithm purposes
    // This allows saved articles to continue influencing feed even after unsaving

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error unsaving article:', error);
    return new Response(JSON.stringify({ error: 'Failed to unsave article' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Update user's display name
 */
async function handleUpdateDisplayName(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { userId, displayName } = await request.json() as { userId: number; displayName: string };

    if (!userId || !displayName) {
      return new Response(JSON.stringify({ error: 'userId and displayName required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Validate displayName (max 50 chars, alphanumeric + spaces/hyphens/underscores)
    if (displayName.length > 50 || !/^[a-zA-Z0-9 _-]+$/.test(displayName)) {
      return new Response(JSON.stringify({ error: 'Invalid display name. Use only letters, numbers, spaces, hyphens, and underscores (max 50 characters)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await env.DB.prepare(`
      UPDATE users SET display_name = ? WHERE id = ?
    `).bind(displayName.trim(), userId).run();

    return new Response(JSON.stringify({ 
      success: true,
      displayName: displayName.trim()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error updating display name:', error);
    return new Response(JSON.stringify({ error: 'Failed to update display name' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Recalculate article score after user interaction
 * Returns updated raw score and normalized adjusted score
 */
async function handleRecalculateScore(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { userId, articleId } = await request.json() as { userId: number; articleId: number };

    if (!userId || !articleId) {
      return new Response(JSON.stringify({ error: 'userId and articleId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get the article details
    const article = await env.DB.prepare(`
      SELECT a.*, s.name as source_name, c.name as category_name, c.slug as category_slug
      FROM articles a
      LEFT JOIN sources s ON a.source_id = s.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.id = ?
    `).bind(articleId).first() as any;

    if (!article) {
      return new Response(JSON.stringify({ error: 'Article not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Get user's interest weights
    const weightsResult = await env.DB.prepare(
      'SELECT * FROM interest_weights WHERE user_id = ?'
    ).bind(userId).all();
    const weights = interestWeightsToScoringWeights(weightsResult.results as any[]);

    // Get user's algorithm preferences
    let prefsResult = await env.DB.prepare(
      'SELECT recency_decay_hours FROM algorithm_profiles WHERE user_id = ? AND is_active = 1'
    ).bind(userId).first();
    
    if (!prefsResult) {
      prefsResult = await env.DB.prepare(
        'SELECT recency_decay_hours FROM user_algorithm_settings WHERE user_id = ?'
      ).bind(userId).first();
    }
    
    const recencyDecayHours = (prefsResult?.recency_decay_hours as number) || 24;

    // Check if user is in adoption phase (10+ votes)
    const voteCountResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM votes WHERE user_id = ?'
    ).bind(userId).first() as any;
    const isAdoption = voteCountResult.count >= 10;

    // Recalculate score using adoption algorithm
    let newScore = 0;
    if (isAdoption) {
      const { calculateAdoptionScore } = await import('./scoring');
      newScore = calculateAdoptionScore(
        article,
        recencyDecayHours,
        new Set(),
        new Set(),
        weights
      );
    } else {
      const { calculateOnboardingScore } = await import('./scoring');
      newScore = calculateOnboardingScore(article, new Set(), new Set());
    }

    // To calculate adjusted score, we need the distribution of all current feed articles
    // Get a sample of recent articles to calculate the distribution
    const recentArticles = await env.DB.prepare(`
      SELECT a.*, s.name as source_name, c.name as category_name, c.slug as category_slug
      FROM articles a
      LEFT JOIN sources s ON a.source_id = s.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.published_at > datetime('now', '-7 days')
      LIMIT 100
    `).all();

    // Score all articles to get distribution
    const scoredArticles = recentArticles.results.map((a: any) => {
      let score = 0;
      if (isAdoption) {
        const { calculateAdoptionScore } = require('./scoring');
        score = calculateAdoptionScore(a, recencyDecayHours, new Set(), new Set(), weights);
      } else {
        const { calculateOnboardingScore } = require('./scoring');
        score = calculateOnboardingScore(a, new Set(), new Set());
      }
      return { ...a, score };
    });

    // Normalize including the updated article
    const articlesWithUpdated = [...scoredArticles, { ...article, score: newScore }];
    const normalized = normalizeScoresToBellCurve(articlesWithUpdated);
    
    // Find the updated article in normalized results
    const updatedArticle = normalized.find((a: any) => a.id === articleId);
    const adjustedScore = updatedArticle?.adjustedScore || 50;

    return new Response(JSON.stringify({ 
      success: true,
      articleId,
      score: Math.round(newScore * 100) / 100,
      adjustedScore
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error recalculating score:', error);
    return new Response(JSON.stringify({ error: 'Failed to recalculate score' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
