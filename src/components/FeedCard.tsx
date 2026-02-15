import { useState, useEffect, useRef } from 'react';
import type { Article } from '../lib/types';
import { API_BASE_URL } from '../lib/config';

// Decode HTML entities in text
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

interface FeedCardProps {
  article: Article;
  onVote: (articleId: number, vote: number) => Promise<void>;
  isAuthenticated?: boolean;
  userId?: number;
  isSavedView?: boolean;
  onArticleRemoved?: (articleId: number) => void;
}

export default function FeedCard({ article, onVote, isAuthenticated = false, userId = 0, isSavedView = false, onArticleRemoved }: FeedCardProps) {
  const [isVoting, setIsVoting] = useState(false);
  const [userVote, setUserVote] = useState<number>(article.userVote || 0);
  
  // Sync vote state when article prop updates (e.g., after feed re-fetch)
  useEffect(() => {
    if (article.userVote !== undefined) {
      setUserVote(article.userVote);
    }
  }, [article.userVote]);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showVoteFeedback, setShowVoteFeedback] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'upvote' | 'downvote' | null>(null);
  const [stopBouncing, setStopBouncing] = useState(false);
  const [isSaved, setIsSaved] = useState(isSavedView); // If in saved view, article is already saved
  const [isSaving, setIsSaving] = useState(false);
  // Show raw score directly for transparent ranking
  const [currentScore, setCurrentScore] = useState<number | undefined>(article.score);
  const [scoreUpdating, setScoreUpdating] = useState(false);

  const cardRef = useRef<HTMLElement>(null);

  // Debug: Log if we're missing score
  useEffect(() => {
    if (article.score === undefined) {
      console.error(`⚠️ Article ${article.id} has no score!`);
    }
  }, []);


  
  // Debug log on mount
  useEffect(() => {
    console.log(`FeedCard mounted - Article ${article.id}, isAuthenticated: ${isAuthenticated}, userId: ${userId}`);
  }, []);

  // Recalculate score after interaction
  const recalculateScore = async () => {
    // Double-check auth state to prevent Safari privacy mode issues
    const hasToken = !!localStorage.getItem('auth_token');
    const isActuallyAuthenticated = isAuthenticated || hasToken;
    if (!isActuallyAuthenticated || !userId) return;
    
    setScoreUpdating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/recalculate-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, articleId: article.id })
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentScore(data.score);
        
        // Remove highlight after 2 seconds
        setTimeout(() => setScoreUpdating(false), 2000);
      }
    } catch (error) {
      console.error('Error recalculating score:', error);
      setScoreUpdating(false);
    }
  };

  const handleArticleClick = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      return;
    }
    
    // Article clicks work for all users (no auth required to read articles)
  };

  const handleVote = async (vote: number) => {
    if (isVoting) return;
    
    // Double-check auth state to prevent Safari privacy mode issues
    const hasToken = !!localStorage.getItem('auth_token');
    const isActuallyAuthenticated = isAuthenticated || hasToken;
    
    // If not authenticated, store first interaction and show auth modal
    if (!isActuallyAuthenticated) {
      console.log('FeedCard: User not authenticated, storing first interaction and showing auth modal');
      localStorage.setItem('first_interaction', JSON.stringify({
        type: vote === 1 ? 'upvote' : 'downvote',
        articleId: article.id,
        articleTitle: article.title,
        categoryId: article.category_id,
        sourceId: article.source_id,
        timestamp: Date.now()
      }));
      
      window.dispatchEvent(new CustomEvent('open-auth-modal', { 
        detail: { firstInteraction: true }
      }));
      return;
    }
    
    console.log('FeedCard: User authenticated, processing vote normally');
    
    // If swiping opposite direction of current vote, unvote (set to 0)
    if (userVote !== 0 && userVote !== vote) {
      vote = 0;
      setShowVoteFeedback(false);
    }
    
    setIsVoting(true);
    
    // Only show feedback animation for actual votes (not unvotes)
    if (vote !== 0) {
      setFeedbackType(vote === 1 ? 'upvote' : 'downvote');
      setShowVoteFeedback(true);
      setStopBouncing(false);
    }
    
    try {
      await onVote(article.id, vote);
      setUserVote(vote);
      
      // Notify DiscoveryModeBadge about vote (only for new votes, not unvotes)
      if (vote !== 0 && userVote === 0) {
        window.dispatchEvent(new CustomEvent('vote-cast'));
      }
      
      // Recalculate score after vote
      if (vote !== 0) {
        recalculateScore();
      }
      
      if (vote !== 0) {
        // Stop bouncing after 1.5 seconds (about 3 bounces)
        setTimeout(() => setStopBouncing(true), 1500);
        
        // For downvote, hide rooster after 1 second (ArticleList will remove it)
        if (vote === -1) {
          setTimeout(() => setShowVoteFeedback(false), 1000);
        }
        // For upvote, keep rooster visible forever (don't hide it)
      }
    } catch (error) {
      console.error('Error voting:', error);
      setShowVoteFeedback(false);
    } finally {
      setIsVoting(false);
    }
  };

  const handleSaveToggle = async () => {
    if (isSaving) return;
    
    // Double-check auth state to prevent Safari privacy mode issues
    const hasToken = !!localStorage.getItem('auth_token');
    const isActuallyAuthenticated = isAuthenticated || hasToken;
    
    // If not authenticated, store first interaction and show auth modal
    if (!isActuallyAuthenticated) {
      console.log('FeedCard: User not authenticated, storing first interaction and showing auth modal');
      localStorage.setItem('first_interaction', JSON.stringify({
        type: 'save',
        articleId: article.id,
        articleTitle: article.title,
        categoryId: article.category_id,
        sourceId: article.source_id,
        timestamp: Date.now()
      }));
      
      window.dispatchEvent(new CustomEvent('open-auth-modal', { 
        detail: { firstInteraction: true }
      }));
      return;
    }
    
    console.log('FeedCard: User authenticated, processing save/unsave normally');
    
    setIsSaving(true);
    
    try {
      const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'https://news-feed-api.nsimmons.workers.dev';
      
      if (isSaved) {
        // Unsave
        const response = await fetch(`${API_BASE_URL}/api/saved/${article.id}?userId=${userId}`, {
          method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Failed to unsave');
        setIsSaved(false);
        
        // If in saved view, notify parent to remove article from list
        if (isSavedView && onArticleRemoved) {
          onArticleRemoved(article.id);
        }
      } else {
        // Save
        const response = await fetch(`${API_BASE_URL}/api/saved`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId: article.id, userId })
        });
        
        if (!response.ok) throw new Error('Failed to save');
        setIsSaved(true);
        
        // Saves count as likes for the algorithm (inserted into votes table)
        // so notify the vote counter to keep it in sync
        if (userVote === 0) {
          window.dispatchEvent(new CustomEvent('vote-cast'));
        }
        
        // Recalculate score after save (saves count as likes)
        recalculateScore();
      }
    } catch (error) {
      console.error('Error toggling save:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        handleVote(1);
      } else if (e.key === 'ArrowLeft') {
        handleVote(-1);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [article.id]);

  // Cleanup swipe state on unmount or vote completion
  useEffect(() => {
    return () => {
      setSwipeOffset(0);
      setIsDragging(false);
    };
  }, []);

  // Reset stuck swipe state when returning to tab (fixes right-click issue)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Reset any stuck swipe state when tab becomes visible
        setSwipeOffset(0);
        setIsDragging(false);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // Mouse drag handling
  const handleMouseDown = (e: React.MouseEvent) => {
    // Ignore right-click (context menu)
    if (e.button !== 0) return;
    
    setIsDragging(true);
    const startX = e.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const offset = moveEvent.clientX - startX;
      setSwipeOffset(offset);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      
      // More responsive: reduced threshold from 100 to 60
      if (Math.abs(swipeOffset) > 60) {
        if (isSavedView && swipeOffset < 0) {
          // In saved view, swipe left = unsave
          handleSaveToggle();
        } else if (swipeOffset > 0) {
          handleVote(1); // Swipe right = upvote
        } else {
          handleVote(-1); // Swipe left = downvote
        }
      }
      
      setSwipeOffset(0);
      cleanup();
    };

    const handleContextMenu = () => {
      // Reset state if context menu is opened
      setIsDragging(false);
      setSwipeOffset(0);
      cleanup();
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);
  };

  // Attach touch listener with { passive: false } for Safari compatibility
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleTouchStart = (e: TouchEvent) => {
    // Don't interfere if already showing vote feedback
    if (showVoteFeedback || isVoting) return;
    
    const startX = e.touches[0].clientX;
    const startY = e.touches[0].clientY;
    let isHorizontalSwipe = false;
    let hasMoved = false;
    let currentOffset = 0;

    const handleTouchMove = (moveEvent: TouchEvent) => {
      if (!moveEvent.touches[0]) return;
      
      const currentX = moveEvent.touches[0].clientX;
      const currentY = moveEvent.touches[0].clientY;
      
      const deltaX = currentX - startX;
      const deltaY = currentY - startY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      
      // Determine swipe direction on first significant movement
      if (!hasMoved && (absDeltaX > 10 || absDeltaY > 10)) {
        hasMoved = true;
        isHorizontalSwipe = absDeltaX > absDeltaY * 1.5; // More tolerant of horizontal
      }
      
      // If horizontal swipe, prevent scroll and track offset
      if (isHorizontalSwipe) {
        moveEvent.preventDefault();
        setIsDragging(true);
        currentOffset = deltaX;
        setSwipeOffset(deltaX);
      }
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      
      // Very sensitive threshold like Signal (just 50px)
      if (isHorizontalSwipe && Math.abs(currentOffset) > 50) {
        if (isSavedView && currentOffset < 0) {
          // In saved view, swipe left = unsave
          handleSaveToggle();
        } else if (currentOffset > 0) {
          handleVote(1); // Swipe right = upvote
        } else {
          handleVote(-1); // Swipe left = downvote
        }
      }
      
      setSwipeOffset(0);
      cleanup();
    };

    const handleTouchCancel = () => {
      setIsDragging(false);
      setSwipeOffset(0);
      cleanup();
    };

    const cleanup = () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);
    };

      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      document.addEventListener('touchcancel', handleTouchCancel);
    };

    card.addEventListener('touchstart', handleTouchStart, { passive: false });

    return () => {
      card.removeEventListener('touchstart', handleTouchStart);
    };
  }, [showVoteFeedback, isVoting]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    
    if (diffHours < 1) {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      return `${diffMins}m ago`;
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else {
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    }
  };

  const cardStyle = {
    transform: `translateX(${swipeOffset}px)`,
    opacity: isDragging ? 0.95 : 1,
    transition: isDragging ? 'none' : 'transform 0.3s ease, opacity 0.2s ease'
  };

  // Background layer with swipe indicators (stays fixed while card moves)
  const getSwipeBackground = () => {
    if (Math.abs(swipeOffset) < 80) return null;
    
    const iconOpacity = Math.min(Math.abs(swipeOffset) / 150, 1);
    
    if (swipeOffset > 0) {
      // Swiping right - show happy rooster on the left side of background
      return (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-start px-6">
          <img 
            src="/happy-rooster.png" 
            alt="Upvote" 
            className="h-16 w-16 object-contain grayscale"
            style={{ opacity: iconOpacity }}
          />
        </div>
      );
    } else {
      // Swiping left
      if (isSavedView) {
        // In saved view, show trash icon on right side
        return (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-end px-6">
            <div className="bg-red-500 rounded-full p-3" style={{ opacity: iconOpacity }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </div>
          </div>
        );
      } else {
        // Normal view, show sad rooster on right side
        return (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-end px-6">
            <img 
              src="/sad-rooster.png" 
              alt="Downvote" 
              className="h-16 w-16 object-contain grayscale"
              style={{ opacity: iconOpacity }}
            />
          </div>
        );
      }
    }
  };

  return (
    <div className="relative overflow-hidden">
      {/* Background layer with swipe indicators - stays fixed */}
      {getSwipeBackground()}
      
      {/* Card layer - moves with swipe */}
      <article 
        ref={cardRef}
        className="article-card relative select-none cursor-grab active:cursor-grabbing bg-white"
        style={cardStyle}
        onMouseDown={handleMouseDown}
        data-article-id={article.id}
      >
      {/* X button for saved view */}
      {isSavedView && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleSaveToggle();
          }}
          className="absolute top-3 right-3 z-20 w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800 transition-colors"
          title="Remove from saved"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      )}
      <div className="flex gap-4 relative">
        <div className="flex-1 min-w-0 relative z-10">
          <h3 className="article-title">
            <a 
              href={article.spotify_url || (article.url?.includes('nytimes.com') ? `https://archive.is/newest/${article.url}` : article.url)} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={handleArticleClick}
            >
              {decodeHtmlEntities(article.title)}
            </a>
          </h3>
          
          <div className="flex items-center gap-2 mb-2">
            <span className="article-source">
              {article.source_name || 'Unknown Source'}
            </span>
            <span className="text-gray-400">•</span>
            <span className="text-xs text-gray-500">
              {article.category_name || 'Uncategorized'}
            </span>
          </div>
          
          {article.summary && (
            <p className="article-summary line-clamp-2">
              {decodeHtmlEntities(article.summary)}
            </p>
          )}
          
          <div className="flex items-center justify-between mt-3">
            <div className="article-meta">
              {article.published_at && formatDate(article.published_at)}
              {currentScore !== undefined && (
                <div className="relative inline-block ml-3">
                  <span 
                    className={`text-blue-600 transition-all duration-500 ${
                      scoreUpdating ? 'bg-blue-100 px-2 py-0.5 rounded' : ''
                    }`}

                  >
                    Score: {currentScore.toFixed(1)}
                  </span>
                  

                </div>
              )}
            </div>
            
              <div className="flex gap-2">
                {!isSavedView && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleVote(1);
                      }}
                      disabled={isVoting}
                      className={`vote-button upvote ${userVote === 1 ? 'voted' : ''}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={userVote === 1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleVote(-1);
                      }}
                      disabled={isVoting}
                      className={`vote-button downvote ${userVote === -1 ? 'voted' : ''}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={userVote === -1 ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSaveToggle();
                      }}
                      disabled={isSaving}
                      className={`vote-button save ${isSaved ? 'voted' : ''}`}
                      title={isSaved ? 'Unsave article' : 'Save for later'}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                      </svg>
                    </button>
                  </>
                )}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const shareData = { title: article.title, url: article.url };
                    if (navigator.share) {
                      try { await navigator.share(shareData); } catch {}
                    } else {
                      await navigator.clipboard.writeText(article.url);
                    }
                  }}
                  className="vote-button"
                  title="Share article"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 16v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"></path>
                    <polyline points="12 3 12 15"></polyline>
                    <polyline points="7 8 12 3 17 8"></polyline>
                  </svg>
                </button>
              </div>
          </div>
        </div>
      </div>
    </article>
    </div>
  );
}
