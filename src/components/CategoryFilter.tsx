import { useState, useEffect } from 'react';
import type { Category } from '../lib/types';
import { API_BASE_URL } from '../lib/config';
import { useAuth } from '../lib/auth';

interface CategoryFilterProps {
  onCategoryChange: (slug: string | null) => void;
}

export default function CategoryFilter({ onCategoryChange }: CategoryFilterProps) {
  const { isAuthenticated } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/categories`);
      const data = await response.json();
      setCategories(data);
    } catch (error) {
      console.error('Error fetching categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryClick = (slug: string | null) => {
    setActiveCategory(slug);
    onCategoryChange(slug);
  };

  if (loading) {
    return (
      <div className="flex gap-4 py-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="skeleton h-8 w-24"></div>
        ))}
      </div>
    );
  }

  return (
    <nav className="flex gap-1 border-b border-gray-200 overflow-x-auto">
      <button
        onClick={() => handleCategoryClick(null)}
        className={`category-tab ${activeCategory === null ? 'active' : ''}`}
      >
        All
      </button>
      
      {isAuthenticated && (
        <button
          onClick={() => handleCategoryClick('saved')}
          className={`category-tab ${activeCategory === 'saved' ? 'active' : ''}`}
        >
          Saved
        </button>
      )}
      
      {categories.map(category => (
        <button
          key={category.id}
          onClick={() => handleCategoryClick(category.slug)}
          className={`category-tab ${activeCategory === category.slug ? 'active' : ''}`}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
