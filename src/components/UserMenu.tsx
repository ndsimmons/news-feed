import { useState, useRef, useEffect } from 'react';

interface UserMenuProps {
  email: string;
  onLogout: () => void;
}

export default function UserMenu({ email, onLogout }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Extract initials from email
  const getInitials = (email: string): string => {
    const parts = email.split('@')[0].split('.');
    if (parts.length >= 2) {
      // john.doe -> JD
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    // nsimmons -> NS (first two letters)
    return email.substring(0, 2).toUpperCase();
  };

  const initials = getInitials(email);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center hover:bg-blue-700 transition-colors"
      >
        {initials}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm text-gray-500">Signed in as</p>
            <p className="text-sm font-medium text-gray-900 truncate">{email}</p>
          </div>
          
          <a
            href="/saved"
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Saved Articles
          </a>

          <a
            href="/settings"
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Settings
          </a>
          
          <button
            onClick={() => {
              onLogout();
              setIsOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
