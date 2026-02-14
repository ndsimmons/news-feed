import { useAuth } from '../lib/auth';
import UserMenu from './UserMenu';
import { useState, useEffect } from 'react';

export default function HeaderNav() {
  const { user, isAuthenticated, logout } = useAuth();
  const [hasAuthenticatedBefore, setHasAuthenticatedBefore] = useState(false);

  useEffect(() => {
    // Check if user has authenticated before by checking localStorage
    const hasToken = !!localStorage.getItem('auth_token');
    const hasAuthHistory = localStorage.getItem('has_authenticated') === 'true';
    
    if (hasToken || hasAuthHistory) {
      setHasAuthenticatedBefore(true);
    }
    
    // Set flag when user authenticates
    if (isAuthenticated) {
      localStorage.setItem('has_authenticated', 'true');
      setHasAuthenticatedBefore(true);
    }
  }, [isAuthenticated]);

  const handleOpenAuth = () => {
    window.dispatchEvent(new CustomEvent('open-auth-modal'));
  };

  const buttonText = hasAuthenticatedBefore ? 'Sign in' : 'Personalize';

  return (
    <nav className="flex items-center gap-6">
      {isAuthenticated && user ? (
        <UserMenu email={user.email} onLogout={logout} />
      ) : (
        <button 
          onClick={handleOpenAuth}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          {buttonText}
        </button>
      )}
    </nav>
  );
}
