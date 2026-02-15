import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../lib/config';

interface DiscoveryModeBadgeProps {
  userId: number;
}

export default function DiscoveryModeBadge({ userId }: DiscoveryModeBadgeProps) {
  const [voteCount, setVoteCount] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    // Fetch user's vote count
    const fetchVoteCount = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/user/stats?userId=${userId}`);
        if (response.ok) {
          const data = await response.json();
          setVoteCount(data.voteCount || 0);
        }
      } catch (error) {
        console.error('Error fetching vote count:', error);
      }
    };

    fetchVoteCount();

    // Update vote count when user votes
    const handleVoteUpdate = () => {
      setVoteCount(prev => prev !== null ? prev + 1 : 1);
    };

    window.addEventListener('vote-cast', handleVoteUpdate);
    return () => window.removeEventListener('vote-cast', handleVoteUpdate);
  }, [userId]);

  // Don't show if user has 10+ votes (graduated from onboarding)
  if (voteCount === null || voteCount >= 10) {
    return null;
  }

  const progress = (voteCount / 10) * 100;

  return (
    <div 
      className="relative"
      onMouseEnter={() => setShowModal(true)}
      onMouseLeave={() => setShowModal(false)}
    >
      {/* Badge */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-full text-sm font-medium shadow-md cursor-help">
        <svg 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 16v-4"></path>
          <path d="M12 8h.01"></path>
        </svg>
        <span>Discovery Mode</span>
        <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold">
          {voteCount}/10
        </span>
      </div>

      {/* Hover Modal - hidden on mobile (shown as inline card in feed instead) */}
      {showModal && (
        <div className="hidden md:block absolute top-full left-0 mt-2 w-80 bg-white rounded-lg shadow-2xl border border-gray-200 p-4 z-50">
          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-gray-600">Progress</span>
              <span className="text-xs font-bold text-purple-600">{voteCount}/10</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>

          <h3 className="text-sm font-bold text-gray-900 mb-2">
            Interact with 10 articles to unlock your personalized feed!
          </h3>
          
          <div className="space-y-2 text-xs text-gray-600">
            <div>
              <span className="font-semibold text-purple-600">Discovery Mode:</span> Shows balanced content across all topics to help you find your interests.
            </div>
            <div>
              <span className="font-semibold text-blue-600">Personalized Feed:</span> Unlocked at 10 interactions. Shows you the best news based on your demonstrated interests.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline discovery mode card shown as the first item in the feed on mobile.
 * Replaces the hover modal which gets cut off on small screens.
 */
export function DiscoveryModeCard({ userId }: DiscoveryModeBadgeProps) {
  const [voteCount, setVoteCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchVoteCount = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/user/stats?userId=${userId}`);
        if (response.ok) {
          const data = await response.json();
          setVoteCount(data.voteCount || 0);
        }
      } catch (error) {
        console.error('Error fetching vote count:', error);
      }
    };

    fetchVoteCount();

    const handleVoteUpdate = () => {
      setVoteCount(prev => prev !== null ? prev + 1 : 1);
    };

    window.addEventListener('vote-cast', handleVoteUpdate);
    return () => window.removeEventListener('vote-cast', handleVoteUpdate);
  }, [userId]);

  if (voteCount === null || voteCount >= 10) {
    return null;
  }

  const progress = (voteCount / 10) * 100;

  return (
    <div className="md:hidden border-b border-gray-300 py-4">
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-full text-sm font-medium">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 16v-4"></path>
              <path d="M12 8h.01"></path>
            </svg>
            <span>Discovery Mode</span>
          </div>
          <span className="text-sm font-bold text-purple-600">{voteCount}/10</span>
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="w-full bg-white/60 rounded-full h-2.5">
            <div 
              className="bg-gradient-to-r from-purple-500 to-blue-500 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        <p className="text-sm font-semibold text-gray-900 mb-1">
          Interact with 10 articles to unlock your personalized feed!
        </p>
        <p className="text-xs text-gray-600">
          Swipe right to like, left to dislike. Your feed will adapt to your interests.
        </p>
      </div>
    </div>
  );
}
