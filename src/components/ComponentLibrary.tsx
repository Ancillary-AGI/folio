import { useState, useMemo } from 'react';
import { Search, Filter, Grid3X3, List, Package, Zap, Cpu, Radio, Settings, ChevronDown, Star, Info } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Component } from '../lib/supabase';

interface ComponentLibraryProps {
  components: Component[];
  onSelectComponent: (component: Component) => void;
  selectedComponent?: Component | null;
}

interface ComponentCategory {
  name: string;
  icon: React.ReactNode;
  count: number;
  color: string;
}

export default function ComponentLibrary({ components, onSelectComponent, selectedComponent }: ComponentLibraryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'category' | 'popularity'>('category');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Get component categories with counts and icons
  const categories = useMemo(() => {
    const categoryMap = new Map<string, number>();
    components.forEach(comp => {
      categoryMap.set(comp.category, (categoryMap.get(comp.category) || 0) + 1);
    });

    const categoryIcons: Record<string, { icon: React.ReactNode; color: string }> = {
      'Passive': { icon: <Package className="w-4 h-4" />, color: 'text-blue-500' },
      'Active': { icon: <Zap className="w-4 h-4" />, color: 'text-yellow-500' },
      'Digital': { icon: <Cpu className="w-4 h-4" />, color: 'text-green-500' },
      'Analog': { icon: <Radio className="w-4 h-4" />, color: 'text-purple-500' },
      'Power': { icon: <Settings className="w-4 h-4" />, color: 'text-red-500' },
    };

    const result: ComponentCategory[] = [
      { name: 'all', icon: <Grid3X3 className="w-4 h-4" />, count: components.length, color: 'text-foreground' }
    ];

    Array.from(categoryMap.entries()).forEach(([category, count]) => {
      const iconData = categoryIcons[category] || { icon: <Package className="w-4 h-4" />, color: 'text-muted-foreground' };
      result.push({
        name: category,
        icon: iconData.icon,
        count,
        color: iconData.color
      });
    });

    return result;
  }, [components]);

  // Filter and sort components
  const filteredComponents = useMemo(() => {
    const filtered = components.filter(comp => {
      const matchesSearch = comp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           comp.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           comp.tags?.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()));
      const matchesCategory = selectedCategory === 'all' || comp.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });

    // Sort components
    const sortedFiltered = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'category':
          return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
        case 'popularity':
          // Mock popularity - in real app this would come from usage data
          return Math.random() - 0.5;
        default:
          return 0;
      }
    });

    return sortedFiltered;
  }, [components, searchTerm, selectedCategory, sortBy]);

  const toggleFavorite = (componentId: string) => {
    const newFavorites = new Set(favorites);
    if (newFavorites.has(componentId)) {
      newFavorites.delete(componentId);
    } else {
      newFavorites.add(componentId);
    }
    setFavorites(newFavorites);
  };

  const ComponentCard = ({ component }: { component: Component }) => (
    <Card 
      className={`cursor-pointer transition-all duration-200 hover:shadow-md hover:border-primary/50 ${
        selectedComponent?.id === component.id ? 'border-primary bg-primary/5' : ''
      }`}
      onClick={() => onSelectComponent(component)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-sm font-medium truncate">{component.name}</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(component.id || component.name);
            }}
          >
            <Star className={`w-3 h-3 ${favorites.has(component.id || component.name) ? 'fill-yellow-400 text-yellow-400' : ''}`} />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="px-2 py-1 bg-muted rounded text-xs">{component.category}</span>
          {component.manufacturer && (
            <span className="truncate">{component.manufacturer}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Component Symbol Preview */}
        <div className="h-12 bg-muted/30 rounded mb-2 flex items-center justify-center">
          <svg width="40" height="30" viewBox="0 0 40 30" className="text-component">
            {/* Simple rectangle for now - in real app would render actual symbol */}
            <rect x="5" y="10" width="30" height="10" fill="none" stroke="currentColor" strokeWidth="1" />
            <text x="20" y="18" textAnchor="middle" fontSize="8" fill="currentColor">
              {component.name.substring(0, 3)}
            </text>
          </svg>
        </div>
        
        {component.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
            {component.description}
          </p>
        )}
        
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {component.pins?.length || 0} pins
          </span>
          {(component as any).cost && (
            <span className="font-medium">${((component as any).cost as number).toFixed(2)}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const ComponentListItem = ({ component }: { component: Component }) => (
    <div 
      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all duration-200 hover:bg-accent ${
        selectedComponent?.id === component.id ? 'bg-primary/10 border border-primary/20' : ''
      }`}
      onClick={() => onSelectComponent(component)}
    >
      <div className="w-8 h-8 bg-muted/30 rounded flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-medium">{component.name.substring(0, 2)}</span>
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-medium text-sm truncate">{component.name}</h4>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(component.id || component.name);
            }}
          >
            <Star className={`w-3 h-3 ${favorites.has(component.id || component.name) ? 'fill-yellow-400 text-yellow-400' : ''}`} />
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{component.category}</span>
          <span>•</span>
          <span>{component.pins?.length || 0} pins</span>
          {(component as any).cost && (
            <>
              <span>•</span>
              <span>${((component as any).cost as number).toFixed(2)}</span>
            </>
          )}
        </div>
      </div>
      
      <Button variant="ghost" size="icon" className="h-6 w-6">
        <Info className="w-3 h-3" />
      </Button>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground">Component Library</h3>
          <div className="flex items-center gap-1">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('grid')}
              className="h-8 w-8"
            >
              <Grid3X3 className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setViewMode('list')}
              className="h-8 w-8"
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search components..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-input rounded-md bg-background focus:ring-2 focus:ring-ring focus:border-transparent"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2"
          >
            <Filter className="w-3 h-3" />
            Filters
            <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </Button>
          
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'category' | 'popularity')}
            className="px-3 py-1 text-sm border border-input rounded bg-background"
          >
            <option value="category">Sort by Category</option>
            <option value="name">Sort by Name</option>
            <option value="popularity">Sort by Popularity</option>
          </select>
        </div>

        {/* Category Filters */}
        {showFilters && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {categories.map((category) => (
                <Button
                  key={category.name}
                  variant={selectedCategory === category.name ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(category.name)}
                  className="flex items-center gap-2 justify-start"
                >
                  <span className={category.color}>{category.icon}</span>
                  <span className="capitalize">{category.name}</span>
                  <span className="ml-auto text-xs">({category.count})</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Component List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4">
          {filteredComponents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No components found</p>
              <p className="text-sm">Try adjusting your search or filters</p>
            </div>
          ) : (
            <div className={
              viewMode === 'grid' 
                ? 'grid grid-cols-2 gap-3' 
                : 'space-y-2'
            }>
              {filteredComponents.map((component) => (
                <div key={component.id} className="group">
                  {viewMode === 'grid' ? (
                    <ComponentCard component={component} />
                  ) : (
                    <ComponentListItem component={component} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border bg-muted/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{filteredComponents.length} components</span>
          <span>{favorites.size} favorites</span>
        </div>
      </div>
    </div>
  );
}