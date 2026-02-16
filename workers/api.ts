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
  calculateAdoptionScore,
  calculateOnboardingScore,
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
  if (!a || !b || a.length !== b.length) return 0;
  
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
 * Calculate content score using top-K similarity difference.
 * 
 * Instead of computing (liked * boost) - (disliked * penalty) which nearly cancel
 * because both raw similarities cluster around 0.55-0.65, we compute the DIFFERENCE
 * between top-K liked and top-K disliked similarity, then amplify that signal.
 * 
 * This focuses on "is this article MORE like things you liked than things you disliked?"
 * 
 * @param strengthMultiplier - User preference 0.0-1.0 (weak to strong similarity impact)
 * @param topK - Number of most-similar embeddings to consider (default 5)
 */
function calculateDirectContentScore(
  articleEmbedding: number[],
  likedEmbeddings: number[][],
  dislikedEmbeddings: number[][],
  strengthMultiplier: number = 0.5,
  topK: number = 5
): number {
  // Compute top-K average similarity for liked articles
  let avgTopKLiked = 0;
  if (likedEmbeddings.length > 0) {
    const similarities: number[] = [];
    for (const likedEmbed of likedEmbeddings) {
      similarities.push(cosineSimilarity(articleEmbedding, likedEmbed));
    }
    similarities.sort((a, b) => b - a);
    const k = Math.min(topK, similarities.length);
    let sum = 0;
    for (let i = 0; i < k; i++) sum += similarities[i];
    avgTopKLiked = sum / k;
  }
  
  // Compute top-K average similarity for disliked articles
  let avgTopKDisliked = 0;
  if (dislikedEmbeddings.length > 0) {
    const similarities: number[] = [];
    for (const dislikedEmbed of dislikedEmbeddings) {
      similarities.push(cosineSimilarity(articleEmbedding, dislikedEmbed));
    }
    similarities.sort((a, b) => b - a);
    const k = Math.min(topK, similarities.length);
    let sum = 0;
    for (let i = 0; i < k; i++) sum += similarities[i];
    avgTopKDisliked = sum / k;
  }
  
  // The raw difference is typically -0.10 to +0.10
  // Amplify to a meaningful score range
  // strengthMultiplier 0.0 = ±15 max, 0.5 = ±22 max, 1.0 = ±30 max
  const amplification = 150 + (strengthMultiplier * 150); // 150 to 300
  const diff = avgTopKLiked - avgTopKDisliked;
  const score = diff * amplification;
  
  return Math.round(score * 100) / 100;
}

interface Env {
  DB: D1Database;
  KV: KVNamespace;
  AI: any; // Cloudflare AI binding
  VECTORIZE: any; // Vectorize binding
  RESEND_API_KEY: string; // Resend API key for magic links
  GOOGLE_AI_API_KEY: string; // Google AI Studio API key for Gemini
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
        return await handleGetFeed(request, env, corsHeaders, ctx);
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

      if (path === '/api/discover-source' && request.method === 'POST') {
        return await handleDiscoverSource(request, env, corsHeaders);
      }

      if (path === '/api/auto-add-source' && request.method === 'POST') {
        return await handleAutoAddSource(request, env, corsHeaders);
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

      if (path === '/api/backfill-summaries' && request.method === 'POST') {
        return await handleBackfillSummaries(request, env, corsHeaders, ctx);
      }

      if (path === '/api/backfill-content' && request.method === 'POST') {
        return await handleBackfillContent(request, env, corsHeaders, ctx);
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
        return await handleGetSavedArticles(request, env, corsHeaders, ctx);
      }

      if (path === '/api/saved/summary' && request.method === 'GET') {
        const summaryUrl = new URL(request.url);
        const sArticleId = parseInt(summaryUrl.searchParams.get('articleId') || '0');
        const row = await env.DB.prepare(
          'SELECT ai_summary FROM articles WHERE id = ?'
        ).bind(sArticleId).first();
        return new Response(JSON.stringify({ ai_summary: row?.ai_summary || null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (path === '/api/saved' && request.method === 'POST') {
        return await handleSaveArticle(request, env, corsHeaders, ctx);
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
 * Trigger batch AI summary generation for feed articles that don't have summaries yet.
 * First batch: 5 articles (fast, for immediate display on reload).
 * Second batch: remaining articles (up to 20 more).
 * All processing happens in the background via waitUntil.
 */
function triggerBatchSummaries(articles: any[], env: Env, ctx: ExecutionContext): void {
  const needsSummary = articles.filter((a: any) => !a.ai_summary);
  if (needsSummary.length === 0) return;

  console.log(`Feed batch summaries: ${needsSummary.length} articles need summaries`);

  // First batch: 5 articles (fast)
  const firstBatch = needsSummary.slice(0, 5);
  // Second batch: next 20 articles
  const secondBatch = needsSummary.slice(5, 25);

  ctx.waitUntil(
    (async () => {
      // Fire first batch immediately
      await generateBatchSummaries(
        firstBatch.map((a: any) => ({ id: a.id, title: a.title, summary: a.summary, content: a.content })),
        env
      );

      // Fire second batch if there are more
      if (secondBatch.length > 0) {
        await generateBatchSummaries(
          secondBatch.map((a: any) => ({ id: a.id, title: a.title, summary: a.summary, content: a.content })),
          env
        );
      }
    })()
  );
}

/**
 * GET /api/feed - Get personalized article feed with embedding-based content scoring
 */
async function handleGetFeed(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
  ctx: ExecutionContext
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
    'SELECT article_id, vote FROM votes WHERE user_id = ?'
  ).bind(userId).all();

  const votedArticleIds = new Set(
    votedResult.results.map((v: any) => v.article_id)
  );

  // Get saved article IDs (to include isSaved status in feed response)
  const savedResult = await env.DB.prepare(
    'SELECT article_id FROM saved_articles WHERE user_id = ?'
  ).bind(userId).all();
  const savedArticleIds = new Set(
    savedResult.results.map((v: any) => v.article_id)
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
  //
  // Impression suppression (consolidated logic):
  //   1. ALL pages: suppress articles seen 3+ times in the last 24 hours
  //   2. Page 1 only: also suppress articles viewed in the last 30 minutes
  //      (so returning to the feed shows fresh content, not stuff you just scrolled past)
  let query = `
    SELECT a.*, s.name as source_name, s.spotify_url as spotify_url, s.use_archive as use_archive, s.is_aggregator as is_aggregator, c.name as category_name, c.slug as category_slug
    FROM articles a
    LEFT JOIN sources s ON a.source_id = s.id
    LEFT JOIN categories c ON a.category_id = c.id
    LEFT JOIN user_source_preferences usp ON a.source_id = usp.source_id AND usp.user_id = ?
    WHERE a.published_at > datetime('now', '-7 days')
    AND NOT EXISTS (
      SELECT 1 FROM article_impressions ai
      WHERE ai.user_id = ?
        AND ai.article_id = a.id
        AND ai.impression_count >= 3
        AND ai.last_seen_at > datetime('now', '-1 days')
    )
    AND NOT EXISTS (
      SELECT 1 FROM votes v
      WHERE v.user_id = ?
        AND v.article_id = a.id
        AND v.vote = -1
    )
    AND NOT EXISTS (
      SELECT 1 FROM saved_articles sa
      WHERE sa.user_id = ?
        AND sa.article_id = a.id
    )
    AND (usp.active IS NULL OR usp.active = 1)
  `;

  const params: any[] = [userId, userId, userId, userId]; // userId for source prefs, impression filter, downvote filter, saved filter

  // Page 1 only: also suppress articles viewed in the last 30 minutes
  if (!isLoggedOut && offset === 0) {
    query += `
    AND NOT EXISTS (
      SELECT 1 FROM article_impressions ai2
      WHERE ai2.user_id = ?
        AND ai2.article_id = a.id
        AND ai2.last_seen_at > datetime('now', '-30 minutes')
    )`;
    params.push(userId);
  }

  if (categorySlug) {
    query += ' AND c.slug = ?';
    params.push(categorySlug);
  }

  // For logged-in users (onboarding + adoption), fetch balanced sample from each category
  // For logged-out users, also fetch balanced to show variety
  let articles: Article[] = [];
  
   if (!categorySlug) {
     // Fetch top 50 most recent articles PER SOURCE to ensure no single high-volume
     // source crowds out others. This guarantees every source gets fair representation
     // in the candidate pool before scoring runs, and that any article visible in a
     // category feed is also a candidate in the All feed.
     const allQuery = `
       SELECT * FROM (
         SELECT ranked.*, ROW_NUMBER() OVER (PARTITION BY ranked.source_id ORDER BY ranked.published_at DESC) as rn
         FROM (${query}) ranked
       ) WHERE rn <= 50
     `;
     const allResult = await env.DB.prepare(allQuery).bind(...params).all();
     articles = allResult.results as Article[];
     
     console.log(`Fetched ${articles.length} articles (top 50 per source, balanced across sources)`);
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
       // Helper: batch D1 queries to stay under SQL variable limit (max 50 per batch)
       const DB_BATCH_SIZE = 50;
       async function batchedD1Query(ids: number[], queryTemplate: (placeholders: string) => string): Promise<any[]> {
         const allResults: any[] = [];
         for (let i = 0; i < ids.length; i += DB_BATCH_SIZE) {
           const batch = ids.slice(i, i + DB_BATCH_SIZE);
           const placeholders = batch.map(() => '?').join(',');
           const result = await env.DB.prepare(queryTemplate(placeholders)).bind(...batch).all();
           allResults.push(...result.results);
         }
         return allResults;
       }
       
       // Fetch user's liked/disliked embeddings from Vectorize
       let likedEmbeddings: Array<{id: string, values: number[]}> = [];
       let dislikedEmbeddings: Array<{id: string, values: number[]}> = [];
       
       if (likedArticleIds.length > 0) {
         for (let i = 0; i < likedArticleIds.length; i += 20) {
           const batch = likedArticleIds.slice(i, i + 20);
           const batchResult = await env.VECTORIZE.getByIds(batch.map((id: number) => id.toString()));
           if (batchResult) likedEmbeddings.push(...batchResult.filter((v: any) => v.values != null));
          }
          console.log(`Retrieved ${likedEmbeddings.length} liked embeddings from Vectorize`);
        }
        
        if (dislikedArticleIds.length > 0) {
          for (let i = 0; i < dislikedArticleIds.length; i += 20) {
            const batch = dislikedArticleIds.slice(i, i + 20);
            const batchResult = await env.VECTORIZE.getByIds(batch.map((id: number) => id.toString()));
            if (batchResult) dislikedEmbeddings.push(...batchResult.filter((v: any) => v.values != null));
         }
         console.log(`Retrieved ${dislikedEmbeddings.length} disliked embeddings from Vectorize`);
       }
       
       if (likedEmbeddings.length > 0 || dislikedEmbeddings.length > 0) {
         // Batch fetch which feed articles have embeddings (batched to avoid D1 variable limit)
         const articleIds = articles.map(a => a.id);
         const embeddingStatusRows = await batchedD1Query(articleIds, (ph) => `
           SELECT article_id 
           FROM article_embeddings 
           WHERE article_id IN (${ph}) 
             AND embedding_generated = 1
         `);
         
         const hasEmbeddingSet = new Set(
           embeddingStatusRows.map((r: any) => r.article_id)
         );
         
         console.log(`${hasEmbeddingSet.size} out of ${articleIds.length} feed articles have embeddings`);
         
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
                  if (emb.values != null) {
                    allArticleEmbeddings.set(parseInt(emb.id), emb.values);
                  }
                });
              }
            });
           
           console.log(`Retrieved ${allArticleEmbeddings.size} article embeddings from Vectorize`);
           
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

   // Impression suppression is now fully handled in the SQL query above.
   // Rule 1 (all pages): suppress articles seen 3+ times in last 24 hours.
   // Rule 2 (page 1 only): suppress articles viewed in the last 30 minutes.
   
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
    let normalizedArticles = normalizeScoresToBellCurve(diverseArticles);
    
    // Apply pagination
    const topArticles = normalizedArticles.slice(offset, offset + limit);
    
    // Add user vote/save status (always 0/false for logged out)
    const enrichedArticles = topArticles.map(article => ({
      ...article,
      userVote: 0,
      isSaved: false
    }));
    
    // DEBUG: Log first article to verify adjustedScore is present
    if (enrichedArticles.length > 0) {
      const first = enrichedArticles[0];
      console.log(`📤 API Response - First article: id=${first.id}, score=${first.score}, adjustedScore=${first.adjustedScore}`);
    }
    
    // Trigger batch AI summary generation for articles missing summaries
    triggerBatchSummaries(enrichedArticles, env, ctx);

    const response: FeedResponse = {
      articles: enrichedArticles,
      total: normalizedArticles.length,
      hasMore: offset + limit < normalizedArticles.length
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
    let normalizedArticles = normalizeScoresToBellCurve(onboardingArticles);
    
    // Apply pagination
    const topArticles = normalizedArticles.slice(offset, offset + limit);
    
    // Add user vote and save status
    const enrichedArticles = topArticles.map(article => ({
      ...article,
      userVote: votedArticleIds.has(article.id) ? 
        (votedResult.results.find((v: any) => v.article_id === article.id)?.vote || 0) : 0,
      isSaved: savedArticleIds.has(article.id)
    }));
    
    // DEBUG: Log first article to verify adjustedScore is present
    if (enrichedArticles.length > 0) {
      const first = enrichedArticles[0];
      console.log(`📤 API Response - First article: id=${first.id}, score=${first.score}, adjustedScore=${first.adjustedScore}`);
    }
    
    // Trigger batch AI summary generation for articles missing summaries
    triggerBatchSummaries(enrichedArticles, env, ctx);

    const response: FeedResponse = {
      articles: enrichedArticles,
      total: normalizedArticles.length,
      hasMore: offset + limit < normalizedArticles.length
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
    let normalizedArticles = normalizeScoresToBellCurve(adoptionArticles);
    
    // Apply pagination
    const topArticles = normalizedArticles.slice(offset, offset + limit);
    
    // Add user vote and save status
    const enrichedArticles = topArticles.map(article => ({
      ...article,
      userVote: votedArticleIds.has(article.id) ? 
        (votedResult.results.find((v: any) => v.article_id === article.id)?.vote || 0) : 0,
      isSaved: savedArticleIds.has(article.id)
    }));
    
    // DEBUG: Log first article to verify adjustedScore is present
    if (enrichedArticles.length > 0) {
      const first = enrichedArticles[0];
      console.log(`📤 API Response - First article: id=${first.id}, score=${first.score}, adjustedScore=${first.adjustedScore}`);
    }
    
    // Trigger batch AI summary generation for articles missing summaries
    triggerBatchSummaries(enrichedArticles, env, ctx);

    const response: FeedResponse = {
      articles: enrichedArticles,
      total: normalizedArticles.length,
      hasMore: offset + limit < normalizedArticles.length
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

  // Auto-classify into a category based on source name and URL
  const categoryId = body.category_id || await autoClassifyCategory(body.name, body.url, env);

  const result = await env.DB.prepare(`
    INSERT INTO sources (name, url, category_id, fetch_method, config, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    body.name, 
    body.url, 
    categoryId, 
    body.fetch_method, 
    body.config, 
    body.active
  ).run();

  return new Response(JSON.stringify({ success: true, id: result.meta.last_row_id, category_id: categoryId }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

/**
 * Auto-classify a source into a category based on name and URL keywords.
 * Falls back to Tech/AI (id 1) if no strong match.
 */
async function autoClassifyCategory(name: string, url: string, env: Env): Promise<number> {
  const text = `${name} ${url}`.toLowerCase();

  // Keyword lists per category slug
  const categoryKeywords: Record<string, string[]> = {
    'tech-ai': ['tech', 'ai', 'artificial intelligence', 'software', 'programming', 'code', 'developer', 'startup', 'silicon', 'cyber', 'hacker', 'verge', 'wired', 'ars', 'engadget', 'mashable', 'gizmodo', 'techcrunch', 'github', 'crypto', 'blockchain', 'cloud', 'data', 'machine learning'],
    'business-finance': ['business', 'finance', 'market', 'stock', 'economy', 'economic', 'invest', 'bank', 'wall street', 'bloomberg', 'reuters', 'cnbc', 'yahoo finance', 'fortune', 'forbes', 'economist', 'money', 'trade', 'trading', 'venture', 'capital'],
    'sports': ['sport', 'espn', 'nfl', 'nba', 'mlb', 'nhl', 'soccer', 'football', 'basketball', 'baseball', 'hockey', 'tennis', 'golf', 'athletic', 'bleacher', 'scores', 'league', 'team', 'player', 'game', 'match', 'fifa', 'olympics'],
    'politics': ['politic', 'government', 'congress', 'senate', 'white house', 'democrat', 'republican', 'election', 'vote', 'policy', 'legislation', 'capitol', 'politico', 'hill', 'washington post', 'nytimes', 'bbc news', 'npr', 'guardian', 'foreign affairs', 'diplomat'],
  };

  // Fetch categories from DB to map slug -> id
  const catResult = await env.DB.prepare('SELECT id, slug FROM categories').all();
  const slugToId: Record<string, number> = {};
  for (const cat of catResult.results as any[]) {
    slugToId[cat.slug] = cat.id;
  }

  // Score each category by keyword matches
  let bestSlug = 'tech-ai';
  let bestScore = 0;

  for (const [slug, keywords] of Object.entries(categoryKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSlug = slug;
    }
  }

  const categoryId = slugToId[bestSlug] || 1;
  console.log(`Auto-classified "${name}" (${url}) -> ${bestSlug} (id ${categoryId}, score ${bestScore})`);
  return categoryId;
}

/**
 * POST /api/auto-add-source - Auto-add an original publication as a source when
 * a user clicks an article from an aggregator (e.g., Techmeme).
 * Extracts the domain from the article URL, creates the source if needed,
 * and ensures it's active for the user.
 */
async function handleAutoAddSource(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { userId, articleUrl } = await request.json() as { userId: number; articleUrl: string };
    if (!userId || !articleUrl) {
      return new Response(JSON.stringify({ error: 'userId and articleUrl required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Extract origin domain from article URL
    let origin: string;
    try {
      const parsed = new URL(articleUrl);
      origin = parsed.origin; // e.g., https://www.axios.com
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid article URL' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Derive a clean name from the hostname
    const hostname = new URL(origin).hostname.replace('www.', '');
    const siteName = hostname.split('.')[0].charAt(0).toUpperCase() + hostname.split('.')[0].slice(1);

    // Check if a source with this domain already exists
    const existing = await env.DB.prepare(
      `SELECT id, name FROM sources WHERE url LIKE ? LIMIT 1`
    ).bind(`%${hostname}%`).first();

    let sourceId: number;
    let sourceName: string;
    let created = false;

    if (existing) {
      sourceId = existing.id as number;
      sourceName = existing.name as string;
    } else {
      // Auto-classify category
      const categoryId = await autoClassifyCategory(siteName, origin, env);

      // Try to discover RSS feed for this source (quick check — just common paths)
      let fetchMethod = 'scrape';
      let config: Record<string, any> = { scrape_url: origin, use_sitemap: false };

      // Quick RSS probe: try /feed and /rss.xml
      const quickPaths = ['/feed', '/rss.xml', '/feed.xml', '/rss', '/atom.xml'];
      for (const path of quickPaths) {
        try {
          const feedRes = await fetch(origin + path, {
            headers: { 'User-Agent': 'NewsFeedAggregator/1.0' },
            redirect: 'follow'
          });
          if (feedRes.ok) {
            const feedText = await feedRes.text();
            if (feedText.includes('<rss') || feedText.includes('<feed') || feedText.includes('<channel')) {
              fetchMethod = 'rss';
              config = { rss_url: origin + path };
              break;
            }
          }
        } catch { /* try next */ }
      }

      // Create the source
      const result = await env.DB.prepare(`
        INSERT INTO sources (name, url, category_id, fetch_method, config, active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).bind(siteName, origin, categoryId, fetchMethod, JSON.stringify(config)).run();

      sourceId = result.meta.last_row_id as number;
      sourceName = siteName;
      created = true;
      console.log(`Auto-added source "${siteName}" (${origin}) via aggregator click, method: ${fetchMethod}`);
    }

    // Ensure user has this source active in their preferences
    await env.DB.prepare(`
      INSERT INTO user_source_preferences (user_id, source_id, active)
      VALUES (?, ?, 1)
      ON CONFLICT(user_id, source_id) DO UPDATE SET active = 1, updated_at = datetime('now')
    `).bind(userId, sourceId).run();

    return new Response(JSON.stringify({
      success: true,
      source_id: sourceId,
      source_name: sourceName,
      created
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error auto-adding source:', error);
    return new Response(JSON.stringify({ error: 'Failed to auto-add source' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * POST /api/discover-source - Probe a URL to find the best way to fetch articles
 * Tries: 1) RSS/Atom link tags in HTML  2) common feed paths  3) sitemap.xml  4) scrape fallback
 */
async function handleDiscoverSource(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const { url } = await request.json() as { url: string };
    if (!url) {
      return new Response(JSON.stringify({ error: 'URL required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Normalize URL
    let baseUrl = url.trim();
    if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
    const parsedUrl = new URL(baseUrl);
    const origin = parsedUrl.origin;

    // Fetch the homepage HTML
    let html = '';
    let siteName = parsedUrl.hostname.replace('www.', '');
    try {
      const res = await fetch(baseUrl, {
        headers: { 'User-Agent': 'NewsFeedAggregator/1.0' },
        redirect: 'follow'
      });
      html = await res.text();
      
      // Try to extract site name from <title> or og:site_name
      const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
      const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (ogSiteName) siteName = ogSiteName[1].trim();
      else if (titleTag) siteName = titleTag[1].trim().split(/[|\-–—]/)[0].trim();
    } catch (e) {
      console.error('Failed to fetch homepage:', e);
    }

    // Strategy 1: Look for RSS/Atom link tags in HTML
    const feedLinks = html.matchAll(/<link[^>]+type=["'](application\/(rss|atom)\+xml|text\/xml)["'][^>]*>/gi);
    for (const match of feedLinks) {
      const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        const feedUrl = new URL(hrefMatch[1], origin).href;
        // Verify it's a valid feed
        try {
          const feedRes = await fetch(feedUrl, { headers: { 'User-Agent': 'NewsFeedAggregator/1.0' } });
          const feedText = await feedRes.text();
          if (feedText.includes('<rss') || feedText.includes('<feed') || feedText.includes('<channel')) {
            const itemCount = (feedText.match(/<item[\s>]/gi) || feedText.match(/<entry[\s>]/gi) || []).length;
            return new Response(JSON.stringify({
              success: true,
              name: siteName,
              url: origin,
              fetch_method: 'rss',
              config: { rss_url: feedUrl },
              articles_found: itemCount,
              discovery_method: 'link_tag'
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        } catch (e) { /* try next */ }
      }
    }

    // Strategy 2: Try common feed paths
    const commonPaths = [
      '/feed', '/feed/', '/rss', '/rss/', '/rss.xml', '/feed.xml', '/atom.xml',
      '/feeds/posts/default', '/blog/feed', '/index.xml', '/.rss'
    ];
    for (const path of commonPaths) {
      try {
        const feedUrl = origin + path;
        const feedRes = await fetch(feedUrl, {
          headers: { 'User-Agent': 'NewsFeedAggregator/1.0' },
          redirect: 'follow'
        });
        if (feedRes.ok) {
          const feedText = await feedRes.text();
          if (feedText.includes('<rss') || feedText.includes('<feed') || feedText.includes('<channel')) {
            const itemCount = (feedText.match(/<item[\s>]/gi) || feedText.match(/<entry[\s>]/gi) || []).length;
            return new Response(JSON.stringify({
              success: true,
              name: siteName,
              url: origin,
              fetch_method: 'rss',
              config: { rss_url: feedUrl },
              articles_found: itemCount,
              discovery_method: 'common_path'
            }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }
      } catch (e) { /* try next */ }
    }

    // Strategy 3: Check sitemap.xml for article URLs
    try {
      const sitemapRes = await fetch(origin + '/sitemap.xml', {
        headers: { 'User-Agent': 'NewsFeedAggregator/1.0' },
        redirect: 'follow'
      });
      if (sitemapRes.ok) {
        const sitemapText = await sitemapRes.text();
        if (sitemapText.includes('<urlset') || sitemapText.includes('<sitemapindex')) {
          // Extract URLs from sitemap
          const urls = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1]);
          // Filter to likely article URLs (contain path segments, not just homepage)
          const articleUrls = urls.filter(u => {
            const p = new URL(u).pathname;
            return p !== '/' && p.split('/').filter(Boolean).length >= 2;
          });
          
          return new Response(JSON.stringify({
            success: true,
            name: siteName,
            url: origin,
            fetch_method: 'scrape',
            config: { 
              scrape_url: baseUrl,
              sitemap_url: origin + '/sitemap.xml',
              use_sitemap: true
            },
            articles_found: articleUrls.length,
            discovery_method: 'sitemap'
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
      }
    } catch (e) { /* try next */ }

    // Strategy 4: Scrape fallback — extract article links from homepage
    const articleLinks: string[] = [];
    const linkMatches = html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
    for (const m of linkMatches) {
      try {
        const href = new URL(m[1], origin).href;
        // Only include links on the same domain with meaningful paths
        if (href.startsWith(origin)) {
          const path = new URL(href).pathname;
          if (path !== '/' && path.split('/').filter(Boolean).length >= 2 && !path.match(/\.(css|js|png|jpg|gif|svg|ico)$/i)) {
            if (!articleLinks.includes(href)) articleLinks.push(href);
          }
        }
      } catch (e) { /* skip bad URLs */ }
    }

    if (articleLinks.length > 0) {
      return new Response(JSON.stringify({
        success: true,
        name: siteName,
        url: origin,
        fetch_method: 'scrape',
        config: { 
          scrape_url: baseUrl,
          use_sitemap: false
        },
        articles_found: articleLinks.length,
        discovery_method: 'scrape'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: false,
      error: 'Could not find any articles or feeds at this URL'
    }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error discovering source:', error);
    return new Response(JSON.stringify({ error: 'Failed to discover source' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
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
    // Note: seed interactions are NOT inserted into the votes table.
    // The seed only influences interest weights and the seed_articles table.
    // This ensures the vote count accurately reflects in-feed user interactions,
    // so the onboarding→adoption transition and celebration modal trigger at
    // exactly 10 user-visible votes.

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
    await env.DB.prepare('DELETE FROM article_impressions WHERE user_id = ?').bind(TEST_USER_ID).run();
    await env.DB.prepare('DELETE FROM user_source_preferences WHERE user_id = ?').bind(TEST_USER_ID).run();
    // Reset display name and set email to simulate a fresh ndsimmons@gmail.com signup
    await env.DB.prepare('UPDATE users SET display_name = NULL, email = ? WHERE id = ?')
      .bind('ndsimmons@gmail.com', TEST_USER_ID).run();
    
    console.log('Test user 999 data fully reset');
    
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
  corsHeaders: Record<string, string>,
  ctx: ExecutionContext
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
        s.use_archive as use_archive,
        s.is_aggregator as is_aggregator,
        s.spotify_url as spotify_url,
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

    // Trigger batch AI summary generation for saved articles without summaries
    const articlesWithoutSummaries = (result.results as any[]).filter((a: any) => !a.ai_summary);
    if (articlesWithoutSummaries.length > 0) {
      ctx.waitUntil(
        generateBatchSummaries(
          articlesWithoutSummaries.map((a: any) => ({ id: a.id, title: a.title, summary: a.summary, content: a.content })),
          env
        )
      );
    }

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
  corsHeaders: Record<string, string>,
  ctx: ExecutionContext
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

    // Generate AI summary in the background if the article doesn't have one yet
    const existingSummary = await env.DB.prepare(
      'SELECT ai_summary FROM articles WHERE id = ?'
    ).bind(articleId).first() as { ai_summary: string | null } | null;

    if (!existingSummary?.ai_summary) {
      ctx.waitUntil(
        generateSingleSummary(articleId, env).catch(err =>
          console.error('Error generating summary:', err)
        )
      );
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
 * POST /api/backfill-content - Fetch full article text for articles missing content.
 * Processes in background batches via waitUntil. Each batch fetches 5 articles in parallel.
 * Also clears ai_summary for articles that get new content so summaries regenerate from full text.
 */
async function handleBackfillContent(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    // Get articles from last 7 days that have no content
    const result = await env.DB.prepare(`
      SELECT id, url FROM articles 
      WHERE (content IS NULL OR content = '') 
      AND published_at > datetime('now', '-7 days')
      ORDER BY published_at DESC
      LIMIT 200
    `).all();

    const items = result.results as Array<{ id: number; url: string }>;
    console.log(`Content backfill: ${items.length} articles need content`);

    const response = new Response(JSON.stringify({ 
      success: true, 
      total: items.length, 
      message: 'Content backfill started. Processing in background.' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    if (items.length > 0 && ctx?.waitUntil) {
      ctx.waitUntil(backfillContentInBatches(items, env));
    }

    return response;
  } catch (error) {
    console.error('Error starting content backfill:', error);
    return new Response(JSON.stringify({ error: 'Content backfill failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Fetch article text in parallel batches. Updates articles.content and clears ai_summary
 * so it regenerates from full text on next feed load.
 */
async function backfillContentInBatches(
  items: Array<{ id: number; url: string }>,
  env: Env
): Promise<void> {
  const BATCH_SIZE = 5;
  const DELAY_MS = 1000;
  let fetched = 0;

  console.log(`Content backfill: processing ${items.length} articles in batches of ${BATCH_SIZE}`);

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(item => fetchArticleText(item.url))
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === 'fulfilled' && result.value && result.value.length > 100) {
        try {
          // Store content and clear stale ai_summary so it regenerates from full text
          await env.DB.prepare(
            'UPDATE articles SET content = ?, ai_summary = NULL WHERE id = ?'
          ).bind(result.value, batch[j].id).run();
          fetched++;
        } catch (err) {
          console.error(`Failed to update content for article ${batch[j].id}:`, err);
        }
      }
    }

    if (i + BATCH_SIZE < items.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  console.log(`Content backfill complete: fetched ${fetched}/${items.length} articles`);
}

/**
 * Fetch article page and extract main body text.
 * Returns plain text truncated to ~5000 chars.
 */
async function fetchArticleText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NewsFeedAggregator/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Strategy 1: Extract from <article> tag
    let bodyHtml = '';
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      bodyHtml = articleMatch[1];
    }

    // Strategy 2: Common content div patterns
    if (!bodyHtml) {
      const contentPatterns = [
        /class=["'][^"']*(?:article-body|article-content|post-content|entry-content|story-body|story-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i,
        /id=["'](?:article-body|content|main-content|story)["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i,
      ];
      for (const pattern of contentPatterns) {
        const match = html.match(pattern);
        if (match) {
          bodyHtml = match[1];
          break;
        }
      }
    }

    // Strategy 3: All <p> tags from body
    if (!bodyHtml) {
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      bodyHtml = bodyMatch ? bodyMatch[1] : html;
    }

    // Extract text from <p> tags
    const paragraphs: string[] = [];
    const pMatches = bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const m of pMatches) {
      const text = m[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 40 && text.length < 2000) {
        paragraphs.push(text);
      }
    }

    if (paragraphs.length === 0) return null;
    return paragraphs.join('\n\n').substring(0, 5000) || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/backfill-summaries - Generate AI summaries for all saved articles that don't have one
 * Returns immediately; processing happens in background batches
 */
async function handleBackfillSummaries(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>,
  ctx?: ExecutionContext
): Promise<Response> {
  try {
    // Find all articles that don't have an AI summary yet
    const result = await env.DB.prepare(
      `SELECT id, title, summary, content FROM articles 
       WHERE ai_summary IS NULL 
       AND published_at > datetime('now', '-7 days')
       ORDER BY published_at DESC`
    ).all();

    const items = result.results as Array<{ id: number; title: string; summary: string | null; content: string | null }>;
    console.log(`Backfilling summaries for ${items.length} articles`);

    // Return immediately with batch info
    const response = new Response(JSON.stringify({ 
      success: true, 
      total: items.length, 
      message: 'Backfill started. Processing in background batches.' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

    // Process in background using waitUntil if available, otherwise fire-and-forget
    if (ctx?.waitUntil) {
      ctx.waitUntil(backfillInBatches(items, env));
    } else {
      // Fire-and-forget fallback
      backfillInBatches(items, env).catch(err => 
        console.error('Background backfill failed:', err)
      );
    }

    return response;
  } catch (error) {
    console.error('Error starting backfill:', error);
    return new Response(JSON.stringify({ error: 'Backfill failed to start' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Process backfill in smaller batches with delays to avoid rate limiting.
 * Uses generateBatchSummaries to process 10 articles per Gemini API call.
 */
async function backfillInBatches(
  items: Array<{ id: number; title: string; summary: string | null; content: string | null }>,
  env: Env
): Promise<void> {
  // Gemini 2.5 Flash Lite free tier: 30 req/min, 1000 req/day
  // Process in chunks of 10 articles per API call with 5s delay between chunks
  const CHUNK_SIZE = 10;
  const DELAY_MS = 5000;
  
  console.log(`Backfill started: processing ${items.length} articles in chunks of ${CHUNK_SIZE}`);
  
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(items.length / CHUNK_SIZE);
    
    console.log(`Backfill progress: chunk ${chunkNum}/${totalChunks} (${chunk.length} articles)`);
    
    try {
      await generateBatchSummaries(chunk, env);
    } catch (err) {
      console.error(`Failed to generate summaries for chunk ${chunkNum}:`, err);
    }
    
    // Delay between chunks to respect Gemini rate limit
    if (i + CHUNK_SIZE < items.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }
  
  console.log(`Backfill complete: processed ${items.length} articles in ${Math.ceil(items.length / CHUNK_SIZE)} chunks`);
}

/** Shared system prompt for all AI summary generation */
const AI_SUMMARY_SYSTEM_PROMPT = `You are a senior investigative data journalist—a hybrid of Axios "Smart Brevity" and Stratechery structural analysis. You ignore PR fluff to find the startling, hard data and strategic shifts hidden in news stories.

Strict Grounding Rule: Use ONLY the facts, names, and titles provided in the text below. Do not use your internal knowledge to correct or supplement names (e.g., if the text says "Kennedy," do not use "Xavier Becerra"). If a specific name or data point is in the text, that is your only truth.

Task: Analyze the provided news article and provide a high-impact, concise summary following this exact format:

Give an executive summary of the primary event. Do not use any introductory labels or headers.

Give supporting evidence for the thesis of the article. (e.g. if the thesis of the article is that tariffs are driving higher prices then look in the article for specific companies and/or industries that are raising prices and why they are raising prices.

Whenever possible, be heavily anchored by a specific hard number, percentage, multiplier (e.g., 3x), or dollar amount from the text.

No sentences should repeat anything in the executive summary. Each one should be new, interesting information.

Each sentence should start with a bullet point.

Constraint - Length & Tone:

Limit: STRICTLY under 150 tokens. Aim for 60-90 words total. Do not exceed this limit, and never stop mid-sentence.

Avoid "vague-speak" (e.g., massive, significant). Let the numbers do the talking.

No "AI-isms" (e.g., "The article highlights," "In conclusion"). Start immediately with the facts.`;

/**
 * Generate AI summaries for a batch of articles in a single Gemini API call.
 * Sends multiple articles, receives JSON-keyed summaries, writes each to articles.ai_summary.
 */
async function generateBatchSummaries(
  articles: Array<{ id: number; title: string; summary: string | null; content: string | null }>,
  env: Env
): Promise<void> {
  if (articles.length === 0) return;

  console.log(`Batch summary: generating for ${articles.length} articles in a single Gemini call`);

  // Build the user prompt with all articles
  const articleEntries = articles.map(a => {
    const text = a.content || a.summary || a.title;
    return `[ARTICLE_ID: ${a.id}]\nTitle: ${a.title}\nText: ${text.substring(0, 1500)}`;
  }).join('\n\n---\n\n');

  const batchSystemPrompt = AI_SUMMARY_SYSTEM_PROMPT + `

BATCH MODE: You will receive multiple articles separated by "---". For each article, generate a summary following the format above.

Return your response as valid JSON: an object where each key is the article ID (as a string) and each value is the summary text. Example:
{"12345": "Summary for article 12345...", "67890": "Summary for article 67890..."}

Return ONLY the JSON object. No markdown code fences, no explanation.`;

  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GOOGLE_AI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: batchSystemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: articleEntries }] }],
            generationConfig: {
              maxOutputTokens: articles.length * 200, // ~200 tokens per summary
              temperature: 0.7,
              responseMimeType: 'application/json'
            }
          })
        }
      );

      if (geminiResponse.status === 429) {
        const retryDelay = attempt * 10000;
        console.log(`Batch summary: Rate limited (attempt ${attempt}/${MAX_RETRIES}), retrying in ${retryDelay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }

      if (!geminiResponse.ok) {
        const errorText = await geminiResponse.text();
        throw new Error(`Gemini API error ${geminiResponse.status}: ${errorText}`);
      }

      const geminiData = await geminiResponse.json() as any;
      let responseText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (!responseText) {
        console.error('Batch summary: Gemini returned empty response', JSON.stringify(geminiData).substring(0, 500));
        return;
      }

      // Strip markdown code fences if present
      responseText = responseText.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '');

      // Parse the JSON response
      let summaries: Record<string, string>;
      try {
        summaries = JSON.parse(responseText);
      } catch (parseErr) {
        console.error('Batch summary: Failed to parse JSON response:', responseText.substring(0, 500));
        return;
      }

      // Write each summary to the articles table
      let written = 0;
      for (const article of articles) {
        const summary = summaries[String(article.id)];
        if (summary && summary.length > 20) {
          await env.DB.prepare(
            'UPDATE articles SET ai_summary = ? WHERE id = ?'
          ).bind(summary, article.id).run();
          written++;
        }
      }

      console.log(`Batch summary: wrote ${written}/${articles.length} summaries to articles table`);
      return; // Success

    } catch (err) {
      console.error(`Batch summary: failed (attempt ${attempt}/${MAX_RETRIES})`, err);
      if (attempt === MAX_RETRIES) {
        console.error('Batch summary: all retries exhausted');
      }
    }
  }
}

/**
 * Generate a single AI summary for one article. Used by save-article flow
 * when the article doesn't already have a summary.
 */
async function generateSingleSummary(articleId: number, env: Env): Promise<string | null> {
  const article = await env.DB.prepare(
    'SELECT id, title, summary, content FROM articles WHERE id = ?'
  ).bind(articleId).first() as { id: number; title: string; summary: string | null; content: string | null } | null;

  if (!article) return null;

  // Use batch function with a single article
  await generateBatchSummaries([article], env);

  // Read back the generated summary
  const result = await env.DB.prepare(
    'SELECT ai_summary FROM articles WHERE id = ?'
  ).bind(articleId).first() as { ai_summary: string | null } | null;

  return result?.ai_summary || null;
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
      const breakdown = calculateAdoptionScore(
        article,
        recencyDecayHours,
        new Set(),
        new Set(),
        weights
      );
      newScore = breakdown.score;
    } else {
      newScore = calculateOnboardingScore(article, new Set(), new Set());
    }

    // Build normalization pool from recent articles, scored consistently
    const recentArticles = await env.DB.prepare(`
      SELECT a.*, s.name as source_name, c.name as category_name, c.slug as category_slug
      FROM articles a
      LEFT JOIN sources s ON a.source_id = s.id
      LEFT JOIN categories c ON a.category_id = c.id
      WHERE a.published_at > datetime('now', '-7 days')
      ORDER BY a.published_at DESC
      LIMIT 100
    `).all();

    // Score all articles with proper sequential diversity tracking
    const poolSeenSources = new Set<number>();
    const poolSeenCategories = new Set<number>();
    const scoredArticles = recentArticles.results.map((a: any) => {
      let score = 0;
      if (isAdoption) {
        const breakdown = calculateAdoptionScore(a, recencyDecayHours, poolSeenSources, poolSeenCategories, weights);
        score = breakdown.score;
      } else {
        score = calculateOnboardingScore(a, poolSeenSources, poolSeenCategories);
      }
      poolSeenSources.add(a.source_id);
      poolSeenCategories.add(a.category_id);
      return { ...a, score };
    });

    // Normalize including the updated article
    const articlesWithUpdated = [...scoredArticles, { ...article, score: newScore }];
    const normalized = normalizeScoresToBellCurve(articlesWithUpdated);
    
    // Find the updated article in normalized results
    const updatedArticle = normalized.find((a: any) => a.id === articleId);
    const adjustedScore = updatedArticle?.adjustedScore ?? 50;

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
