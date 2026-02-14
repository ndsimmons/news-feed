import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { API_BASE_URL } from '../lib/config';

export default function SiteTitle() {
  const { user, isAuthenticated } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';
  const feedTitle = isAuthenticated ? `${displayName}'s feed` : 'Nicofeed';

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setEditValue(displayName);
    setIsEditing(true);
  };

  const handleSave = async () => {
    if (!editValue.trim() || !user) return;
    
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/user/display-name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          displayName: editValue.trim()
        })
      });

      if (response.ok) {
        // Update user in auth context by triggering a session validation
        const token = localStorage.getItem('auth_token');
        if (token) {
          const validateResponse = await fetch(`${API_BASE_URL}/api/auth/validate-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          });
          
          if (validateResponse.ok) {
            // Auth context will update automatically
            window.location.reload(); // Temp solution to refresh user data
          }
        }
      }
    } catch (error) {
      console.error('Error saving display name:', error);
    } finally {
      setIsSaving(false);
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="px-2 py-1 border border-gray-300 rounded text-base font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
          style={{ width: `${Math.max(100, editValue.length * 10)}px` }}
          autoFocus
          disabled={isSaving}
          maxLength={50}
        />
        <button
          onClick={handleSave}
          disabled={isSaving || !editValue.trim()}
          className="px-2 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? '...' : '✓'}
        </button>
        <button
          onClick={handleCancel}
          disabled={isSaving}
          className="px-2 py-1 bg-gray-300 text-gray-700 text-sm rounded hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xl font-normal">{feedTitle}</span>
      {isAuthenticated && (
        <button
          onClick={handleEditClick}
          className="text-gray-400 hover:text-gray-600 transition-colors"
          title="Edit display name"
        >
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
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
      )}
    </div>
  );
}
