import { useState, useEffect, useRef } from 'react';
import type { Article } from '../lib/types';

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
}

export default function FeedCard({ article, onVote, isAuthenticated = false, userId = 0 }: FeedCardProps) {
  const [isVoting, setIsVoting] = useState(false);
  const [userVote, setUserVote] = useState<number>(article.userVote || 0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showVoteFeedback, setShowVoteFeedback] = useState(false);
  const [feedbackType, setFeedbackType] = useState<'upvote' | 'downvote' | null>(null);
  const [stopBouncing, setStopBouncing] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  const handleVote = async (vote: number) => {
    if (isVoting) return;
    
    // If not authenticated, don't show animation - onVote will show auth modal
    if (!isAuthenticated) {
      await onVote(article.id, vote);
      return;
    }
    
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
      
      if (vote !== 0) {
        // Stop bouncing after 1.5 seconds (about 3 bounces)
        setTimeout(() => setStopBouncing(true), 1500);
        
        // For downvote, hide rooster after 2 seconds (ArticleList will remove it)
        if (vote === -1) {
          setTimeout(() => setShowVoteFeedback(false), 2000);
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
    
    // If not authenticated, show auth modal
    if (!isAuthenticated) {
      // Trigger auth modal via event
      window.dispatchEvent(new CustomEvent('open-auth-modal'));
      return;
    }
    
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
      } else {
        // Save
        const response = await fetch(`${API_BASE_URL}/api/saved`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ articleId: article.id, userId })
        });
        
        if (!response.ok) throw new Error('Failed to save');
        setIsSaved(true);
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

  // Mouse drag handling
  const handleMouseDown = (e: React.MouseEvent) => {
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
        if (swipeOffset > 0) {
          handleVote(1); // Swipe right = upvote
        } else {
          handleVote(-1); // Swipe left = downvote
        }
      }
      
      setSwipeOffset(0);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
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
        if (currentOffset > 0) {
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

  const getSwipeIndicator = () => {
    if (Math.abs(swipeOffset) < 30) return null;
    
    const iconOpacity = Math.min(Math.abs(swipeOffset) / 100, 1);
    
    if (swipeOffset > 0) {
      // Swiping right - show happy rooster in the LEFT margin within the card bounds
      return (
        <div 
          className="absolute left-6 top-1/2 -translate-y-1/2 z-0 pointer-events-none"
          style={{ opacity: iconOpacity }}
        >
          <img 
            src="/happy-rooster.png" 
            alt="Upvote" 
            className="h-12 w-12 object-contain"
          />
        </div>
      );
    } else {
      // Swiping left - show sad rooster in the RIGHT margin within the card bounds
      return (
        <div 
          className="absolute right-6 top-1/2 -translate-y-1/2 z-0 pointer-events-none"
          style={{ opacity: iconOpacity }}
        >
          <img 
            src="/sad-rooster.png" 
            alt="Downvote" 
            className="h-12 w-12 object-contain"
          />
        </div>
      );
    }
  };

  return (
    <>
      <article 
        ref={cardRef}
        className="article-card relative select-none cursor-grab active:cursor-grabbing"
        style={cardStyle}
        onMouseDown={handleMouseDown}
        data-article-id={article.id}
      >
        {getSwipeIndicator()}
      
      <div className="flex gap-4 relative">
        <div className="flex-1 min-w-0 relative z-10">
          <h3 className="article-title">
            <a 
              href={article.url} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={(e) => isDragging && e.preventDefault()}
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
              {article.score !== undefined && (
                <span className="ml-3 text-blue-600">
                  Score: {article.score.toFixed(1)}
                </span>
              )}
            </div>
            
            {!showVoteFeedback && userVote !== 1 && (
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleVote(1);
                  }}
                  disabled={isVoting || !isAuthenticated}
                  className={`vote-button upvote ${userVote === 1 ? 'voted' : ''} ${!isAuthenticated ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleVote(-1);
                  }}
                  disabled={isVoting || !isAuthenticated}
                  className={`vote-button downvote ${userVote === -1 ? 'voted' : ''} ${!isAuthenticated ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"></path>
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSaveToggle();
                  }}
                  disabled={isSaving}
                  className={`vote-button save ${isSaved ? 'voted' : ''} ${!isAuthenticated ? 'opacity-50' : ''}`}
                  title={isSaved ? 'Unsave article' : 'Save for later'}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={isSaved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
                  </svg>
                </button>
              </div>
            )}
            
            {(showVoteFeedback && feedbackType === 'upvote') || userVote === 1 ? (
              <div className="flex items-center justify-center" style={{ width: '120px' }}>
                <img 
                  src="/happy-rooster.png" 
                  alt="Upvoted!" 
                  className="h-20 object-contain" 
                />
              </div>
            ) : null}
            
            {showVoteFeedback && feedbackType === 'downvote' && (
              <div className="flex items-center justify-center" style={{ width: '120px' }}>
                <img src="/sad-rooster.png" alt="Downvoted" className="h-20 object-contain" />
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
    </>
  );
}
