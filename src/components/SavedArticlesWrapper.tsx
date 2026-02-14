import { AuthProvider } from '../lib/auth';
import SavedArticles from './SavedArticles';

export default function SavedArticlesWrapper() {
  return (
    <AuthProvider>
      <SavedArticles />
    </AuthProvider>
  );
}
