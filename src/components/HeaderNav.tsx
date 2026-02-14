import { useAuth } from '../lib/auth';
import UserMenu from './UserMenu';
import DiscoveryModeBadge from './DiscoveryModeBadge';
import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../lib/config';

export default function HeaderNav() {
  const { user, isAuthenticated, logout, login } = useAuth();
  const [hasAuthenticatedBefore, setHasAuthenticatedBefore] = useState(false);
  const [showTestLogin, setShowTestLogin] = useState(false);
  const [testLoginStatus, setTestLoginStatus] = useState('');

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

  // Check if we should show test login button (dev mode - check for localhost or specific param)
  useEffect(() => {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const hasTestParam = window.location.search.includes('test=true');
    const shouldShow = isLocalhost || hasTestParam;
    console.log('HeaderNav: Check test login visibility - isLocalhost:', isLocalhost, 'hasTestParam:', hasTestParam, 'shouldShow:', shouldShow);
    setShowTestLogin(shouldShow);
  }, []);

  const handleTestLogin = async () => {
    setTestLoginStatus('Clicked!');
    console.log('HeaderNav: Test Login button clicked!');
    
    try {
      setTestLoginStatus('Calling API...');
      console.log('HeaderNav: Calling test login API...');
      
      const response = await fetch(`${API_BASE_URL}/api/test-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      setTestLoginStatus(`API response: ${response.status}`);
      console.log('HeaderNav: Test login API response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        setTestLoginStatus('Parsing response...');
        console.log('HeaderNav: Test login successful, token received:', data.token.substring(0, 10) + '...');
        
        // Clear any pending first interaction from localStorage
        localStorage.removeItem('first_interaction');
        
        // Set auth token and login
        localStorage.setItem('auth_token', data.token);
        console.log('HeaderNav: Token stored in localStorage');
        console.log('HeaderNav: Verify token in localStorage:', localStorage.getItem('auth_token') ? 'EXISTS' : 'MISSING');
        
        setTestLoginStatus('Logging in...');
        await login(data.token);
        console.log('HeaderNav: login() called, auth state should update automatically');
        
        setTestLoginStatus('✓ Logged in!');
        // No reload needed - React will re-render with new auth state
      } else {
        const errorText = `Failed: ${response.status}`;
        setTestLoginStatus(errorText);
        console.error('HeaderNav: Test login failed with status:', response.status);
      }
    } catch (error) {
      const errorMsg = `Error: ${error.message}`;
      setTestLoginStatus(errorMsg);
      console.error('HeaderNav: Test login error:', error);
    }
  };

  return (
    <nav className="flex items-center gap-4">
      {showTestLogin && !isAuthenticated && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleTestLogin}
            className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded font-medium hover:bg-purple-700 transition-colors"
            title="Auto-login as test user 999 (resets all data)"
          >
            🧪 Test Login
          </button>
          {testLoginStatus && (
            <span className="text-xs text-gray-600 bg-yellow-100 px-2 py-1 rounded">
              {testLoginStatus}
            </span>
          )}
        </div>
      )}
      
      {isAuthenticated && user ? (
        <>
          <DiscoveryModeBadge userId={user.id} />
          <UserMenu email={user.email} onLogout={logout} />
        </>
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
