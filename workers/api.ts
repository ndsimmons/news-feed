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
  getTopArticles 
} from './scoring';
import {
  generateArticleEmbedding,
  storeEmbedding
} from './embeddings';

interface Env {
  DB: D1Database;
  KV: KVNamespace;
  AI: any; // Cloudflare AI binding
  VECTORIZE: any; // Vectorize binding
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
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
 * GET /api/feed - Get personalized article feed
 */
async function handleGetFeed(
  request: Request,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const categorySlug = url.searchParams.get('category');
  const userId = parseInt(url.searchParams.get('userId') || '1');

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

  // Build query for articles
  let query = `
    SELECT a.*, s.name as source_name, c.name as category_name, c.slug as category_slug
    FROM articles a
    LEFT JOIN sources s ON a.source_id = s.id
    LEFT JOIN categories c ON a.category_id = c.id
    WHERE a.published_at > datetime('now', '-7 days')
  `;

  const params: any[] = [];

  if (categorySlug) {
    query += ' AND c.slug = ?';
    params.push(categorySlug);
  }

  query += ' ORDER BY a.published_at DESC LIMIT 200';

  const articlesResult = await env.DB.prepare(query).bind(...params).all();
  
  // Score and sort articles
  const articles = articlesResult.results as Article[];
  const topArticles = getTopArticles(articles, weights, votedArticleIds, limit);

  // Add user vote status to each article
  const enrichedArticles = topArticles.map(article => ({
    ...article,
    userVote: votedArticleIds.has(article.id) ? 1 : 0
  }));

  const response: FeedResponse = {
    articles: enrichedArticles,
    total: articlesResult.results.length,
    hasMore: articlesResult.results.length > limit
  };

  return new Response(JSON.stringify(response), {
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

  // Insert or update vote
  await env.DB.prepare(`
    INSERT INTO votes (user_id, article_id, vote) 
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, article_id) 
    DO UPDATE SET vote = ?, voted_at = CURRENT_TIMESTAMP
  `).bind(userId, body.articleId, body.vote, body.vote).run();

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

  await env.DB.prepare(`
    UPDATE interest_weights 
    SET weight = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ? AND category_id = ? AND source_id = ?
  `).bind(categoryWeight, userId, article.category_id, article.source_id).run();

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
 * GET /api/sources - Get all sources
 */
async function handleGetSources(
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT s.*, c.name as category_name 
    FROM sources s
    LEFT JOIN categories c ON s.category_id = c.id
    ORDER BY c.name, s.name
  `).all();

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
