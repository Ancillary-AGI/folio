import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  X, 
  Search, 
  Star, 
  Download, 
  Heart, 
  Filter, 
  Grid, 
  List,
  TrendingUp,
  Award,
  Clock,
  User,
  Tag,
  DollarSign,
  Eye
} from 'lucide-react';
import { projectMarketplace, type MarketplaceProject, type MarketplaceSearchFilters } from '../../lib/marketplace/projectMarketplace';

interface MarketplacePanelProps {
  onClose: () => void;
  onProjectImport?: (project: MarketplaceProject) => void;
}

export default function MarketplacePanel({ onClose, onProjectImport }: MarketplacePanelProps) {
  const [projects, setProjects] = useState<MarketplaceProject[]>([]);
  const [featuredProjects, setFeaturedProjects] = useState<MarketplaceProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<MarketplaceProject | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<MarketplaceSearchFilters>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadFeaturedProjects();
    searchProjects();
  }, []);

  const loadFeaturedProjects = async () => {
    try {
      const featured = await projectMarketplace.getFeaturedProjects();
      setFeaturedProjects(featured);
    } catch (error) {
      console.error('Failed to load featured projects:', error);
    }
  };

  const searchProjects = async () => {
    setLoading(true);
    try {
      const result = await projectMarketplace.searchProjects(searchQuery, filters);
      setProjects(result.projects);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    searchProjects();
  };

  const handleProjectSelect = async (projectId: string) => {
    try {
      const project = await projectMarketplace.getProject(projectId);
      setSelectedProject(project);
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  };

  const handleImportProject = (project: MarketplaceProject) => {
    if (onProjectImport) {
      onProjectImport(project);
    }
    onClose();
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Star
        key={i}
        className={`w-3 h-3 ${i < Math.floor(rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
      />
    ));
  };

  const formatPrice = (price: number, currency: string) => {
    if (price === 0) return 'Free';
    return `${currency === 'USD' ? '$' : currency} ${price}`;
  };

  if (selectedProject) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setSelectedProject(null)}>
                <X className="w-4 h-4" />
              </Button>
              <h3 className="font-semibold text-foreground">{selectedProject.name}</h3>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Project Images */}
              <div className="lg:col-span-2">
                <img
                  src={selectedProject.thumbnail}
                  alt={selectedProject.name}
                  className="w-full h-64 object-cover rounded-lg mb-4"
                />
                
                <div className="prose max-w-none">
                  <h2>Description</h2>
                  <p>{selectedProject.description}</p>
                  
                  <h3>Documentation</h3>
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <pre className="whitespace-pre-wrap text-sm">{selectedProject.documentation}</pre>
                  </div>
                </div>
              </div>

              {/* Project Info */}
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Project Info</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Price:</span>
                      <span className="font-medium">{formatPrice(selectedProject.price, selectedProject.currency)}</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Rating:</span>
                      <div className="flex items-center gap-1">
                        {renderStars(selectedProject.rating)}
                        <span className="text-sm ml-1">({selectedProject.reviewCount})</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Downloads:</span>
                      <span className="font-medium">{selectedProject.downloadCount.toLocaleString()}</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Difficulty:</span>
                      <span className="capitalize font-medium">{selectedProject.difficulty}</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">License:</span>
                      <span className="font-medium">{selectedProject.license}</span>
                    </div>

                    <Button
                      onClick={() => handleImportProject(selectedProject)}
                      className="w-full mt-4"
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Import Project
                    </Button>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Author</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-3">
                      <img
                        src={selectedProject.author.avatar}
                        alt={selectedProject.author.displayName}
                        className="w-10 h-10 rounded-full"
                      />
                      <div>
                        <div className="font-medium text-sm">{selectedProject.author.displayName}</div>
                        <div className="text-xs text-muted-foreground">
                          {selectedProject.author.reputation} reputation
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Requirements</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <h4 className="text-xs font-medium mb-2">Components</h4>
                      <div className="space-y-1">
                        {selectedProject.requirements.components.map((comp, index) => (
                          <div key={index} className="text-xs flex justify-between">
                            <span>{comp.name}</span>
                            <span>×{comp.quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="text-xs font-medium mb-2">Tools</h4>
                      <div className="flex flex-wrap gap-1">
                        {selectedProject.requirements.tools.map((tool, index) => (
                          <span key={index} className="text-xs bg-accent px-2 py-1 rounded">
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Award className="w-5 h-5" />
            Project Marketplace
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 flex">
          {/* Main Content */}
          <div className="flex-1 flex flex-col">
            {/* Search Bar */}
            <div className="p-4 border-b border-border">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    placeholder="Search projects..."
                    className="w-full pl-10 pr-4 py-2 border border-input rounded-md bg-background"
                  />
                </div>
                <Button onClick={handleSearch} disabled={loading}>
                  Search
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowFilters(!showFilters)}
                >
                  <Filter className="w-4 h-4" />
                </Button>
                <div className="flex border border-input rounded-md">
                  <Button
                    variant={viewMode === 'grid' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('grid')}
                    className="rounded-r-none"
                  >
                    <Grid className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={viewMode === 'list' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className="rounded-l-none"
                  >
                    <List className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Featured Projects */}
            {featuredProjects.length > 0 && (
              <div className="p-4 border-b border-border">
                <h4 className="font-medium mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Featured Projects
                </h4>
                <div className="flex gap-4 overflow-x-auto">
                  {featuredProjects.map((project) => (
                    <div
                      key={project.id}
                      className="flex-shrink-0 w-64 cursor-pointer"
                      onClick={() => handleProjectSelect(project.id)}
                    >
                      <Card className="hover:shadow-md transition-shadow">
                        <div className="relative">
                          <img
                            src={project.thumbnail}
                            alt={project.name}
                            className="w-full h-32 object-cover rounded-t-lg"
                          />
                          {project.verified && (
                            <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded-full">
                              <Award className="w-3 h-3" />
                            </div>
                          )}
                        </div>
                        <CardContent className="p-3">
                          <h5 className="font-medium text-sm mb-1">{project.name}</h5>
                          <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                            {project.description}
                          </p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                              {renderStars(project.rating)}
                              <span className="text-xs">({project.reviewCount})</span>
                            </div>
                            <span className="text-xs font-medium">
                              {formatPrice(project.price, project.currency)}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Project Grid/List */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="text-center py-8">
                  <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
                  <p className="text-muted-foreground">Loading projects...</p>
                </div>
              ) : (
                <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-4'}>
                  {projects.map((project) => (
                    <Card
                      key={project.id}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => handleProjectSelect(project.id)}
                    >
                      {viewMode === 'grid' ? (
                        <>
                          <div className="relative">
                            <img
                              src={project.thumbnail}
                              alt={project.name}
                              className="w-full h-48 object-cover rounded-t-lg"
                            />
                            {project.verified && (
                              <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded-full">
                                <Award className="w-3 h-3" />
                              </div>
                            )}
                          </div>
                          <CardContent className="p-4">
                            <h5 className="font-medium mb-2">{project.name}</h5>
                            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                              {project.description}
                            </p>
                            
                            <div className="flex items-center gap-2 mb-2">
                              <img
                                src={project.author.avatar}
                                alt={project.author.displayName}
                                className="w-6 h-6 rounded-full"
                              />
                              <span className="text-sm">{project.author.displayName}</span>
                            </div>
                            
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1">
                                {renderStars(project.rating)}
                                <span className="text-sm">({project.reviewCount})</span>
                              </div>
                              <span className="font-medium">
                                {formatPrice(project.price, project.currency)}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Download className="w-3 h-3" />
                                {project.downloadCount.toLocaleString()}
                              </div>
                              <div className="flex items-center gap-1">
                                <Heart className="w-3 h-3" />
                                {project.favoriteCount}
                              </div>
                            </div>
                          </CardContent>
                        </>
                      ) : (
                        <CardContent className="p-4 flex gap-4">
                          <img
                            src={project.thumbnail}
                            alt={project.name}
                            className="w-24 h-24 object-cover rounded-lg flex-shrink-0"
                          />
                          <div className="flex-1">
                            <h5 className="font-medium mb-1">{project.name}</h5>
                            <p className="text-sm text-muted-foreground mb-2">
                              {project.description}
                            </p>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1">
                                {renderStars(project.rating)}
                                <span className="text-sm">({project.reviewCount})</span>
                              </div>
                              <span className="font-medium">
                                {formatPrice(project.price, project.currency)}
                              </span>
                            </div>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              )}

              {projects.length === 0 && !loading && (
                <div className="text-center py-8">
                  <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-medium mb-2">No projects found</h3>
                  <p className="text-muted-foreground">Try adjusting your search or filters</p>
                </div>
              )}
            </div>
          </div>

          {/* Filters Sidebar */}
          {showFilters && (
            <div className="w-64 border-l border-border p-4 space-y-4">
              <h4 className="font-medium">Filters</h4>
              
              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <select
                  value={filters.category || ''}
                  onChange={(e) => setFilters({ ...filters, category: e.target.value || undefined })}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                >
                  <option value="">All Categories</option>
                  <option value="electronics">Electronics</option>
                  <option value="robotics">Robotics</option>
                  <option value="iot">IoT</option>
                  <option value="automotive">Automotive</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Difficulty</label>
                <select
                  value={filters.difficulty || ''}
                  onChange={(e) => setFilters({ ...filters, difficulty: e.target.value || undefined })}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                >
                  <option value="">All Levels</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                  <option value="expert">Expert</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-2">Minimum Rating</label>
                <select
                  value={filters.rating || ''}
                  onChange={(e) => setFilters({ ...filters, rating: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                >
                  <option value="">Any Rating</option>
                  <option value="4">4+ Stars</option>
                  <option value="3">3+ Stars</option>
                  <option value="2">2+ Stars</option>
                </select>
              </div>
              
              <Button onClick={handleSearch} className="w-full">
                Apply Filters
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}