import React, { useState, useEffect } from 'react';
import { Community } from './types';
import CommunityCard from './server-card';
import CommunityFilters from './filters';

// Mock data for communities
const mockCommunities: Community[] = [
  {
    id: '1',
    name: 'Fluxer HQ',
    description: "Fluxin' it.",
    bannerUrl: 'https://via.placeholder.com/300x150/1e40af/ffffff?text=Fluxer+HQ',
    iconUrl: 'https://via.placeholder.com/100/1e40af/ffffff?text=Fluxer',
    onlineMembers: 1266,
    totalMembers: 50014,
    isOfficial: true,
    verified: true,
    category: 'All',
    createdAt: new Date()
  },
  {
    id: '2',
    name: 'Fluxer Developers',
    description: 'Dōmo arigāto, Mr. Roboto',
    bannerUrl: 'https://via.placeholder.com/300x150/1e40af/ffffff?text=Fluxer+Developers',
    iconUrl: 'https://via.placeholder.com/100/1e40af/ffffff?text=Dev',
    onlineMembers: 442,
    totalMembers: 9265,
    isOfficial: true,
    verified: true,
    category: 'All',
    createdAt: new Date()
  },
  {
    id: '3',
    name: 'Linux Gaming',
    description: 'Linux Gaming is a one stop hub for discussing gaming on any distro or setup. Whether you’re a long time Linux user, or just considering taking that plunge into Linux for the first time...',
    bannerUrl: 'https://via.placeholder.com/300x150/1e40af/ffffff?text=Linux+Gaming',
    iconUrl: 'https://via.placeholder.com/100/1e40af/ffffff?text=Linux',
    onlineMembers: 211,
    totalMembers: 6460,
    isOfficial: false,
    verified: false,
    category: 'Gaming',
    createdAt: new Date()
  },
  {
    id: '4',
    name: 'Linux Hub',
    description: 'A friendly Hub for Linux users of all distros! No matter if you are new, planning to switch or have been using Linux for years. Here you can hang out, share knowledge, and discuss topics.',
    bannerUrl: 'https://via.placeholder.com/300x150/1e40af/ffffff?text=Linux+Hub',
    iconUrl: 'https://via.placeholder.com/100/1e40af/ffffff?text=Linux',
    onlineMembers: 179,
    totalMembers: 4901,
    isOfficial: false,
    verified: false,
    category: 'Linux',
    createdAt: new Date()
  },
  {
    id: '5',
    name: 'Queer Fluxers',
    description: '[UNOFFICIAL] A safe, moderated space where queer (and otherwise non-conforming) people on the platform can socialize!',
    bannerUrl: 'https://via.placeholder.com/300x150/1e40af/ffffff?text=Queer+Fluxers',
    iconUrl: 'https://via.placeholder.com/100/1e40af/ffffff?text=Queer',
    onlineMembers: 148,
    totalMembers: 3147,
    isOfficial: false,
    verified: false,
    category: 'Community',
    createdAt: new Date()
  },
  {
    id: '6',
    name: 'Minecraft (Unofficial)',
    description: 'Unofficial Minecraft Fluxer server',
    bannerUrl: 'https://via.placeholder.com/300x150/1e40af/ffffff?text=Minecraft',
    iconUrl: 'https://via.placeholder.com/100/1e40af/ffffff?text=Minecraft',
    onlineMembers: 0,
    totalMembers: 0,
    isOfficial: false,
    verified: false,
    category: 'Gaming',
    createdAt: new Date()
  },
  {
    id: '7',
    name: 'Fluxer.Net',
    description: 'The community support server for Fluxer.Net! This is not an officially managed Fluxer community.',
    bannerUrl: 'https://via.placeholder.com/300x150/1e40af/ffffff?text=Fluxer.Net',
    iconUrl: 'https://via.placeholder.com/100/1e40af/ffffff?text=Fluxer',
    onlineMembers: 0,
    totalMembers: 0,
    isOfficial: false,
    verified: false,
    category: 'Support',
    createdAt: new Date()
  },
  {
    id: '8',
    name: 'Yuri',
    description: 'Yuri is a SFW space for sharing anime, manga, artwork, etc. featuring a lesbian relationship.',
    bannerUrl: 'https://via.placeholder.com/300x150/1e40af/ffffff?text=Yuri',
    iconUrl: 'https://via.placeholder.com/100/1e40af/ffffff?text=Yuri',
    onlineMembers: 0,
    totalMembers: 0,
    isOfficial: false,
    verified: false,
    category: 'Community',
    createdAt: new Date()
  }
];

const categories = ['Todos', 'Gaming', 'Music', 'Entertainment', 'Education', 'Science & Technology', 'Content Creator'];

const DiscoveryPage: React.FC = () => {
  const [communities, setCommunities] = useState<Community[]>(mockCommunities);
  const [filters, setFilters] = useState({
    category: 'Todos',
    searchTerm: ''
  });

  const handleFilterChange = (filter: { category: string; searchTerm: string }) => {
    setFilters(filter);
  };

  const filteredCommunities = communities.filter((community) => {
    const matchesCategory = filters.category === 'Todos' || community.category === filters.category;
    const matchesSearch = community.name.toLowerCase().includes(filters.searchTerm.toLowerCase()) || 
      community.description.toLowerCase().includes(filters.searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const handleCommunityClick = (id: string) => {
    // Handle community click (you can add navigation or other logic here)
    console.log('Community clicked:', id);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <div className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-2xl font-bold text-white">Explorar</h1>
      </div>
      
      <div className="flex flex-1">
        <div className="w-64 bg-gray-800 border-r border-gray-700 p-4">
          <h2 className="text-xl font-bold text-white mb-4">Comunidades</h2>
          <div className="space-y-4">
            <button
              onClick={() => handleFilterChange({ category: 'Todos', searchTerm: '' })}
              className="w-full text-left p-2 rounded hover:bg-gray-700 transition-colors"
            >
              Todos
            </button>
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => handleFilterChange({ category, searchTerm: '' })}
                className="w-full text-left p-2 rounded hover:bg-gray-700 transition-colors"
              >
                {category}
              </button>
            ))}
          </div>
        </div>
        
        <div className="flex-1 p-6">
          <CommunityFilters
            filters={filters}
            onFilterChange={handleFilterChange}
            categories={categories}
          />
          
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCommunities.map((community) => (
              <CommunityCard
                key={community.id}
                community={community}
                onCommunityClick={handleCommunityClick}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiscoveryPage;