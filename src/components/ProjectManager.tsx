import React, { useState, useEffect } from 'react';
import { FolderOpen, Plus, Trash2, Edit2, Save } from 'lucide-react';
import { supabase, Project } from '../lib/supabase';

interface ProjectManagerProps {
  onSelectProject: (project: Project) => void;
  onNewProject: () => void;
}

export default function ProjectManager({ onSelectProject, onNewProject }: ProjectManagerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setProjects(data || []);
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', id);

      if (error) throw error;
      setProjects(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      console.error('Error deleting project:', error);
    }
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;

    try {
      const { error } = await supabase
        .from('projects')
        .update({ name: editName, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
      setProjects(prev => prev.map(p => p.id === id ? { ...p, name: editName } : p));
      setEditingId(null);
      setEditName('');
    } catch (error) {
      console.error('Error renaming project:', error);
    }
  };

  const startEdit = (project: Project) => {
    setEditingId(project.id);
    setEditName(project.name);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading projects...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Your Projects</h2>
        <button
          onClick={onNewProject}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          <Plus size={20} />
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16">
          <FolderOpen size={64} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
          <p className="text-gray-500 mb-6">Create your first circuit design project</p>
          <button
            onClick={onNewProject}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            <Plus size={20} />
            Create Project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => (
            <div
              key={project.id}
              className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
            >
              <div
                className="h-40 bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center cursor-pointer"
                onClick={() => onSelectProject(project)}
              >
                {project.thumbnail ? (
                  <img src={project.thumbnail} alt={project.name} className="w-full h-full object-cover" />
                ) : (
                  <FolderOpen size={48} className="text-gray-300" />
                )}
              </div>

              <div className="p-4">
                {editingId === project.id ? (
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(project.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                    />
                    <button
                      onClick={() => handleRename(project.id)}
                      className="p-1 text-green-600 hover:text-green-700"
                    >
                      <Save size={16} />
                    </button>
                  </div>
                ) : (
                  <h3
                    className="text-lg font-semibold text-gray-900 mb-2 cursor-pointer hover:text-blue-600"
                    onClick={() => onSelectProject(project)}
                  >
                    {project.name}
                  </h3>
                )}

                {project.description && (
                  <p className="text-sm text-gray-600 mb-3 line-clamp-2">{project.description}</p>
                )}

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Updated {new Date(project.updated_at).toLocaleDateString()}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(project)}
                      className="p-1 text-blue-600 hover:text-blue-700"
                      title="Rename"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(project.id)}
                      className="p-1 text-red-600 hover:text-red-700"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
