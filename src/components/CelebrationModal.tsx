import { useEffect, useState } from 'react';

interface CelebrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CelebrationModal({ isOpen, onClose }: CelebrationModalProps) {
  const [show, setShow] = useState(false);

  const handleClose = () => {
    setShow(false);
    setTimeout(onClose, 300); // Wait for fade out animation
  };

  useEffect(() => {
    if (isOpen) {
      setShow(true);
      // Auto-close after 3 seconds
      const timer = setTimeout(handleClose, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 transition-opacity duration-300 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleClose}
    >
      <div 
        className={`relative bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-2xl p-8 text-center max-w-md mx-4 transform transition-all duration-300 ${
          show ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          aria-label="Close"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Celebration Icon */}
        <div className="mb-4 animate-bounce">
          <div className="inline-block">
            <svg 
              className="w-20 h-20 text-yellow-300" 
              fill="currentColor" 
              viewBox="0 0 24 24"
            >
              <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
            </svg>
          </div>
        </div>

        {/* Main Message */}
        <h2 className="text-4xl font-bold text-white mb-3">
          Boom! 💥
        </h2>
        <h3 className="text-2xl font-bold text-white mb-4">
          Personalized Mode Unlocked
        </h3>
        
        <p className="text-white/90 text-lg mb-6">
          Your feed is now tailored to your interests!
        </p>

        {/* Confetti-like decorations */}
        <div className="absolute top-4 left-4 text-yellow-300 text-2xl animate-pulse">✨</div>
        <div className="absolute top-6 right-6 text-yellow-300 text-2xl animate-pulse delay-100">⭐</div>
        <div className="absolute bottom-6 left-8 text-yellow-300 text-xl animate-pulse delay-200">🎉</div>
        <div className="absolute bottom-4 right-4 text-yellow-300 text-xl animate-pulse delay-300">🚀</div>
      </div>
    </div>
  );
}
