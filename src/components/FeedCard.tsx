import { useState, useEffect } from 'react';
import type { Article } from '../lib/types';

interface FeedCardProps {
  article: Article;
  onVote: (articleId: number, vote: number) => Promise<void>;
}

export default function FeedCard({ article, onVote }: FeedCardProps) {
  const [isVoting, setIsVoting] = useState(false);
  const [userVote, setUserVote] = useState<number>(article.userVote || 0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleVote = async (vote: number) => {
    if (isVoting) return;
    
    setIsVoting(true);
    try {
      await onVote(article.id, vote);
      setUserVote(vote);
    } catch (error) {
      console.error('Error voting:', error);
    } finally {
      setIsVoting(false);
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [article.id]);

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
      
      // Trigger vote based on swipe distance
      if (Math.abs(swipeOffset) > 100) {
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
    transform: `translateX(${swipeOffset}px) rotate(${swipeOffset * 0.02}deg)`,
    opacity: isDragging ? 0.9 : 1,
    transition: isDragging ? 'none' : 'transform 0.3s ease, opacity 0.2s ease'
  };

  const getSwipeIndicator = () => {
    if (Math.abs(swipeOffset) < 50) return null;
    
    if (swipeOffset > 0) {
      return (
        <div className="absolute top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg font-bold text-lg">
          ✓ UPVOTE
        </div>
      );
    } else {
      return (
        <div className="absolute top-4 left-4 bg-red-500 text-white px-4 py-2 rounded-lg font-bold text-lg">
          ✗ DOWNVOTE
        </div>
      );
    }
  };

  return (
    <article 
      className="article-card relative select-none cursor-grab active:cursor-grabbing"
      style={cardStyle}
      onMouseDown={handleMouseDown}
    >
      {getSwipeIndicator()}
      
      <div className="flex gap-4">
        {article.image_url && (
          <div className="flex-shrink-0 w-24 h-24">
            <img 
              src={article.image_url} 
              alt={article.title}
              className="w-full h-full object-cover rounded"
            />
          </div>
        )}
        
        <div className="flex-1 min-w-0">
          <h3 className="article-title">
            <a 
              href={article.url} 
              target="_blank" 
              rel="noopener noreferrer"
              onClick={(e) => isDragging && e.preventDefault()}
            >
              {article.title}
            </a>
          </h3>
          
          <div className="flex items-center gap-2 mb-2">
            <span className="article-source">
              {article.source?.name || 'Unknown Source'}
            </span>
            <span className="text-gray-400">•</span>
            <span className="text-xs text-gray-500">
              {article.category?.name || 'Uncategorized'}
            </span>
          </div>
          
          {article.summary && (
            <p className="article-summary line-clamp-2">
              {article.summary}
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
            
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleVote(1);
                }}
                disabled={isVoting}
                className={`vote-button upvote ${userVote === 1 ? 'voted ring-green-500' : ''}`}
              >
                👍 Upvote
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleVote(-1);
                }}
                disabled={isVoting}
                className={`vote-button downvote ${userVote === -1 ? 'voted ring-red-500' : ''}`}
              >
                👎 Downvote
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
