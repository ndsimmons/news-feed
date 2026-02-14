import { useState, useEffect } from 'react';
import FeedCard from './FeedCard';
import CategoryFilter from './CategoryFilter';
import AuthModal from './AuthModal';
import CelebrationModal from './CelebrationModal';
import type { Article, FeedResponse } from '../lib/types';
import { API_BASE_URL } from '../lib/config';
import { useAuth } from '../lib/auth';

export default function ArticleList() {
  const { user, isAuthenticated } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  
  // Debug: Log when celebration modal state changes
  useEffect(() => {
    console.log('ArticleList: showCelebration state changed to:', showCelebration);
  }, [showCelebration]);
  const [seenArticles, setSeenArticles] = useState<Set<number>>(new Set());
  const [pendingImpressions, setPendingImpressions] = useState<Set<number>>(new Set());
  const [lastFetchTime, setLastFetchTime] = useState<number>(Date.now());
  const [voteCount, setVoteCount] = useState(0);

  useEffect(() => {
    setPage(1);
    setArticles([]);
    setHasMore(true);
    fetchArticles(true);
    
    // Trigger feed refresh on page load/category change
    fetch(`${API_BASE_URL}/api/refresh`, { method: 'POST' }).catch(err =>
      console.log('Refresh trigger failed:', err)
    );
  }, [category]);

  // Fetch vote count when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      const fetchVoteCount = async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/api/user/stats?userId=${user.id}`);
          if (response.ok) {
            const data = await response.json();
            setVoteCount(data.voteCount || 0);
          }
        } catch (error) {
          console.error('Error fetching vote count:', error);
        }
      };
      fetchVoteCount();
    }
  }, [isAuthenticated, user]);

  // Listen for vote-cast events to update count
  useEffect(() => {
    const handleVoteCast = () => {
      const previousCount = voteCount;
      const newCount = previousCount + 1;
      console.log(`ArticleList: Vote cast! Count: ${previousCount} → ${newCount}`);
      setVoteCount(newCount);
      
      // Show celebration modal when reaching exactly 10 votes
      if (newCount === 10) {
        console.log('ArticleList: 🎉 Reached 10 votes! Showing celebration modal...');
        setTimeout(() => {
          setShowCelebration(true);
        }, 500); // Small delay so rooster animation completes
      }
    };

    window.addEventListener('vote-cast', handleVoteCast);
    return () => window.removeEventListener('vote-cast', handleVoteCast);
  }, [voteCount]);

  // Listen for first interaction being applied after signup
  useEffect(() => {
    const handleFirstInteractionApplied = (event: CustomEvent) => {
      console.log('First interaction applied - refreshing feed to show vote/save');
      
      // Refresh feed immediately to show the applied interaction
      setArticles([]);
      setPage(1);
      setHasMore(true);
      fetchArticles(true);
      
      // Also refetch vote count to update Discovery Mode badge
      if (user) {
        fetch(`${API_BASE_URL}/api/user/stats?userId=${user.id}`)
          .then(res => res.json())
          .then(data => setVoteCount(data.voteCount || 0))
          .catch(err => console.error('Error fetching vote count:', err));
      }
    };

    window.addEventListener('first-interaction-applied', handleFirstInteractionApplied as EventListener);
    return () => window.removeEventListener('first-interaction-applied', handleFirstInteractionApplied as EventListener);
  }, [user]);

  // Refresh feed when authentication state changes (login/logout)
  useEffect(() => {
    // Skip on initial mount (loading is true)
    if (!loading) {
      console.log('Auth state changed - refreshing feed');
      setArticles([]);
      setPage(1);
      setHasMore(true);
      fetchArticles(true);
    }
  }, [isAuthenticated]);

  // Listen for personalize button click from header
  useEffect(() => {
    const handleOpenAuth = () => {
      console.log('ArticleList: Received open-auth-modal event, isAuthenticated:', isAuthenticated);
      if (!isAuthenticated) {
        setShowAuthModal(true);
      } else {
        console.log('ArticleList: User already authenticated, ignoring auth modal request');
      }
    };
    
    window.addEventListener('open-auth-modal', handleOpenAuth);
    return () => window.removeEventListener('open-auth-modal', handleOpenAuth);
  }, [isAuthenticated]);

  // Infinite scroll detection - pre-load before reaching bottom
  useEffect(() => {
    const handleScroll = () => {
      if (loadingMore || !hasMore) return;
      
      const scrollPosition = window.innerHeight + window.scrollY;
      const pageHeight = document.documentElement.scrollHeight;
      
      // Pre-load when user is 1500px from bottom (about 3-4 articles away)
      if (pageHeight - scrollPosition < 1500) {
        loadMoreArticles();
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loadingMore, hasMore, page]);

  // Sync subnav scroll behavior with header
  useEffect(() => {
    let lastScrollTop = 0;
    let scrollTimeout: number | null = null;
    const scrollThreshold = 50;

    const handleScroll = () => {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }

      scrollTimeout = window.setTimeout(() => {
        const header = document.getElementById('site-header');
        const categoryFilter = document.getElementById('category-filter');
        
        if (!header || !categoryFilter) return;

        const headerHeight = header.offsetHeight;
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

        if (scrollTop > scrollThreshold) {
          if (scrollTop > lastScrollTop) {
            // Scrolling down - hide both
            header.style.transform = 'translateY(-100%)';
            categoryFilter.style.transform = `translateY(-${headerHeight}px)`;
          } else {
            // Scrolling up - show both
            header.style.transform = 'translateY(0)';
            categoryFilter.style.transform = 'translateY(0)';
          }
        } else {
          // At top - always show both
          header.style.transform = 'translateY(0)';
          categoryFilter.style.transform = 'translateY(0)';
        }

        lastScrollTop = scrollTop <= 0 ? 0 : scrollTop;
      }, 10);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (scrollTimeout) clearTimeout(scrollTimeout);
    };
  }, []);

  // Refresh feed when tab becomes visible (cross-device sync)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const feedAge = Date.now() - lastFetchTime;
        // Refresh if feed is older than 5 minutes
        if (feedAge > 5 * 60 * 1000) {
          console.log('Feed is stale - refreshing after', Math.round(feedAge / 1000), 'seconds');
          setArticles([]);
          setPage(1);
          setHasMore(true);
          fetchArticles(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [lastFetchTime]);

  // Track article impressions - batch send every 3 seconds
  useEffect(() => {
    if (pendingImpressions.size === 0) return;
    
    // Don't track impressions for logged-out users
    if (!isAuthenticated || !user?.id) return;

    const timer = setTimeout(async () => {
      const articleIds = Array.from(pendingImpressions);
      setPendingImpressions(new Set());

      try {
        await fetch(`${API_BASE_URL}/api/impressions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            articleIds,
            userId: user.id
          })
        });
      } catch (err) {
        console.error('Failed to track impressions:', err);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [pendingImpressions, user?.id, isAuthenticated]);

  // Intersection Observer to detect article visibility
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            const articleId = parseInt(entry.target.getAttribute('data-article-id') || '0');
            if (articleId && !seenArticles.has(articleId)) {
              // Mark as seen
              setSeenArticles(prev => new Set(prev).add(articleId));
              // Queue for batch tracking
              setPendingImpressions(prev => new Set(prev).add(articleId));
            }
          }
        });
      },
      { threshold: 0.5, rootMargin: '0px' } // Trigger when 50% visible
    );

    // Observe all article cards
    document.querySelectorAll('[data-article-id]').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [articles, seenArticles]);

  const fetchArticles = async (reset: boolean = false) => {
    setLoading(true);
    setError(null);
    
    try {
      // Special handling for "saved" category
      if (category === 'saved') {
        if (!isAuthenticated || !user) {
          setError('Please sign in to view saved articles');
          setArticles([]);
          setLoading(false);
          return;
        }
        
        const params = new URLSearchParams({
          userId: user.id.toString(),
          limit: '100',
          _t: Date.now().toString()
        });
        
        const response = await fetch(`${API_BASE_URL}/api/saved?${params}`, {
          cache: 'no-store'
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch saved articles');
        }
        
        const data: FeedResponse = await response.json();
        setArticles(data.articles);
        setHasMore(false); // Saved articles don't paginate
        setLoading(false);
        return;
      }
      
      // Normal feed fetch
      const params = new URLSearchParams({
        limit: '30',
        userId: user?.id.toString() || '0', // Use logged-in user ID or 0 for logged-out (diverse feed)
        _t: Date.now().toString() // Cache buster
      });
      
      if (category) {
        params.append('category', category);
      }

      const response = await fetch(`${API_BASE_URL}/api/feed?${params}`, {
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch articles');
      }

      // Log algorithm info from response headers
      const algorithm = response.headers.get('x-algorithm');
      const apiUserId = response.headers.get('x-user-id');
      const voteCount = response.headers.get('x-vote-count');
      console.log(`🔍 Feed API Response - Algorithm: ${algorithm}, UserId: ${apiUserId}, VoteCount: ${voteCount}`);

      const data: FeedResponse = await response.json();
      
      // Log first few article scores
      if (data.articles.length > 0) {
        const scores = data.articles.slice(0, 5).map(a => a.score?.toFixed(1));
        console.log(`📊 Article scores:`, scores);
      }
      
      if (reset) {
        setArticles(data.articles);
      } else {
        setArticles(prev => [...prev, ...data.articles]);
      }
      
      // If we got fewer articles than requested, we've reached the end
      setHasMore(data.articles.length >= 30);
      
      // Update last fetch time for staleness checking
      setLastFetchTime(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error('Error fetching articles:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadMoreArticles = async () => {
    if (loadingMore || !hasMore || category === 'saved') return;
    
    setLoadingMore(true);
    const nextPage = page + 1;
    
    try {
      const params = new URLSearchParams({
        limit: '20',
        userId: user?.id.toString() || '0',
        offset: String(articles.length),
        _t: Date.now().toString() // Cache buster
      });
      
      if (category) {
        params.append('category', category);
      }

      const response = await fetch(`${API_BASE_URL}/api/feed?${params}`, {
        cache: 'no-store'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch more articles');
      }

      const data: FeedResponse = await response.json();
      
      if (data.articles.length > 0) {
        setArticles(prev => [...prev, ...data.articles]);
        setPage(nextPage);
      }
      
      // If we got fewer articles than requested, we've reached the end
      setHasMore(data.articles.length >= 20);
    } catch (err) {
      console.error('Error loading more articles:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleVote = async (articleId: number, vote: number) => {
    // If not authenticated, show login modal
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    try {
      // Update vote status in UI
      setArticles(prevArticles =>
        prevArticles.map(article =>
          article.id === articleId
            ? { ...article, userVote: vote }
            : article
        )
      );
      
      // If downvote, remove from UI after 2 seconds (to show sad rooster animation)
      if (vote === -1) {
        setTimeout(() => {
          setArticles(prevArticles => prevArticles.filter(article => article.id !== articleId));
        }, 2000);
      }

      // Send vote to backend
      const response = await fetch(`${API_BASE_URL}/api/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          articleId,
          vote,
          userId: user?.id || 0
        })
      });

      if (!response.ok) {
        throw new Error('Failed to vote');
      }
    } catch (err) {
      console.error('Error voting:', err);
      // On error, revert the optimistic update
      if (vote === -1) {
        // Could optionally re-fetch the article
        console.error('Failed to remove article:', articleId);
      }
      throw err;
    }
  };

  const handleArticleRemoved = (articleId: number) => {
    // Remove article from state immediately (for saved view when unsaving)
    setArticles(prevArticles => prevArticles.filter(article => article.id !== articleId));
  };

  const handleCategoryChange = (slug: string | null) => {
    setCategory(slug);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setPage(1);
    setArticles([]);
    setHasMore(true);
    fetchArticles(true).finally(() => setRefreshing(false));
  };

  const handleCelebrationClose = () => {
    console.log('ArticleList: Closing celebration modal and refreshing feed');
    setShowCelebration(false);
    // Refresh feed to show new Personalized algorithm
    handleRefresh();
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
    <>
      <AuthModal 
        isOpen={showAuthModal} 
        onClose={() => setShowAuthModal(false)}
        onSuccess={() => {
          setShowAuthModal(false);
          fetchArticles(true);
        }}
      />

      <CelebrationModal
        isOpen={showCelebration}
        onClose={handleCelebrationClose}
      />
      
      <div className="max-w-5xl mx-auto">
        <div id="category-filter" className="sticky-top-nav bg-white z-40 px-4 transition-transform duration-300 ease-in-out">
          <CategoryFilter onCategoryChange={handleCategoryChange} activeCategory={category} />
        </div>

      <div className="px-4 py-4">

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
                isAuthenticated={isAuthenticated}
                userId={user?.id || 0}
                isSavedView={category === 'saved'}
                onArticleRemoved={handleArticleRemoved}
              />
            ))}
          </div>
        )}

        {loadingMore && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="text-gray-600 mt-2">Loading more articles...</p>
          </div>
        )}

        {!hasMore && articles.length > 0 && (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm font-medium mb-2">You've reached the end!</p>
            <p className="text-xs">
              💡 Tip: Use <kbd className="px-2 py-1 bg-gray-100 rounded">←</kbd> and{' '}
              <kbd className="px-2 py-1 bg-gray-100 rounded">→</kbd> to vote, or swipe articles left/right on mobile
            </p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
