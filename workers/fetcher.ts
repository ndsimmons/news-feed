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
 * Normalize URL by removing CDATA wrappers and whitespace
 */
function normalizeUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  
  // Remove CDATA wrappers
  let normalized = url.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
  
  // Trim whitespace
  normalized = normalized.trim();
  
  return normalized;
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
    url: normalizeUrl(item.link),
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
 * Fetch articles from web scraping (sitemap or homepage)
 */
async function fetchFromScrape(source: Source): Promise<Partial<Article>[]> {
  const config = typeof source.config === 'string' 
    ? JSON.parse(source.config) 
    : source.config;

  const scrapeUrl = config.scrape_url || source.url;
  if (!scrapeUrl) {
    console.log(`No scrape URL configured for ${source.name}`);
    return [];
  }

  const origin = new URL(scrapeUrl).origin;
  let articleUrls: string[] = [];

  // If sitemap-based, fetch article URLs from sitemap
  if (config.use_sitemap && config.sitemap_url) {
    try {
      const sitemapRes = await fetch(config.sitemap_url, {
        headers: { 'User-Agent': 'NewsFeedAggregator/1.0' },
        redirect: 'follow'
      });
      if (sitemapRes.ok) {
        const sitemapText = await sitemapRes.text();
        
        // Handle sitemap index (contains links to other sitemaps)
        if (sitemapText.includes('<sitemapindex')) {
          const subSitemaps = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/gi)]
            .map(m => m[1])
            .filter(u => u.includes('post') || u.includes('article') || u.includes('news'))
            .slice(0, 2); // Only check first 2 relevant sub-sitemaps
          
          for (const subUrl of subSitemaps) {
            try {
              const subRes = await fetch(subUrl, { headers: { 'User-Agent': 'NewsFeedAggregator/1.0' } });
              if (subRes.ok) {
                const subText = await subRes.text();
                const urls = [...subText.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1]);
                articleUrls.push(...urls);
              }
            } catch (e) { /* skip */ }
          }
        } else {
          articleUrls = [...sitemapText.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1]);
        }

        // Filter to likely article URLs
        articleUrls = articleUrls.filter(u => {
          const p = new URL(u).pathname;
          return p !== '/' && p.split('/').filter(Boolean).length >= 2;
        });
      }
    } catch (e) {
      console.error(`Failed to fetch sitemap for ${source.name}:`, e);
    }
  }

  // Fallback: scrape homepage for article links
  if (articleUrls.length === 0) {
    try {
      const res = await fetch(scrapeUrl, {
        headers: { 'User-Agent': 'NewsFeedAggregator/1.0' },
        redirect: 'follow'
      });
      const html = await res.text();
      const linkMatches = html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi);
      for (const m of linkMatches) {
        try {
          const href = new URL(m[1], origin).href;
          if (href.startsWith(origin)) {
            const path = new URL(href).pathname;
            if (path !== '/' && path.split('/').filter(Boolean).length >= 2 
                && !path.match(/\.(css|js|png|jpg|gif|svg|ico)$/i)
                && !path.match(/^\/?(tag|category|author|page|search|login|signup|about|contact|privacy|terms)/i)) {
              if (!articleUrls.includes(href)) articleUrls.push(href);
            }
          }
        } catch (e) { /* skip */ }
      }
    } catch (e) {
      console.error(`Failed to scrape homepage for ${source.name}:`, e);
    }
  }

  // Only process the 20 most recent (sitemap URLs are often newest-first)
  articleUrls = articleUrls.slice(0, 20);

  console.log(`Found ${articleUrls.length} article URLs for ${source.name}`);

  // Fetch each article page and extract metadata
  const articles: Partial<Article>[] = [];
  for (const articleUrl of articleUrls) {
    try {
      const res = await fetch(articleUrl, {
        headers: { 'User-Agent': 'NewsFeedAggregator/1.0' },
        redirect: 'follow'
      });
      if (!res.ok) continue;
      const html = await res.text();

      // Extract metadata from Open Graph / meta tags
      const title = extractMeta(html, 'og:title') || extractMeta(html, 'twitter:title') || extractHtmlTag(html, 'title');
      const summary = extractMeta(html, 'og:description') || extractMeta(html, 'description') || extractMeta(html, 'twitter:description');
      const image = extractMeta(html, 'og:image') || extractMeta(html, 'twitter:image');
      const author = extractMeta(html, 'author') || extractMeta(html, 'article:author');
      const publishedTime = extractMeta(html, 'article:published_time') || extractMeta(html, 'date') || extractMeta(html, 'pubdate');

      if (title) {
        articles.push({
          title: title.trim(),
          summary: summary?.trim() || null,
          url: articleUrl,
          published_at: publishedTime || new Date().toISOString(),
          image_url: image || null,
          author: author || null
        });
      }
    } catch (e) {
      console.log(`Failed to scrape article: ${articleUrl}`);
    }
  }

  console.log(`Extracted ${articles.length} articles from ${source.name}`);
  return articles;
}

/** Extract meta tag content by property or name */
function extractMeta(html: string, key: string): string | null {
  // Try property="key"
  const propMatch = html.match(new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${key}["']`, 'i'));
  if (propMatch) return propMatch[1];
  
  // Try name="key"
  const nameMatch = html.match(new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${key}["']`, 'i'));
  if (nameMatch) return nameMatch[1];
  
  return null;
}

/** Extract content from an HTML tag */
function extractHtmlTag(html: string, tag: string): string | null {
  const match = html.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i'));
  return match ? match[1].trim() : null;
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
