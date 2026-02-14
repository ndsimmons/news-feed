// RSS Feed Parser

export interface RSSItem {
  title: string;
  link: string;
  description?: string;
  pubDate?: string;
  author?: string;
  content?: string;
  imageUrl?: string;
}

export interface RSSFeed {
  title: string;
  link: string;
  description?: string;
  items: RSSItem[];
}

/**
 * Parse RSS feed from URL
 */
export async function parseRSSFeed(url: string): Promise<RSSFeed> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NewsFeedAggregator/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();
    return parseRSSText(text);
  } catch (error) {
    console.error(`Error fetching RSS feed from ${url}:`, error);
    throw error;
  }
}

/**
 * Parse RSS XML text
 */
export function parseRSSText(xmlText: string): RSSFeed {
  // Simple XML parsing - in production, consider using a proper XML parser
  const feed: RSSFeed = {
    title: '',
    link: '',
    description: '',
    items: []
  };

  try {
    // Extract feed metadata
    feed.title = extractTag(xmlText, 'title') || '';
    feed.link = extractTag(xmlText, 'link') || '';
    feed.description = extractTag(xmlText, 'description') || '';

    // Extract items
    const itemMatches = xmlText.match(/<item[^>]*>[\s\S]*?<\/item>/gi);
    
    if (itemMatches) {
      feed.items = itemMatches.map(itemXml => parseRSSItem(itemXml));
    }
  } catch (error) {
    console.error('Error parsing RSS XML:', error);
  }

  return feed;
}

/**
 * Parse individual RSS item
 */
function parseRSSItem(itemXml: string): RSSItem {
  const item: RSSItem = {
    title: '',
    link: ''
  };

  item.title = extractTag(itemXml, 'title') || '';
  item.link = extractTag(itemXml, 'link') || extractTag(itemXml, 'guid') || '';
  item.description = extractTag(itemXml, 'description') || extractTag(itemXml, 'summary') || '';
  item.pubDate = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'published') || '';
  item.author = extractTag(itemXml, 'author') || extractTag(itemXml, 'dc:creator') || '';
  item.content = extractTag(itemXml, 'content:encoded') || extractTag(itemXml, 'content') || '';
  
  // Special handling for Techmeme: extract actual article URL from description
  if (item.link && item.link.includes('techmeme.com') && item.description) {
    // Techmeme format: First <A HREF> in CDATA is the actual article link
    // Example: <A HREF="https://www.theinformation.com/articles/...">
    const firstLinkMatch = item.description.match(/<A HREF=["']([^"']+)["']/i);
    if (firstLinkMatch && firstLinkMatch[1] && !firstLinkMatch[1].includes('techmeme.com')) {
      item.link = firstLinkMatch[1];
    }
  }
  
  // Try to extract image
  const mediaContent = extractTag(itemXml, 'media:content');
  if (mediaContent) {
    const urlMatch = mediaContent.match(/url=["']([^"']+)["']/);
    if (urlMatch) {
      item.imageUrl = urlMatch[1];
    }
  }
  
  // Fallback: look for image in description
  if (!item.imageUrl && item.description) {
    const imgMatch = item.description.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) {
      item.imageUrl = imgMatch[1];
    }
  }

  // Clean HTML from description
  if (item.description) {
    item.description = stripHtml(item.description);
  }

  return item;
}

/**
 * Extract content from XML tag
 */
function extractTag(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  
  if (match && match[1]) {
    let content = match[1].trim();
    
    // Strip CDATA sections
    content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    
    return decodeHtmlEntities(content);
  }
  
  // Try self-closing or attribute format
  const attrRegex = new RegExp(`<${tagName}[^>]*>`, 'i');
  const attrMatch = xml.match(attrRegex);
  if (attrMatch) {
    return attrMatch[0];
  }
  
  return null;
}

/**
 * Strip HTML tags from string
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&mdash;': '\u2014',
    '&ndash;': '\u2013',
    '&ldquo;': '\u201C',
    '&rdquo;': '\u201D',
    '&lsquo;': '\u2018',
    '&rsquo;': '\u2019'
  };

  // First handle named entities
  let decoded = text.replace(/&[a-z]+;/gi, match => entities[match] || match);
  
  // Then handle numeric entities (e.g., &#8220; or &#x201c;)
  decoded = decoded.replace(/&#(x?)([0-9a-f]+);/gi, (match, isHex, code) => {
    const num = isHex ? parseInt(code, 16) : parseInt(code, 10);
    return String.fromCharCode(num);
  });
  
  return decoded;
}

/**
 * Parse RFC 822 date format (common in RSS)
 */
export function parseRSSDate(dateString: string): Date | null {
  if (!dateString) return null;
  
  try {
    // Try standard date parsing first
    const date = new Date(dateString);
    if (!isNaN(date.getTime())) {
      return date;
    }
  } catch (error) {
    console.error('Error parsing date:', dateString, error);
  }
  
  return null;
}
