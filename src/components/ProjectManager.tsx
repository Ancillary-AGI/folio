import React, { useState, useEffect, useCallback } from 'react'
import { supabase, Project } from '../lib/supabase'
import { offlineProjectStore } from '../lib/offlineProjectStore'
import { vcsService } from '../lib/vcs/vcsService'
import { backupService } from '../lib/backup/backupService'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Plus, FolderOpen, Calendar, History, RotateCw, Search, Trash2, ArrowRight } from 'lucide-react'

interface ProjectManagerProps {
  onSelectProject: (project: Project) => void
  onNewProject: () => void
  offlineMode?: boolean
}

export default function ProjectManager({ onSelectProject, onNewProject, offlineMode = false }: ProjectManagerProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    try {
      if (offlineMode) {
        setProjects(offlineProjectStore.list())
        return
      }
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false })

      if (error) throw error
      setProjects(data || [])
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'Could not load projects.')
    } finally {
      setLoading(false)
    }
  }, [offlineMode])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  /*
   * A failed read is not an empty workspace: the list has to say what went wrong
   * and offer to try again, instead of inviting the engineer to create a project
   * while their existing ones sit unreachable.
   */
  const retryLoad = () => {
    setProjectError(null)
    setLoading(true)
    void loadProjects()
  }

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (!confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      return
    }

    if (offlineMode) {
      offlineProjectStore.delete(projectId)
      vcsService.removeRepo(projectId)
      backupService.deleteProjectBackups(projectId)
      setProjects((current) => current.filter((project) => project.id !== projectId))
      return
    }

    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId)

      if (error) throw error

      // History and backups live in this browser even when the project row was
      // cloud-owned, so deleting the project must purge them too.
      vcsService.removeRepo(projectId)
      backupService.deleteProjectBackups(projectId)
      setProjects(projects.filter(p => p.id !== projectId))
    } catch (error) {
      setProjectError(
        `Could not delete the project: ${error instanceof Error ? error.message : 'unknown error'}`,
      )
    }
  }

  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    project.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // A read that failed with nothing to show is a different state from a search
  // that matched nothing, and different again from a workspace with no projects.
  const listFailure = projectError !== null && projects.length === 0

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted-foreground">Loading projects...</div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-8">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Folio workbench</p>
        <h1 className="mb-2 text-2xl font-bold text-foreground sm:text-3xl">Your Projects</h1>
        <p className="max-w-2xl text-muted-foreground">
          {offlineMode
            ? 'Schematic, PCB, mechanical, robotics and firmware state for every project lives on this device.'
            : 'Project rows live in your cloud workspace; version history and backups stay in this browser.'}
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Supported disciplines">
          {['Schematic', 'PCB', '3D preview', 'Simulation', 'Mechanical', 'HDL / IC', 'Robotics', 'Operations'].map((discipline) => (
            <li
              key={discipline}
              className="rounded-sm border border-border bg-surface px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
            >
              {discipline}
            </li>
          ))}
        </ul>
      </div>

      {projectError && !listFailure && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <span>{projectError}</span>
          <button
            type="button"
            onClick={() => setProjectError(null)}
            className="text-xs font-semibold underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search projects..."
            aria-label="Search projects"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-border bg-background py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        
        <Button onClick={onNewProject} className="flex flex-shrink-0 items-center gap-2">
          <Plus className="w-4 h-4" />
          New Project
        </Button>
      </div>

      {listFailure ? (
        <Card className="text-center py-12">
          <CardContent>
            <FolderOpen className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">The project list could not be read</h3>
            <p className="mx-auto mb-4 max-w-md text-muted-foreground">{projectError}</p>
            <Button variant="outline" onClick={retryLoad} className="mx-auto flex items-center gap-2">
              <RotateCw className="w-4 h-4" />
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : filteredProjects.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <FolderOpen className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {searchTerm ? 'No projects found' : 'No projects yet'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm 
                ? 'Try adjusting your search terms'
                : 'Create your first engineering project — from circuit to enclosure — to get started'
              }
            </p>
            {!searchTerm && (
              <Button onClick={onNewProject} className="flex items-center gap-2 mx-auto">
                <Plus className="w-4 h-4" />
                Create Project
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map((project) => {
            // Commit history is device-local even for a cloud row, so this is the
            // revision count on this browser — not the project's whole history.
            const repo = vcsService.getRepo(project.id)
            const revisionCount = repo ? Object.keys(repo.commits).length : 0
            const historyTitle = repo
              ? `${revisionCount} ${revisionCount === 1 ? 'commit' : 'commits'} on branch ${repo.currentBranch}, stored in this browser`
              : 'No commit has been taken from this browser for this project'
            return (
            <Card
              key={project.id}
              className="cursor-pointer transition-all hover:border-primary/40 hover:shadow-lg"
              onClick={() => onSelectProject(project)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-lg font-semibold truncate">
                    {project.name}
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${project.name}`}
                    onClick={(e) => handleDeleteProject(project.id, e)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                {project.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {project.description}
                  </p>
                )}
              </CardHeader>
              
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1" title="Last modified on this device">
                    <Calendar className="w-3 h-3" />
                    {new Date(project.updated_at).toLocaleDateString()}
                  </div>
                  <div
                    className="flex items-center gap-1"
                    title={historyTitle}
                  >
                    <History className="w-3 h-3" />
                    {repo
                      ? `${revisionCount} local revision${revisionCount === 1 ? '' : 's'} · ${repo.currentBranch}`
                      : 'No local history'}
                  </div>
                </div>
                
                <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-xs text-muted-foreground">
                    Last modified{' '}
                    <span className="font-medium text-foreground">
                      {new Date(project.updated_at).toLocaleTimeString()}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-xs text-primary hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectProject(project)
                    }}
                    aria-label={`Open ${project.name}`}
                  >
                    Open <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}