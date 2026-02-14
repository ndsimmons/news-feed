import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AuthProvider } from '../lib/auth';
import ArticleList from './ArticleList';
import HeaderNav from './HeaderNav';
import SiteTitle from './SiteTitle';

function AppContent() {
  const [headerNavContainer, setHeaderNavContainer] = useState<HTMLElement | null>(null);
  const [siteTitleContainer, setSiteTitleContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Only access DOM after mount to avoid hydration mismatch
    setHeaderNavContainer(document.getElementById('header-nav'));
    setSiteTitleContainer(document.getElementById('site-title'));
  }, []);

  return (
    <>
      {headerNavContainer && createPortal(<HeaderNav />, headerNavContainer)}
      {siteTitleContainer && createPortal(<SiteTitle />, siteTitleContainer)}
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
