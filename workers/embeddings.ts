// Embedding Generation Service
// Uses Cloudflare AI Workers to generate text embeddings

import type { Article } from '../src/lib/types';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface SimilarArticle {
  articleId: number;
  similarity: number;
}

/**
 * Generate embedding for article headline/summary
 * Uses Cloudflare AI's BGE model (768 dimensions)
 */
export async function generateEmbedding(
  ai: any,
  text: string
): Promise<EmbeddingResult> {
  try {
    const response = await ai.run('@cf/baai/bge-base-en-v1.5', {
      text: [text] // Model expects array of texts
    });

    return {
      embedding: response.data[0], // First result
      model: 'bge-base-en-v1.5',
      dimensions: 768
    };
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Generate embedding for an article (title + summary + metadata)
 */
export async function generateArticleEmbedding(
  ai: any,
  article: Article,
  includeMetadata: boolean = true
): Promise<EmbeddingResult> {
  // Build text components
  const parts: string[] = [article.title];
  
  if (article.summary) {
    parts.push(article.summary);
  }
  
  // Add metadata for richer semantic context
  if (includeMetadata) {
    if (article.author) {
      parts.push(`by ${article.author}`);
    }
    if ((article as any).source_name) {
      parts.push(`from ${(article as any).source_name}`);
    }
  }
  
  const text = parts.join('. ');
  return generateEmbedding(ai, text);
}

/**
 * Store embedding in Vectorize
 */
export async function storeEmbedding(
  vectorize: any,
  articleId: number,
  embedding: number[],
  metadata?: Record<string, any>
): Promise<void> {
  try {
    await vectorize.upsert([
      {
        id: articleId.toString(),
        values: embedding,
        metadata: metadata || {}
      }
    ]);
  } catch (error) {
    console.error('Error storing embedding:', error);
    throw error;
  }
}

/**
 * Find similar articles using vector similarity search
 */
export async function findSimilarArticles(
  vectorize: any,
  embedding: number[],
  topK: number = 10,
  filter?: Record<string, any>
): Promise<SimilarArticle[]> {
  try {
    const results = await vectorize.query(embedding, {
      topK,
      filter,
      returnValues: false,
      returnMetadata: false
    });

    return results.matches.map((match: any) => ({
      articleId: parseInt(match.id),
      similarity: match.score
    }));
  } catch (error) {
    console.error('Error finding similar articles:', error);
    return [];
  }
}

/**
 * Calculate content-based score boost
 * Compares new article against user's liked articles
 * 
 * @param strengthMultiplier - User preference 0.0-1.0 (weak to strong similarity impact)
 */
export async function calculateContentScore(
  vectorize: any,
  articleEmbedding: number[],
  userLikedArticles: number[],
  userDislikedArticles: number[],
  strengthMultiplier: number = 0.5
): Promise<number> {
  // Find similar articles
  const similar = await findSimilarArticles(vectorize, articleEmbedding, 20);

  let score = 0;
  let likeCount = 0;
  let dislikeCount = 0;

  // Calculate dynamic boost/penalty range based on user preference
  // strengthMultiplier 0.0 = weak (+10/-10), 0.5 = medium (+55/-55), 1.0 = strong (+100/-100)
  const maxBoost = 10 + (strengthMultiplier * 90);    // 10 to 100
  const maxPenalty = 10 + (strengthMultiplier * 90);  // 10 to 100

  for (const match of similar) {
    if (userLikedArticles.includes(match.articleId)) {
      // Similar to liked article - boost score
      score += match.similarity * maxBoost;
      likeCount++;
    } else if (userDislikedArticles.includes(match.articleId)) {
      // Similar to disliked article - reduce score
      score -= match.similarity * maxPenalty;
      dislikeCount++;
    }
  }

  // Average the score if we found matches
  if (likeCount + dislikeCount > 0) {
    score = score / (likeCount + dislikeCount);
  }

  return Math.round(score * 100) / 100;
}

/**
 * Batch generate embeddings for multiple articles
 */
export async function batchGenerateEmbeddings(
  ai: any,
  articles: Article[]
): Promise<Map<number, EmbeddingResult>> {
  const results = new Map<number, EmbeddingResult>();

  // Process in batches of 10 to avoid rate limits
  const batchSize = 10;
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize);
    const promises = batch.map(article =>
      generateArticleEmbedding(ai, article)
        .then(result => ({ articleId: article.id, result }))
        .catch(error => {
          console.error(`Failed to generate embedding for article ${article.id}:`, error);
          return null;
        })
    );

    const batchResults = await Promise.all(promises);

    for (const item of batchResults) {
      if (item) {
        results.set(item.articleId, item.result);
      }
    }

    // Small delay between batches
    if (i + batchSize < articles.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}
