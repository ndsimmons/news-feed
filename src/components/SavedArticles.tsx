import { useState, useEffect } from 'react';
import FeedCard from './FeedCard';
import type { Article, FeedResponse } from '../lib/types';
import { API_BASE_URL } from '../lib/config';
import { useAuth } from '../lib/auth';

export default function SavedArticles() {
  const { user, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && user) {
      fetchSavedArticles();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, user]);

  const fetchSavedArticles = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        userId: user?.id.toString() || '1',
        limit: '100'
      });

      const response = await fetch(`${API_BASE_URL}/api/saved?${params}`, {
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch saved articles');
      }

      const data = await response.json();
      setArticles(data.articles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error fetching saved articles:', err);
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
          userId: user?.id || 1
        })
      });

      if (!response.ok) {
        throw new Error('Failed to vote');
      }

      // Update article vote in UI
      setArticles(prevArticles =>
        prevArticles.map(article =>
          article.id === articleId
            ? { ...article, userVote: vote }
            : article
        )
      );

      // If downvoted, remove after animation
      if (vote === -1) {
        setTimeout(() => {
          setArticles(prevArticles => prevArticles.filter(article => article.id !== articleId));
        }, 2000);
      }
    } catch (err) {
      console.error('Error voting:', err);
      throw err;
    }
  };

  const handleUnsave = (articleId: number) => {
    // Remove from list when unsaved
    setArticles(prevArticles => prevArticles.filter(article => article.id !== articleId));
  };

  if (!isAuthenticated) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Saved Articles</h1>
        <p className="text-gray-600 mb-8">
          Sign in to save articles and read them later.
        </p>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-auth-modal'))}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Saved Articles</h1>
        <div className="text-center py-12 text-gray-500">
          Loading your saved articles...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Saved Articles</h1>
        <div className="text-center py-12 text-red-600">
          Error: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Saved Articles</h1>
        <a
          href="/"
          className="text-blue-600 hover:text-blue-700 font-medium"
        >
          ← Back to Feed
        </a>
      </div>

      {articles.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-xl mb-4">No saved articles yet</p>
          <p className="text-sm">
            Click the bookmark icon (🔖) on any article to save it for later
          </p>
        </div>
      ) : (
        <>
          <p className="text-gray-600 mb-6">
            {articles.length} {articles.length === 1 ? 'article' : 'articles'} saved
          </p>
          <div className="space-y-6">
            {articles.map(article => (
              <FeedCard
                key={article.id}
                article={article}
                onVote={handleVote}
                isAuthenticated={isAuthenticated}
                userId={user?.id || 1}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
