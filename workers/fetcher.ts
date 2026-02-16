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

    // Insert articles into database (without content first — content is fetched only for new articles)
    let inserted = 0;
    const newArticles: Array<{ articleId: number; article: Partial<Article> }> = [];
    
    for (const article of articles) {
      try {
        const result = await env.DB.prepare(`
          INSERT OR IGNORE INTO articles 
          (title, summary, url, source_id, category_id, published_at, image_url, author, content)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          article.title,
          article.summary || null,
          article.url,
          source.id,
          source.category_id,
          article.published_at || new Date().toISOString(),
          article.image_url || null,
          article.author || null,
          article.content || null  // May already have content from RSS content:encoded
        ).run();
        
        // Only count if actually inserted (not duplicate)
        if (result.meta.changes > 0) {
          inserted++;
          const articleId = result.meta.last_row_id;
          newArticles.push({ articleId: articleId as number, article });
          
          // Generate embedding for new article
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
    
    // Fetch full article text for newly inserted articles that don't have content yet
    // Skip podcast sources (spotify_url) — no article text to extract
    const sourceFlags = source as any;
    if (sourceFlags.spotify_url) {
      console.log(`Skipping content fetch for podcast source: ${source.name}`);
    } else {
      const needsContent = newArticles.filter(({ article }) => {
        const contentLen = article.content?.length || 0;
        return contentLen < 200 && article.url;
      });
      
      if (needsContent.length > 0) {
        // For paywalled sources (use_archive=1, e.g. NYT/WSJ), fetch via archive.is
        // This mirrors the click-through logic in FeedCard.tsx
        const useArchive = !!(sourceFlags.use_archive);
        
        console.log(`Fetching full text for ${needsContent.length} new articles from ${source.name}${useArchive ? ' (via archive.is)' : ''}`);
        
        // Fetch in parallel batches of 5
        const BATCH_SIZE = 5;
        for (let i = 0; i < needsContent.length; i += BATCH_SIZE) {
          const batch = needsContent.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map(({ article }) => {
              const fetchUrl = useArchive
                ? `https://archive.is/newest/${article.url!.split('?')[0]}`
                : article.url!;
              return extractArticleText(fetchUrl);
            })
          );
          
          // Update articles that got content
          for (let j = 0; j < results.length; j++) {
            const result = results[j];
            if (result.status === 'fulfilled' && result.value) {
              try {
                await env.DB.prepare(
                  'UPDATE articles SET content = ? WHERE id = ?'
                ).bind(result.value, batch[j].articleId).run();
              } catch (err) {
                console.error(`Failed to update content for article ${batch[j].articleId}:`, err);
              }
            }
          }
        }
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
    content: item.content || null  // From content:encoded if available; full text fetched post-INSERT for new articles only
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

      // Extract article body text from the page we already fetched
      // Reuse the HTML we have instead of fetching again
      let bodyText: string | null = null;
      const paragraphs: string[] = [];
      // Try <article> tag first
      const articleTagMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
      const bodyHtml = articleTagMatch ? articleTagMatch[1] : html;
      const pMatches = bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
      for (const m of pMatches) {
        const pText = stripHtmlTags(m[1]).trim();
        if (pText.length > 40 && pText.length < 2000) {
          paragraphs.push(pText);
        }
      }
      if (paragraphs.length > 0) {
        bodyText = paragraphs.join('\n\n').substring(0, 5000);
      }

      if (title) {
        articles.push({
          title: title.trim(),
          summary: summary?.trim() || null,
          url: articleUrl,
          published_at: publishedTime || new Date().toISOString(),
          image_url: image || null,
          author: author || null,
          content: bodyText
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
 * Fetch the article page and extract the main body text.
 * Uses <article> tag, common content selectors, or falls back to <p> tag extraction.
 * Returns plain text (HTML stripped), truncated to ~5000 chars to keep DB lean.
 */
async function extractArticleText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NewsFeedAggregator/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000) // 8s timeout per article
    });
    if (!res.ok) return null;

    const html = await res.text();

    // Strategy 1: Extract text from <article> tag (most news sites use this)
    let bodyHtml = '';
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      bodyHtml = articleMatch[1];
    }

    // Strategy 2: Try common content div patterns
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

    // Strategy 3: Collect all <p> tags from the page body as fallback
    if (!bodyHtml) {
      // Try to get just the <body> first
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      bodyHtml = bodyMatch ? bodyMatch[1] : html;
    }

    // Extract text from <p> tags within the selected HTML
    const paragraphs: string[] = [];
    const pMatches = bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    for (const m of pMatches) {
      const text = stripHtmlTags(m[1]).trim();
      // Skip very short paragraphs (likely navigation/captions) and very long ones (likely embedded data)
      if (text.length > 40 && text.length < 2000) {
        paragraphs.push(text);
      }
    }

    if (paragraphs.length === 0) return null;

    // Join and truncate to ~5000 chars
    const fullText = paragraphs.join('\n\n');
    return fullText.substring(0, 5000) || null;
  } catch (err) {
    // Timeout, network error, etc. — don't fail the whole fetch
    return null;
  }
}

/**
 * Strip HTML tags from a string, preserving text content
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
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
