import React from 'react';
import { CommunityCardProps } from './types';

const CommunityCard: React.FC<CommunityCardProps> = ({
  community,
  onCommunityClick
}) => {
  const handleCardClick = () => {
    onCommunityClick(community.id);
  };

  return (
    <div
      className="bg-gray-900 rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300 cursor-pointer"
      onClick={handleCardClick}
    >
      <div className="relative">
        <img
          src={community.bannerUrl}
          alt="Banner do servidor"
          className="w-full h-32 object-cover"
        />
        <div className="absolute top-2 right-2">
          {community.isOfficial && (
            <div className="bg-green-600 text-white px-2 py-1 rounded-full text-xs font-bold">
              Oficial
            </div>
          )}
          {community.verified && (
            <div className="bg-blue-600 text-white px-2 py-1 rounded-full text-xs font-bold">
              Verificado
            </div>
          )}
        </div>
      </div>
      
      <div className="p-4">
        <div className="flex items-center mb-2">
          <img
            src={community.iconUrl}
            alt="Ícone do servidor"
            className="w-10 h-10 rounded-full mr-3"
          />
          <h2 className="text-xl font-bold text-white">
            {community.name}
            {community.verified && (
              <span className="ml-2 text-yellow-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 15a5 5 0 100-10 5 5 0 000 10z" clipRule="evenodd" />
                </svg>
              </span>
            )}
          </h2>
        </div>
        
        <p className="text-gray-300 mb-4">
          {community.description}
        </p>
        
        <div className="flex items-center text-sm text-gray-400">
          <span className="mr-2">
            <span className="text-green-400">{community.onlineMembers}</span>
            online
          </span>
          <span className="mx-2">•</span>
          <span>
            <span className="text-gray-300">{community.totalMembers}</span>
            membros
          </span>
        </div>
      </div>
    </div>
  );
};

export default CommunityCard;