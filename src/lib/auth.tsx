import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { API_BASE_URL } from './config';

interface User {
  id: number;
  email: string;
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
    // Check if user is already logged in (token in localStorage)
    const token = localStorage.getItem('auth_token');
    if (token) {
      validateSession(token);
    } else {
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

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const validateSession = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/validate-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.valid) {
          setUser(data.user);
          // Session is still valid and has been refreshed on the backend
        } else {
          setUser(null);
          localStorage.removeItem('auth_token');
        }
      } else {
        setUser(null);
        localStorage.removeItem('auth_token');
      }
    } catch (error) {
      console.error('Error validating session:', error);
      setUser(null);
      localStorage.removeItem('auth_token');
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
        setUser(data.user);
        localStorage.setItem('auth_token', data.token);
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
    await verifyMagicLink(token);
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('auth_token');
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
