export interface Community {
  id: string;
  name: string;
  description: string;
  bannerUrl: string;
  iconUrl: string;
  onlineMembers: number;
  totalMembers: number;
  isOfficial: boolean;
  verified: boolean;
  category: string;
  createdAt: Date;
}

export interface CommunityFilter {
  category: string;
  searchTerm: string;
}

export interface CommunityCardProps {
  community: Community;
  onCommunityClick: (id: string) => void;
}

export interface CommunityFiltersProps {
  filters: CommunityFilter;
  onFilterChange: (filter: CommunityFilter) => void;
  categories: string[];
}