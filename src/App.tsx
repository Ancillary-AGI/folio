import { useState, useEffect } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase, Project, Component } from './lib/supabase';
import { standardComponents } from './lib/componentLibrary';
import AuthForm from './components/AuthForm';
import ProjectManager from './components/ProjectManager';
import SchematicCanvas from './components/SchematicCanvas';
import PropertiesPanel from './components/PropertiesPanel';
import { Download, FileText, Image, List, LogOut, Menu, X } from 'lucide-react';
import { exportToImage, exportToNetlist, exportToJSON, exportToBOM, downloadFile } from './lib/exportUtils';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [components, setComponents] = useState<Component[]>([]);
  const [canvasData, setCanvasData] = useState<any>(null);
  const [selectedComponentForProps, setSelectedComponentForProps] = useState<any>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      loadComponents();
    }
  }, [user]);

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
      setComponents(data || []);
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

      const { data: schematic, error: schematicError } = await supabase
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
        setCanvasData(schematics.canvas_data);
      }
    } catch (error) {
      console.error('Error loading schematic:', error);
    }
  };

  const handleSave = async (data: any) => {
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

        alert('Project saved successfully!');
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
      canvasData.components || [],
      canvasData.wires || [],
      currentProject.name
    );
    downloadFile(netlist, `${currentProject.name}.net`, 'text/plain');
    setShowExportMenu(false);
  };

  const handleExportJSON = () => {
    if (!canvasData || !currentProject) return;

    const json = exportToJSON(
      canvasData.components || [],
      canvasData.wires || [],
      currentProject.name
    );
    downloadFile(json, `${currentProject.name}.json`, 'application/json');
    setShowExportMenu(false);
  };

  const handleExportBOM = () => {
    if (!canvasData || !currentProject) return;

    const bom = exportToBOM(canvasData.components || []);
    downloadFile(bom, `${currentProject.name}_BOM.txt`, 'text/plain');
    setShowExportMenu(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setCurrentProject(null);
    setCanvasData(null);
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
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Circuit CAD</h1>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <LogOut size={20} />
              Sign Out
            </button>
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
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowProjectManager(true)}
            className="p-2 hover:bg-gray-100 rounded-lg"
            title="Projects"
          >
            <Menu size={20} className="text-gray-700" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{currentProject.name}</h1>
            {currentProject.description && (
              <p className="text-sm text-gray-600">{currentProject.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Download size={20} />
              Export
            </button>

            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                <button
                  onClick={handleExportImage}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3"
                >
                  <Image size={18} className="text-gray-600" />
                  <span>Export as Image</span>
                </button>
                <button
                  onClick={handleExportNetlist}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3"
                >
                  <FileText size={18} className="text-gray-600" />
                  <span>Export Netlist</span>
                </button>
                <button
                  onClick={handleExportJSON}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3"
                >
                  <FileText size={18} className="text-gray-600" />
                  <span>Export JSON</span>
                </button>
                <button
                  onClick={handleExportBOM}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3"
                >
                  <List size={18} className="text-gray-600" />
                  <span>Bill of Materials</span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleSignOut}
            className="p-2 hover:bg-gray-100 rounded-lg"
            title="Sign Out"
          >
            <LogOut size={20} className="text-gray-700" />
          </button>
        </div>
      </header>

      <div className="flex-1 relative">
        <SchematicCanvas
          components={components}
          onSave={handleSave}
        />
        {selectedComponentForProps && (
          <PropertiesPanel
            component={selectedComponentForProps}
            onUpdate={() => {}}
            onClose={() => setSelectedComponentForProps(null)}
          />
        )}
      </div>
    </div>
  );
}

export default App;
