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
 * Generate embedding for an article (title + summary)
 */
export async function generateArticleEmbedding(
  ai: any,
  article: Article
): Promise<EmbeddingResult> {
  // Combine title and summary for better context
  const text = article.summary
    ? `${article.title}. ${article.summary}`
    : article.title;

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
    await vectorize.insert([
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
 */
export async function calculateContentScore(
  vectorize: any,
  articleEmbedding: number[],
  userLikedArticles: number[],
  userDislikedArticles: number[]
): Promise<number> {
  // Find similar articles
  const similar = await findSimilarArticles(vectorize, articleEmbedding, 20);

  let score = 0;
  let likeCount = 0;
  let dislikeCount = 0;

  for (const match of similar) {
    if (userLikedArticles.includes(match.articleId)) {
      // Similar to liked article - boost score
      score += match.similarity * 50; // Scale to 0-50 points
      likeCount++;
    } else if (userDislikedArticles.includes(match.articleId)) {
      // Similar to disliked article - reduce score
      score -= match.similarity * 30; // Penalty 0-30 points
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
