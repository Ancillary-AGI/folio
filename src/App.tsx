import { useState, useEffect } from 'react'
import { Cpu, FolderOpen, Menu, Bot, BarChart3, Settings, Package, Users, Download, Image, FileText, List, Palette, LogOut } from 'lucide-react'
import { Button } from './components/ui/button'
import { Component as TypeComponent, PlacedComponent, Wire, User } from './types'
import { supabase, type Project, type Component } from './lib/supabase'
import { standardComponents } from './lib/componentLibrary'
import { exportToImage, exportToNetlist, exportToJSON, exportToBOM, downloadFile } from './lib/exportUtils'
import { pluginManager } from './lib/plugins/pluginManager'
import { collaborativeEditor } from './lib/collaboration/collaborativeEditor'
import { useAppStore } from './stores/useAppStore'
import { useProjectStore } from './stores/useProjectStore'
import ComponentLibrary from './components/ComponentLibrary'
import SchematicCanvas from './components/SchematicCanvas'
import Toolbar from './components/Toolbar'
import PropertiesPanel from './components/PropertiesPanel'
import SimulationPanel from './components/simulation/SimulationPanel'
import AIChatPanel from './components/ai/AIChatPanel'
import ProjectManager from './components/ProjectManager'
import AuthForm from './components/AuthForm'
import PluginPanel from './components/plugins/PluginPanel'
import CollaborativePanel from './components/collaboration/CollaborativePanel'
import UserPresence from './components/collaboration/UserPresence'

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [components, setComponents] = useState<TypeComponent[]>([]);
  const [canvasData, setCanvasData] = useState<Record<string, unknown> | null>(null);
  const [selectedComponentForProps, setSelectedComponentForProps] = useState<Record<string, unknown> | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showPluginPanel, setShowPluginPanel] = useState(false);
  const [showCollaborativePanel, setShowCollaborativePanel] = useState(false);
  const [collaborativeUsers, setCollaborativeUsers] = useState<Record<string, unknown>[]>([]);
  const [showCursors] = useState(true);
  const [showSelections] = useState(true);
  
  // App store state
  const {
    settings,
    sidebarOpen,
    propertiesPanelOpen,
    simulationPanelOpen,
    aiChatOpen,
    toggleSidebar,
    togglePropertiesPanel,
    toggleSimulationPanel,
    toggleAiChat,
    updateSettings
  } = useAppStore();
  
  // Project store state
  const {
    currentProject,
    setCurrentProject,
    setCurrentSchematic,
    isDirty,
    markClean
  } = useProjectStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user as unknown as User ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user as unknown as User ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      loadComponents();
    }
  }, [user]);

  useEffect(() => {
    // Initialize plugin system
    const initializePlugins = async () => {
      try {
        // Plugin manager is already initialized
        console.log('Plugin system initialized')
        
        // Listen for plugin events
        pluginManager.on('plugin:loaded', (plugin: any) => {
          console.log('Plugin loaded:', plugin.name)
        })
        
        pluginManager.on('plugin:error', (error: any) => {
          console.error('Plugin error:', error)
        })
        
        pluginManager.on('validation:results', (results: any) => {
          console.log('Validation results:', results)
        })
        
        pluginManager.on('export:success', (result: any) => {
          console.log('Export success:', result)
        })
        
      } catch (error) {
        console.error('Failed to initialize plugin system:', error)
      }
    }
    
    initializePlugins()
    
    return () => {
      // Cleanup plugin listeners
      pluginManager.removeAllListeners()
    }
  }, []);

  useEffect(() => {
    // Initialize collaborative editing when user is available
    const initializeCollaboration = async () => {
      if (user && currentProject) {
        try {
          const collaborativeUser = {
            id: user.id,
            name: (user as any).user_metadata?.full_name || user.email || 'Anonymous',
            email: user.email || '',
            avatar: (user as any).user_metadata?.avatar_url,
            color: generateUserColor(user.id),
            isActive: true,
            lastSeen: Date.now()
          }

          const connected = await collaborativeEditor.connect(collaborativeUser, currentProject.id)
          
          if (connected) {
            console.log('Connected to collaborative editing')
            
            // Listen for collaborative events
            collaborativeEditor.on('user:joined', (user: any) => {
              setCollaborativeUsers(prev => [...prev.filter((u: any) => u.id !== user.id), user])
            })
            
            collaborativeEditor.on('user:left', (user: any) => {
              setCollaborativeUsers(prev => prev.filter((u: any) => u.id !== user.id))
            })
            
            collaborativeEditor.on('session:joined', (session: any) => {
              setCollaborativeUsers(Array.from(session.users.values()))
            })
            
            collaborativeEditor.on('operation:received', (operation) => {
              // Handle received operations
              console.log('Received collaborative operation:', operation)
            })
          }
        } catch (error) {
          console.error('Failed to initialize collaborative editing:', error)
        }
      }
    }

    initializeCollaboration()
    
    return () => {
      // Cleanup collaborative editing
      collaborativeEditor.disconnect()
    }
  }, [user, currentProject]);

  // Helper function to generate consistent user colors
  const generateUserColor = (userId: string): string => {
    const colors = [
      '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
      '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1'
    ]
    
    let hash = 0
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash)
    }
    
    return colors[Math.abs(hash) % colors.length]
  }

  const loadComponents = async () => {
    try {
      const { data: existingComponents } = await supabase
        .from('components')
        .select('*')
        .eq('is_standard', true)
        .limit(1);

      if (!existingComponents || existingComponents.length === 0) {
        const componentsToInsert = standardComponents.map(comp => ({
          ...comp,
          user_id: null,
        }));

        const { error: insertError } = await supabase
          .from('components')
          .insert(componentsToInsert);

        if (insertError) console.error('Error inserting components:', insertError);
      }

      const { data, error } = await supabase
        .from('components')
        .select('*')
        .order('category', { ascending: true });

      if (error) throw error;
      setComponents((data || []) as unknown as Component[]);
    } catch (error) {
      console.error('Error loading components:', error);
    }
  };

  const handleNewProject = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          name: `New Project ${new Date().toLocaleDateString()}`,
          description: 'Circuit design project',
        })
        .select()
        .single();

      if (error) throw error;

      const { error: schematicError } = await supabase
        .from('schematics')
        .insert({
          project_id: data.id,
          name: 'Main Schematic',
          order_index: 0,
        })
        .select()
        .single();

      if (schematicError) throw schematicError;

      setCurrentProject(data);
      setShowProjectManager(false);
    } catch (error) {
      console.error('Error creating project:', error);
    }
  };

  const handleSelectProject = async (project: Project) => {
    setCurrentProject(project);
    setShowProjectManager(false);

    try {
      const { data: schematics } = await supabase
        .from('schematics')
        .select('*')
        .eq('project_id', project.id)
        .order('order_index', { ascending: true })
        .limit(1)
        .single();

      if (schematics) {
        setCurrentSchematic(schematics);
        setCanvasData(schematics.canvas_data ?? null);
      }
    } catch (error) {
      console.error('Error loading schematic:', error);
    }
  };

  const handleSave = async (data: Record<string, unknown>) => {
    if (!currentProject) return;

    try {
      const { data: schematic } = await supabase
        .from('schematics')
        .select('id')
        .eq('project_id', currentProject.id)
        .order('order_index', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (schematic) {
        const { error } = await supabase
          .from('schematics')
          .update({
            canvas_data: data,
            updated_at: new Date().toISOString(),
          })
          .eq('id', schematic.id);

        if (error) throw error;

        await supabase
          .from('projects')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', currentProject.id);

        markClean();
        console.log('Project saved successfully!');
      }
    } catch (error) {
      console.error('Error saving:', error);
      alert('Error saving project');
    }
  };

  const handleExportImage = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas || !currentProject) return;

    const dataUrl = exportToImage(canvas);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${currentProject.name}.png`;
    link.click();
    setShowExportMenu(false);
  };

  const handleExportNetlist = () => {
    if (!canvasData || !currentProject) return;

    const netlist = exportToNetlist(
      (canvasData.components as PlacedComponent[]) || [],
      (canvasData.wires as Wire[]) || [],
      currentProject.name
    );
    downloadFile(netlist, `${currentProject.name}.net`, 'text/plain');
    setShowExportMenu(false);
  };

  const handleExportJSON = () => {
    if (!canvasData || !currentProject) return;

    const json = exportToJSON(
      (canvasData.components as PlacedComponent[]) || [],
      (canvasData.wires as Wire[]) || [],
      currentProject.name
    );
    downloadFile(json, `${currentProject.name}.json`, 'application/json');
    setShowExportMenu(false);
  };

  const handleExportBOM = () => {
    if (!canvasData || !currentProject) return;

    const bom = exportToBOM((canvasData.components as PlacedComponent[]) || []);
    downloadFile(bom, `${currentProject.name}_BOM.txt`, 'text/plain');
    setShowExportMenu(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setCurrentProject(null);
    setCurrentSchematic(null);
    setCanvasData(null);
  };
  
  const toggleTheme = () => {
    const newTheme = settings.theme === 'light' ? 'dark' : settings.theme === 'dark' ? 'professional' : 'light';
    updateSettings({ theme: newTheme });
    document.documentElement.className = newTheme === 'light' ? '' : newTheme;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthForm onAuthSuccess={() => {}} />;
  }

  if (!currentProject || showProjectManager) {
    return (
      <div className="min-h-screen bg-background">
        <header className="bg-card border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Cpu className="w-8 h-8 text-primary" />
              <h1 className="text-2xl font-bold text-foreground">Engineering IDE Pro</h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={toggleTheme}>
                <Palette className="w-4 h-4" />
              </Button>
              <Button variant="ghost" onClick={handleSignOut} className="flex items-center gap-2">
                <LogOut size={16} />
                Sign Out
              </Button>
            </div>
          </div>
        </header>
        <ProjectManager
          onSelectProject={handleSelectProject}
          onNewProject={handleNewProject}
        />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => setShowProjectManager(true)} title="Projects">
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleSidebar} title="Toggle Sidebar">
            <Menu className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-lg font-bold text-foreground">{currentProject.name}</h1>
              {isDirty && <span className="text-xs text-orange-500">• Unsaved changes</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={toggleAiChat} title="AI Assistant">
            <Bot className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleSimulationPanel} title="Simulation">
            <BarChart3 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={togglePropertiesPanel} title="Properties">
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowPluginPanel(true)} title="Plugins">
            <Package className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowCollaborativePanel(true)} title="Collaboration">
            <Users className="w-4 h-4" />
          </Button>
          
          <div className="relative">
            <Button
              onClick={() => setShowExportMenu(!showExportMenu)}
              variant="default"
              size="sm"
              className="flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </Button>

            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-card rounded-lg shadow-xl border border-border py-2 z-50">
                <button
                  onClick={handleExportImage}
                  className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm"
                >
                  <Image size={16} />
                  Export as Image
                </button>
                <button
                  onClick={handleExportNetlist}
                  className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm"
                >
                  <FileText size={16} />
                  Export Netlist
                </button>
                <button
                  onClick={handleExportJSON}
                  className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm"
                >
                  <FileText size={16} />
                  Export JSON
                </button>
                <button
                  onClick={handleExportBOM}
                  className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm"
                >
                  <List size={16} />
                  Bill of Materials
                </button>
              </div>
            )}
          </div>

          <Button variant="ghost" size="icon" onClick={toggleTheme} title="Toggle Theme">
            <Palette className="w-4 h-4" />
          </Button>
          
          <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign Out">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar with Component Library */}
        {sidebarOpen && (
          <div className="w-80 bg-card border-r border-border flex flex-col">
            <ComponentLibrary
              components={components}
              onSelectComponent={(component) => {
                // Handle component selection for placement
                console.log('Selected component:', component);
              }}
              selectedComponent={null}
            />
          </div>
        )}

        {/* Main Canvas Area */}
        <div className="flex-1 flex flex-col">
          {/* Toolbar */}
          <Toolbar
            onToolChange={(tool) => console.log('Tool changed:', tool)}
            onAction={(action) => {
              switch (action) {
                case 'save':
                  handleSave(canvasData);
                  break;
                case 'undo':
                  // Handle undo
                  break;
                case 'redo':
                  // Handle redo
                  break;
                case 'start-simulation':
                  toggleSimulationPanel();
                  break;
                case 'stop-simulation':
                  toggleSimulationPanel();
                  break;
                default:
                  console.log('Action:', action);
              }
            }}
            canUndo={false}
            canRedo={false}
            isSimulating={false}
          />
          
          {/* Canvas */}
          <div className="flex-1 relative">
            <SchematicCanvas
              components={components}
              onSave={(data) => handleSave(data ?? {})}
            />
            
            {/* User Presence Overlay */}
            <UserPresence
              users={collaborativeUsers}
              showCursors={showCursors}
              showSelections={showSelections}
              canvasRef={{ current: null }} // This would be the actual canvas ref
            />
          </div>
        </div>

        {/* Right Panels */}
        <div className="flex">
          {propertiesPanelOpen && selectedComponentForProps && (
            <div className="w-80">
              <PropertiesPanel
                component={selectedComponentForProps as never}
                onUpdate={() => {}}
                onClose={() => setSelectedComponentForProps(null)}
              />
            </div>
          )}
          
          {simulationPanelOpen && (
            <div className="w-96">
              <SimulationPanel onClose={toggleSimulationPanel} />
            </div>
          )}
          
          {aiChatOpen && (
            <div className="w-96">
              <AIChatPanel onClose={toggleAiChat} />
            </div>
          )}
          
          {showCollaborativePanel && (
            <CollaborativePanel onClose={() => setShowCollaborativePanel(false)} />
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="flex items-center gap-4">
          <span>Components: {components.length}</span>
          <span>Theme: {settings.theme}</span>
          <span>Grid: {settings.gridSize}px</span>
          {isDirty && <span className="text-orange-500">Unsaved changes</span>}
        </div>
      </div>

      {/* Plugin Panel */}
      {showPluginPanel && (
        <PluginPanel onClose={() => setShowPluginPanel(false)} />
      )}
    </div>
  );
}

export default App;
