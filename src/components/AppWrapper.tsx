import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AuthProvider } from '../lib/auth';
import ArticleList from './ArticleList';
import HeaderNav from './HeaderNav';

function AppContent() {
  const headerNavContainer = typeof window !== 'undefined' 
    ? document.getElementById('header-nav') 
    : null;

  return (
    <>
      {headerNavContainer && createPortal(<HeaderNav />, headerNavContainer)}
      <ArticleList />
    </>
  );
}

export default function AppWrapper() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
