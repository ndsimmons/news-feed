import { useState } from 'react';
import { API_BASE_URL } from '../lib/config';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/send-magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });

      if (!response.ok) {
        throw new Error('Failed to send magic link');
      }

      const data = await response.json();
      setSessionId(data.sessionId);
      setSent(true);
      setPolling(true);
      
      // Start polling for authentication
      startPolling(data.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (sid: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/check-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid })
        });

        if (response.ok) {
          const data = await response.json();
          
          if (data.authenticated && data.token) {
            // Success! User logged in on another device
            clearInterval(pollInterval);
            setPolling(false);
            
            // Store token and show success state
            console.log('AuthModal: Attempting to store token:', data.token.substring(0, 20) + '...');
            try {
              localStorage.setItem('auth_token', data.token);
              const verification = localStorage.getItem('auth_token');
              console.log('AuthModal: Token stored and verified:', verification ? 'SUCCESS' : 'FAILED');
            } catch (e) {
              console.error('AuthModal: Failed to store token in localStorage:', e);
            }
            setLoginSuccess(true);
            
            // Check for first interaction and seed algorithm
            const firstInteraction = localStorage.getItem('first_interaction');
            if (firstInteraction) {
              try {
                const interaction = JSON.parse(firstInteraction);
                
                // Seed the algorithm with first interaction
                const seedResponse = await fetch(`${API_BASE_URL}/api/seed-algorithm`, {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${data.token}`
                  },
                  body: JSON.stringify({
                    userId: data.user.id,
                    interactionType: interaction.type,
                    articleId: interaction.articleId,
                    categoryId: interaction.categoryId,
                    sourceId: interaction.sourceId
                  })
                });
                
                if (seedResponse.ok) {
                  console.log('First interaction seeded successfully');
                  
                  // Dispatch event so ArticleList knows to refresh and show the interaction
                  window.dispatchEvent(new CustomEvent('first-interaction-applied', {
                    detail: {
                      articleId: interaction.articleId,
                      type: interaction.type
                    }
                  }));
                }
                
                // Clear first interaction after seeding
                localStorage.removeItem('first_interaction');
              } catch (err) {
                console.error('Error seeding algorithm:', err);
              }
            }
            
            // Auto-close after 2 seconds and trigger success
            setTimeout(() => {
              onSuccess();
              onClose();
            }, 2000);
          } else if (data.expired) {
            // Session expired
            clearInterval(pollInterval);
            setPolling(false);
            setError('Session expired. Please try again.');
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000); // Poll every 3 seconds

    // Stop polling after 5 minutes
    setTimeout(() => {
      clearInterval(pollInterval);
      setPolling(false);
    }, 5 * 60 * 1000);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {loginSuccess ? (
          <div className="text-center py-8">
            <div className="mb-6">
              <img 
                src="/rooster-logo.jpg" 
                alt="Nicofeed" 
                className="w-32 h-32 rounded-full object-cover mx-auto shadow-lg"
              />
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome back!
            </h2>
            <p className="text-gray-600 mb-4">
              You're all set. Redirecting...
            </p>
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Personalize Your Feed
              </h2>
              <p className="text-gray-600">
                Sign in to create your own personalized news feed based on what you like and dislike.
              </p>
            </div>

            {!sent ? (
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Sending...' : 'Send Magic Link'}
            </button>

            <p className="mt-4 text-xs text-gray-500 text-center">
              We'll send you a magic link to sign in. No password needed!
            </p>
          </form>
        ) : (
          <div className="text-center py-6">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              Check Your Email!
            </h3>
            <p className="text-gray-600 mb-4">
              We sent a magic link to <span className="font-medium">{email}</span>
            </p>
            <p className="text-sm text-gray-500 mb-4">
              Click the link in your email to sign in. It expires in 15 minutes.
            </p>
            
            {polling && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <p className="text-sm text-blue-700 font-medium">
                    Waiting for you to click the link...
                  </p>
                </div>
                <p className="text-xs text-blue-600 mt-1">
                  You can open the link on another device - this page will auto-update
                </p>
              </div>
            )}
            
            <button
              onClick={() => {
                setSent(false);
                setEmail('');
                setPolling(false);
              }}
              className="mt-2 text-blue-600 hover:text-blue-700 text-sm font-medium"
            >
              Try a different email
            </button>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
