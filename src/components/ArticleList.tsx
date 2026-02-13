import { useState, useEffect } from 'react';
import FeedCard from './FeedCard';
import CategoryFilter from './CategoryFilter';
import type { Article, FeedResponse } from '../lib/types';
import { API_BASE_URL } from '../lib/config';

export default function ArticleList() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchArticles();
  }, [category]);

  const fetchArticles = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        limit: '20',
        userId: '1'
      });
      
      if (category) {
        params.append('category', category);
      }

      const response = await fetch(`${API_BASE_URL}/api/feed?${params}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch articles');
      }

      const data: FeedResponse = await response.json();
      setArticles(data.articles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error fetching articles:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (articleId: number, vote: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          articleId,
          vote,
          userId: 1
        })
      });

      if (!response.ok) {
        throw new Error('Failed to vote');
      }

      // Update article in local state
      setArticles(prevArticles =>
        prevArticles.map(article =>
          article.id === articleId
            ? { ...article, userVote: vote }
            : article
        )
      );

      // Optionally refresh the feed to get updated scores
      setTimeout(() => {
        setRefreshing(true);
        fetchArticles().finally(() => setRefreshing(false));
      }, 500);
    } catch (err) {
      console.error('Error voting:', err);
      throw err;
    }
  };

  const handleCategoryChange = (slug: string | null) => {
    setCategory(slug);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchArticles().finally(() => setRefreshing(false));
  };

  if (loading && articles.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="space-y-6">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="article-card">
              <div className="skeleton h-6 w-3/4 mb-2"></div>
              <div className="skeleton h-4 w-1/4 mb-3"></div>
              <div className="skeleton h-4 w-full mb-2"></div>
              <div className="skeleton h-4 w-5/6"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-800 mb-4">Error loading articles: {error}</p>
          <button
            onClick={fetchArticles}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="sticky top-16 bg-white z-40 px-4">
        <CategoryFilter onCategoryChange={handleCategoryChange} />
      </div>

      <div className="px-4 py-4">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">
              {category ? `${category.replace('-', '/')} News` : 'Top Stories'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {articles.length} articles • Sorted by relevance
            </p>
          </div>
          
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {articles.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">No articles found</p>
            <p className="text-gray-500 text-sm mt-2">
              Try selecting a different category or check back later
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {articles.map((article) => (
              <FeedCard
                key={article.id}
                article={article}
                onVote={handleVote}
              />
            ))}
          </div>
        )}

        {articles.length > 0 && (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">
              💡 Tip: Use <kbd className="px-2 py-1 bg-gray-100 rounded">←</kbd> and{' '}
              <kbd className="px-2 py-1 bg-gray-100 rounded">→</kbd> to vote, or drag articles left/right
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
