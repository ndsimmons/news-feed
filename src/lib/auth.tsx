import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE_URL } from './config';

interface User {
  id: number;
  email: string;
  displayName?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Test localStorage availability
    try {
      localStorage.setItem('test', '1');
      const test = localStorage.getItem('test');
      localStorage.removeItem('test');
      console.log('Auth: localStorage is available:', test === '1' ? 'YES' : 'NO');
    } catch (e) {
      console.error('Auth: localStorage test failed:', e);
    }
    
    // Check if user is already logged in (token in localStorage)
    const token = localStorage.getItem('auth_token');
    console.log('Auth: Checking for existing token:', token ? 'Found' : 'Not found');
    if (token) {
      validateSession(token);
    } else {
      console.log('Auth: No token found, user logged out');
      setUser(null); // Ensure user is cleared if no token
      setLoading(false);
    }

    // Check for magic link token in URL (e.g., /?token=...&session=...)
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    const sessionIdFromUrl = urlParams.get('session');
    if (tokenFromUrl) {
      verifyMagicLink(tokenFromUrl, sessionIdFromUrl || undefined);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Watch for localStorage changes (e.g., token removal in another tab or via console)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth_token') {
        if (!e.newValue) {
          // Token was removed
          setUser(null);
        } else if (e.newValue !== e.oldValue) {
          // Token was changed, validate it
          validateSession(e.newValue);
        }
      }
    };

    // Validate session when user returns to the tab (e.g., after leaving it open overnight)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // User returned to the tab - validate session if they're logged in
        const currentToken = localStorage.getItem('auth_token');
        if (currentToken && user) {
          console.log('Tab became visible - validating session');
          validateSession(currentToken);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user]);

  const validateSession = async (token: string) => {
    console.log('Auth: Validating session...');
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/validate-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.valid) {
          console.log('Auth: Session valid, user:', data.user);
          setUser(data.user);
          // Session is still valid and has been refreshed on the backend
        } else {
          console.log('Auth: Session invalid');
          setUser(null);
          localStorage.removeItem('auth_token');
        }
      } else {
        console.log('Auth: Session validation failed with status:', response.status);
        setUser(null);
        localStorage.removeItem('auth_token');
      }
    } catch (error) {
      console.error('Error validating session:', error);
      // Don't immediately log out on network errors - keep trying
      console.log('Auth: Network error during validation, will retry on next interaction');
      setLoading(false);
      // Keep user logged in optimistically
      return;
    } finally {
      setLoading(false);
    }
  };

  const verifyMagicLink = async (token: string, sessionId?: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, sessionId })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Auth: Magic link verified, storing token');
        setUser(data.user);
        try {
          localStorage.setItem('auth_token', data.token);
          const verification = localStorage.getItem('auth_token');
          console.log('Auth: Token stored via magic link:', verification ? 'SUCCESS' : 'FAILED');
        } catch (e) {
          console.error('Auth: Failed to store token:', e);
        }
      } else {
        setUser(null);
        localStorage.removeItem('auth_token');
      }
    } catch (error) {
      console.error('Error verifying magic link:', error);
      setUser(null);
      localStorage.removeItem('auth_token');
    } finally {
      setLoading(false);
    }
  };

  const login = async (token: string) => {
    // For direct session tokens (like test login), just validate
    // For magic link tokens, verify them first
    await validateSession(token);
  };

  const logout = () => {
    console.log('Logging out - clearing auth state');
    setUser(null);
    localStorage.removeItem('auth_token');
    // Feed will auto-refresh via ArticleList's isAuthenticated useEffect
  };

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        loading, 
        login, 
        logout, 
        isAuthenticated: !!user 
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
