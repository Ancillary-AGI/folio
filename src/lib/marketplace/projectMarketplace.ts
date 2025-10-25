import type { Project, User } from '../../types';

export interface MarketplaceProject {
  id: string;
  name: string;
  description: string;
  author: MarketplaceUser;
  category: 'electronics' | 'robotics' | 'iot' | 'automotive' | 'aerospace' | 'medical' | 'education' | 'hobby';
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  license: 'MIT' | 'GPL' | 'Apache' | 'BSD' | 'CC' | 'proprietary';
  price: number; // 0 for free
  currency: 'USD' | 'EUR' | 'GBP';
  rating: number; // 0-5
  reviewCount: number;
  downloadCount: number;
  favoriteCount: number;
  images: string[];
  thumbnail: string;
  projectData: Project;
  documentation: string;
  changelog: MarketplaceVersion[];
  requirements: {
    components: Array<{
      name: string;
      quantity: number;
      optional: boolean;
    }>;
    tools: string[];
    skills: string[];
  };
  created: number;
  updated: number;
  featured: boolean;
  verified: boolean;
  status: 'draft' | 'published' | 'archived';
}

export interface MarketplaceUser {
  id: string;
  username: string;
  displayName: string;
  avatar?: string;
  bio?: string;
  website?: string;
  location?: string;
  verified: boolean;
  reputation: number;
  projectCount: number;
  followerCount: number;
  followingCount: number;
  badges: MarketplaceBadge[];
  joined: number;
}

export interface MarketplaceBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  earned: number;
}

export interface MarketplaceVersion {
  version: string;
  description: string;
  changes: string[];
  released: number;
  downloadUrl: string;
}

export interface MarketplaceReview {
  id: string;
  projectId: string;
  userId: string;
  user: MarketplaceUser;
  rating: number;
  title: string;
  content: string;
  helpful: number;
  reported: number;
  created: number;
  updated?: number;
}

export interface MarketplaceSearchFilters {
  category?: string;
  difficulty?: string;
  license?: string;
  priceRange?: { min: number; max: number };
  rating?: number;
  tags?: string[];
  author?: string;
  featured?: boolean;
  verified?: boolean;
  sortBy?: 'relevance' | 'rating' | 'downloads' | 'recent' | 'price';
  sortOrder?: 'asc' | 'desc';
}

export interface MarketplaceSearchResult {
  projects: MarketplaceProject[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    categories: Array<{ name: string; count: number }>;
    difficulties: Array<{ name: string; count: number }>;
    licenses: Array<{ name: string; count: number }>;
    tags: Array<{ name: string; count: number }>;
  };
}

class ProjectMarketplace {
  private projects: Map<string, MarketplaceProject> = new Map();
  private users: Map<string, MarketplaceUser> = new Map();
  private reviews: Map<string, MarketplaceReview[]> = new Map();

  constructor() {
    this.initializeSampleData();
  }

  private initializeSampleData(): void {
    // Sample users
    const sampleUsers: MarketplaceUser[] = [
      {
        id: 'user1',
        username: 'electronics_guru',
        displayName: 'Electronics Guru',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=guru',
        bio: 'Professional electronics engineer with 15+ years experience',
        verified: true,
        reputation: 4850,
        projectCount: 23,
        followerCount: 1250,
        followingCount: 89,
        badges: [
          {
            id: 'verified',
            name: 'Verified Creator',
            description: 'Verified professional creator',
            icon: '✓',
            color: '#10B981',
            earned: Date.now() - 86400000 * 30
          }
        ],
        joined: Date.now() - 86400000 * 365
      }
    ];

    sampleUsers.forEach(user => this.users.set(user.id, user));

    // Sample projects
    const sampleProjects: MarketplaceProject[] = [
      {
        id: 'proj1',
        name: 'Arduino Weather Station',
        description: 'Complete weather monitoring system with web interface and mobile app connectivity.',
        author: sampleUsers[0],
        category: 'iot',
        tags: ['arduino', 'weather', 'sensors', 'wifi', 'web'],
        difficulty: 'intermediate',
        license: 'MIT',
        price: 0,
        currency: 'USD',
        rating: 4.7,
        reviewCount: 89,
        downloadCount: 2340,
        favoriteCount: 456,
        images: ['https://picsum.photos/800/600?random=1'],
        thumbnail: 'https://picsum.photos/400/300?random=1',
        projectData: {} as Project,
        documentation: '# Arduino Weather Station\\n\\nComplete documentation here...',
        changelog: [
          {
            version: '1.2.0',
            description: 'Added wind speed sensor support',
            changes: ['Added wind speed measurement', 'Improved web interface', 'Bug fixes'],
            released: Date.now() - 86400000 * 7,
            downloadUrl: '/downloads/weather-station-v1.2.0.zip'
          }
        ],
        requirements: {
          components: [
            { name: 'Arduino Uno', quantity: 1, optional: false },
            { name: 'DHT22 Sensor', quantity: 1, optional: false }
          ],
          tools: ['Soldering Iron', 'Multimeter'],
          skills: ['Basic Electronics', 'Arduino Programming']
        },
        created: Date.now() - 86400000 * 30,
        updated: Date.now() - 86400000 * 7,
        featured: true,
        verified: true,
        status: 'published'
      }
    ];

    sampleProjects.forEach(project => this.projects.set(project.id, project));
  }

  async searchProjects(query: string, filters: MarketplaceSearchFilters = {}): Promise<MarketplaceSearchResult> {
    let filteredProjects = Array.from(this.projects.values());

    // Apply filters
    if (filters.category) {
      filteredProjects = filteredProjects.filter(p => p.category === filters.category);
    }
    if (filters.difficulty) {
      filteredProjects = filteredProjects.filter(p => p.difficulty === filters.difficulty);
    }
    if (filters.rating) {
      filteredProjects = filteredProjects.filter(p => p.rating >= filters.rating);
    }

    // Search by query
    if (query) {
      const lowerQuery = query.toLowerCase();
      filteredProjects = filteredProjects.filter(p => 
        p.name.toLowerCase().includes(lowerQuery) ||
        p.description.toLowerCase().includes(lowerQuery) ||
        p.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      );
    }

    return {
      projects: filteredProjects,
      total: filteredProjects.length,
      page: 1,
      pageSize: 20,
      facets: {
        categories: [{ name: 'iot', count: 1 }],
        difficulties: [{ name: 'intermediate', count: 1 }],
        licenses: [{ name: 'MIT', count: 1 }],
        tags: [{ name: 'arduino', count: 1 }]
      }
    };
  }

  async getProject(id: string): Promise<MarketplaceProject | null> {
    return this.projects.get(id) || null;
  }

  async getFeaturedProjects(): Promise<MarketplaceProject[]> {
    return Array.from(this.projects.values()).filter(p => p.featured);
  }

  async getProjectReviews(projectId: string): Promise<MarketplaceReview[]> {
    return this.reviews.get(projectId) || [];
  }
}

export const projectMarketplace = new ProjectMarketplace();