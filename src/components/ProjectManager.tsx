import React, { useState, useEffect, useCallback } from 'react'
import { supabase, Project } from '../lib/supabase'
import { offlineProjectStore } from '../lib/offlineProjectStore'
import { vcsService } from '../lib/vcs/vcsService'
import { backupService } from '../lib/backup/backupService'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Plus, FolderOpen, Calendar, History, RotateCw, Search, Trash2, ArrowRight, X } from 'lucide-react'
import { WORKSPACE_GROUPS, MODE_COUNT_BY_GROUP } from '../lib/workspace/modes'
import { groupAccent } from '../lib/workspace/accents'

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

      // History and backups live in workspace storage even when the project row
      // was cloud-owned, so deleting the project must purge them too.
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
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">Project library</p>
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Your Projects</h1>
        <p className="max-w-2xl text-muted-foreground">
          {offlineMode
            ? 'Schematic, PCB, mechanical, robotics and firmware state for every project is kept together.'
            : 'Projects are stored in your cloud workspace; version history and backups are kept with each project.'}
        </p>
        {/*
         * The families come from the same registry that drives the workspace tab
         * strip, and each count is derived from it, so a workspace cannot ship in
         * the CAD and go missing from here. The hue is decorative — the label and
         * the count carry the meaning.
         */}
        <ul className="mt-5 flex flex-wrap gap-2" aria-label="Engineering families">
          {WORKSPACE_GROUPS.map((family) => (
            <li
              key={family.id}
              title={family.description}
              className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium"
              style={{
                backgroundColor: `hsl(${groupAccent(family.id)} / 0.10)`,
                borderColor: `hsl(${groupAccent(family.id)} / 0.30)`,
              }}
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: `hsl(${groupAccent(family.id)})` }}
              />
              <span className="text-foreground">{family.label}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{MODE_COUNT_BY_GROUP[family.id]}</span>
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

      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search projects by name or description"
            aria-label="Search projects"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-12 w-full rounded-xl border border-border bg-surface pl-11 pr-24 text-[15px] text-foreground placeholder:text-muted-foreground"
          />
          {searchTerm ? (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Clear project search"
              className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          {/* The field says what it filtered, so the count is never a guess. */}
          <span className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 font-mono text-xs tabular-nums text-muted-foreground">
            {searchTerm ? `${filteredProjects.length}/${projects.length}` : ''}
          </span>
        </div>

        <Button onClick={onNewProject} className="h-12 flex-shrink-0 gap-2 rounded-xl px-5 text-sm font-semibold">
          <Plus className="h-4 w-4" />
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
            // Commit history is kept with the local workspace even for a cloud row,
            // so this is the revision count available here — not the project's
            // whole history on other machines.
            const repo = vcsService.getRepo(project.id)
            const revisionCount = repo ? Object.keys(repo.commits).length : 0
            const historyTitle = repo
              ? `${revisionCount} ${revisionCount === 1 ? 'commit' : 'commits'} on branch ${repo.currentBranch}, stored with the project`
              : 'No commit has been taken for this project yet'
            return (
            <Card
              key={project.id}
              className="cursor-pointer overflow-hidden rounded-xl border-border/70 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-xl active:translate-y-0 active:shadow-md"
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
                  <div className="flex items-center gap-1" title="Last modified">
                    <Calendar className="w-3 h-3" />
                    {new Date(project.updated_at).toLocaleDateString()}
                  </div>
                  <div
                    className="flex items-center gap-1"
                    title={historyTitle}
                  >
                    <History className="w-3 h-3" />
                    {repo
                      ? `${revisionCount} revision${revisionCount === 1 ? '' : 's'} · ${repo.currentBranch}`
                      : 'No revisions yet'}
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