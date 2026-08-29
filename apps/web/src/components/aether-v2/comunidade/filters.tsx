import React, { useState } from 'react';
import { CommunityFilter, CommunityFiltersProps } from './types';

const CommunityFilters: React.FC<CommunityFiltersProps> = ({
  filters,
  onFilterChange,
  categories
}) => {
  const [selectedCategory, setSelectedCategory] = useState(filters.category);
  const [searchTerm, setSearchTerm] = useState(filters.searchTerm);

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    onFilterChange({ ...filters, category });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);
    onFilterChange({ ...filters, searchTerm: value });
  };

  return (
    <div className="flex flex-wrap items-center gap-4 p-4 bg-gray-800 rounded-lg">
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => handleCategoryChange(category)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              selectedCategory === category
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {category}
          </button>
        ))}
      </div>
      
      <div className="flex flex-col">
        <label htmlFor="search" className="text-sm text-gray-300 mb-1">
          Buscar comunidades
        </label>
        <input
          id="search"
          type="text"
          value={searchTerm}
          onChange={handleSearchChange}
          className="px-3 py-2 rounded bg-gray-700 text-white border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Digite para buscar..."
        />
      </div>
    </div>
  );
};

export default CommunityFilters;