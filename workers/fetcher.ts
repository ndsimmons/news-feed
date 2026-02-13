// Article Fetcher - Cloudflare Cron Trigger
// Fetches articles from all active sources periodically

import type { Source, Article } from '../src/lib/types';
import { parseRSSFeed, parseRSSDate } from './parsers/rss';
import { generateArticleEmbedding, storeEmbedding } from './embeddings';

interface Env {
  DB: D1Database;
  KV: KVNamespace;
  AI: any;
  VECTORIZE: any;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Starting article fetch job...');
    
    try {
      await fetchArticles(env);
      console.log('Article fetch job completed successfully');
    } catch (error) {
      console.error('Error in fetch job:', error);
    }
  },

  // Also allow manual triggering via HTTP
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/fetch-now') {
      try {
        await fetchArticles(env);
        return new Response(JSON.stringify({ success: true, message: 'Articles fetched' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: String(error) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

/**
 * Main function to fetch articles from all active sources
 */
async function fetchArticles(env: Env): Promise<void> {
  // Get all active sources
  const sourcesResult = await env.DB.prepare(
    'SELECT * FROM sources WHERE active = 1'
  ).all();

  const sources = sourcesResult.results as Source[];

  console.log(`Fetching from ${sources.length} active sources...`);

  // Fetch from each source
  const fetchPromises = sources.map(source => fetchFromSource(source, env));
  const results = await Promise.allSettled(fetchPromises);

  // Log results
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  console.log(`Fetch complete: ${successful} succeeded, ${failed} failed`);
}

/**
 * Fetch articles from a single source
 */
async function fetchFromSource(source: Source, env: Env): Promise<number> {
  console.log(`Fetching from ${source.name} (${source.fetch_method})...`);

  try {
    let articles: Partial<Article>[] = [];

    switch (source.fetch_method) {
      case 'rss':
        articles = await fetchFromRSS(source);
        break;
      case 'api':
        articles = await fetchFromAPI(source);
        break;
      case 'scrape':
        articles = await fetchFromScrape(source);
        break;
      default:
        console.log(`Unknown fetch method: ${source.fetch_method}`);
        return 0;
    }

    // Insert articles into database
    let inserted = 0;
    for (const article of articles) {
      try {
        const result = await env.DB.prepare(`
          INSERT OR IGNORE INTO articles 
          (title, summary, url, source_id, category_id, published_at, image_url, author)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          article.title,
          article.summary || null,
          article.url,
          source.id,
          source.category_id,
          article.published_at || new Date().toISOString(),
          article.image_url || null,
          article.author || null
        ).run();
        
        // Only count if actually inserted (not duplicate)
        if (result.meta.changes > 0) {
          inserted++;
          const articleId = result.meta.last_row_id;
          
          // NEW: Generate embedding for new article (async, don't block)
          try {
            const fullArticle = {
              id: articleId,
              title: article.title || '',
              summary: article.summary,
              url: article.url || '',
              source_id: source.id,
              category_id: source.category_id
            } as Article;
            
            const embResult = await generateArticleEmbedding(env.AI, fullArticle);
            await storeEmbedding(env.VECTORIZE, articleId, embResult.embedding, {
              title: article.title,
              category_id: source.category_id,
              source_id: source.id
            });
            
            // Mark as generated
            await env.DB.prepare(`
              INSERT INTO article_embeddings (article_id, embedding_generated, embedding_model, generated_at)
              VALUES (?, 1, ?, CURRENT_TIMESTAMP)
            `).bind(articleId, embResult.model).run();
            
            console.log(`Generated embedding for article ${articleId}`);
          } catch (embError) {
            // Don't fail the entire fetch if embedding fails
            console.error(`Failed to generate embedding for article ${articleId}:`, embError);
          }
        }
      } catch (error) {
        // Probably duplicate URL, skip
        console.log(`Skipping duplicate article: ${article.url}`);
      }
    }

    console.log(`Inserted ${inserted} new articles from ${source.name}`);
    return inserted;
  } catch (error) {
    console.error(`Error fetching from ${source.name}:`, error);
    throw error;
  }
}

/**
 * Fetch articles from RSS feed
 */
async function fetchFromRSS(source: Source): Promise<Partial<Article>[]> {
  const config = typeof source.config === 'string' 
    ? JSON.parse(source.config) 
    : source.config;

  if (!config.rss_url) {
    throw new Error('RSS URL not configured');
  }

  const feed = await parseRSSFeed(config.rss_url);

  return feed.items.map(item => ({
    title: item.title,
    summary: item.description || null,
    url: item.link,
    published_at: item.pubDate ? parseRSSDate(item.pubDate)?.toISOString() : null,
    image_url: item.imageUrl || null,
    author: item.author || null,
    content: item.content || null
  }));
}

/**
 * Fetch articles from API (Twitter, Sofascore, etc.)
 * Placeholder - implement based on specific API
 */
async function fetchFromAPI(source: Source): Promise<Partial<Article>[]> {
  const config = typeof source.config === 'string' 
    ? JSON.parse(source.config) 
    : source.config;

  console.log(`API fetching not yet implemented for ${source.name}`);
  
  // TODO: Implement Twitter API, Sofascore API, etc.
  // This would require API keys and specific implementations

  return [];
}

/**
 * Fetch articles from web scraping
 * Placeholder - implement based on specific site
 */
async function fetchFromScrape(source: Source): Promise<Partial<Article>[]> {
  console.log(`Web scraping not yet implemented for ${source.name}`);
  
  // TODO: Implement web scraping with selectors from config
  
  return [];
}

/**
 * Clean up old articles (keep last 30 days)
 */
async function cleanupOldArticles(env: Env): Promise<void> {
  await env.DB.prepare(`
    DELETE FROM articles 
    WHERE published_at < datetime('now', '-30 days')
  `).run();

  console.log('Cleaned up old articles');
}
