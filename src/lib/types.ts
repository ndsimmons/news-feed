// TypeScript types for News Feed application

export interface User {
  id: number;
  username: string;
  email?: string;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  description?: string;
  created_at: string;
}

export interface Source {
  id: number;
  name: string;
  url: string;
  category_id: number;
  fetch_method: 'rss' | 'api' | 'scrape' | 'manual';
  config: SourceConfig;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SourceConfig {
  rss_url?: string;
  type?: string;
  api_key_required?: boolean;
  lists?: string[];
  keywords?: string[];
  [key: string]: any;
}

export interface Article {
  id: number;
  title: string;
  summary?: string;
  url: string;
  source_id: number;
  category_id: number;
  published_at: string;
  fetched_at: string;
  image_url?: string;
  author?: string;
  content?: string;
  // Computed/joined fields
  source?: Source;
  category?: Category;
  score?: number;
  userVote?: number; // -1, 0, 1
}

export interface Vote {
  id: number;
  user_id: number;
  article_id: number;
  vote: number; // -1 or 1
  voted_at: string;
}

export interface InterestWeight {
  id: number;
  user_id: number;
  category_id?: number;
  source_id?: number;
  weight: number; // 0.1 to 2.0
  updated_at: string;
}

export interface ArticleScore {
  id: number;
  user_id: number;
  article_id: number;
  score: number;
  computed_at: string;
}

// API request/response types
export interface FeedRequest {
  limit?: number;
  offset?: number;
  category?: string;
  userId?: number;
}

export interface FeedResponse {
  articles: Article[];
  total: number;
  hasMore: boolean;
}

export interface VoteRequest {
  articleId: number;
  vote: number; // -1 or 1
  userId?: number;
}

export interface VoteResponse {
  success: boolean;
  vote: Vote;
  updatedWeights?: InterestWeight[];
}

// Scoring algorithm types
export interface ScoringWeights {
  categories: Record<number, number>;
  sources: Record<number, number>;
}

export interface ScoringParams {
  baseRelevance: number; // 0-1
  topicMatch: number; // 0-1
  upvotes: number;
  downvotes: number;
  ageHours: number;
  hasVoted: boolean;
}
