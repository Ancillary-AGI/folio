import HoverHelp from './ui/HoverHelp'
import React, { useState, useEffect, useCallback } from 'react'
import { supabase, Project } from '../lib/supabase'
import { offlineProjectStore } from '../lib/offlineProjectStore'
import { vcsService } from '../lib/vcs/vcsService'
import { backupService } from '../lib/backup/backupService'
import { describeError } from '../lib/utils'
import EditableProjectTitle from './EditableProjectTitle'
import { Button } from './ui/button'
import ConfirmDialog from './ui/ConfirmDialog'
import { useConfirm } from './ui/useConfirm'
import { Card, CardContent, CardHeader } from './ui/card'
import {
  ArrowRight, ArrowUpRight, Calendar, CircuitBoard, Code2, FlaskConical,
  FolderOpen, History, Layers, Microscope, Plus, RotateCw, Search, ShieldCheck,
  Trash2, Wrench, X, Zap,
  type LucideIcon,
} from 'lucide-react'
import CopilotIcon from './workspace/CopilotIcon'
import { WORKSPACE_GROUPS, MODE_COUNT_BY_GROUP, WORKSPACE_MODE_META, FIRST_MODE_BY_GROUP, type WorkspaceGroupId } from '../lib/workspace/modes'
import { groupAccent } from '../lib/workspace/accents'
import { DEMO_SCENARIOS, type DemoScenario } from '../lib/demo/demoScenarios'

interface ProjectManagerProps {
  onSelectProject: (project: Project) => void
  /**
   * Creates a project. A family opens it in that family's first workspace; with
   * no family the shell keeps its default opening tab.
   */
  onNewProject: (family?: WorkspaceGroupId) => void
  /** Lets the shell re-title the workspace header when the open project is renamed here. */
  onProjectRenamed?: (project: Project) => void
  offlineMode?: boolean
  /** Opens the demo gallery. Omitted when the launcher has no gallery host. */
  onOpenDemos?: () => void
  /** Loads a scenario straight from the launcher (the shell creates the project). */
  onOpenDemo?: (scenario: DemoScenario) => void
  /**
   * Agent-first entry point: the composer submits a plain-language brief and
   * the shell creates a project from it, names it, and starts the assistant
   * with that brief already on the table.
   */
  onBriefSubmit?: (brief: string, scaffold: 'electronics' | 'embedded') => void
}

/** Icons for the five workspace families, matching the rail in the workbench. */
const FAMILY_ICONS: Readonly<Record<WorkspaceGroupId, LucideIcon>> = {
  design: Layers,
  electrical: Zap,
  mechanical: Wrench,
  life: Microscope,
  ops: ShieldCheck,
}

/** Brief chips the launcher offers — each is a real starting point, not a slogan. */
const IDEA_CHIPS = [
  'USB-C buck, 3.3 V @ 2 A, PCBWay 2-layer',
  'ESP32 plant monitor, BME280 over I2C',
  'Motor speed loop with encoder, PID-tuned',
] as const

/**
 * Scenarios the launcher can open directly. One per family that a newcomer can
 * understand from its title, so the empty state is a doorway instead of a wall.
 */
const FEATURED_DEMO_IDS = ['rectifier-pcb', 'control-motor-loop', 'mechanical-enclosure'] as const

/** A relative timestamp: precise on hover, glanceable in the list. */
function relativeTime(value: string | Date): string {
  const then = new Date(value).getTime()
  if (!Number.isFinite(then)) return 'Unknown'
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(value).toLocaleDateString()
}

export default function ProjectManager({ onSelectProject, onNewProject, onProjectRenamed, offlineMode = false, onOpenDemos, onOpenDemo, onBriefSubmit }: ProjectManagerProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [projectError, setProjectError] = useState<string | null>(null)
  const [brief, setBrief] = useState('')
  const [scaffold, setScaffold] = useState<'electronics' | 'embedded'>('electronics')
  // The one question this surface asks: a delete that cannot be undone.
  const { spec: confirmSpec, confirm, resolve: resolveConfirm } = useConfirm()

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
      setProjectError(describeError(error))
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

  /* The composer is a real doorway: a brief goes in, and the shell creates a
   * project, names it from the brief, and starts the assistant with it. If the
   * host cannot create projects (tests, embed), the composer is visible but
   * inert rather than dishonestly pretending to work. */
  const handleBriefSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const text = brief.trim()
    if (text.length < 3 || !onBriefSubmit) return
    onBriefSubmit(text, scaffold)
    setBrief('')
  }

  const handleDeleteProject = async (project: Project, e: React.MouseEvent) => {
    e.stopPropagation()

    /*
     * Deletion is the one launcher action that cannot be walked back, so it
     * asks in the app's own panel: the project's name is in the question, and
     * the answer says what goes with it. A declined answer performs no write at
     * all, and the card stays where it was.
     */
    const accepted = await confirm({
      title: `Delete “${project.name}”?`,
      detail:
        'The project is removed from this workspace, together with the version history and the backups stored with it. Nothing else of yours is touched, and there is no undo.',
      confirmLabel: 'Delete project',
      destructive: true,
    })
    if (!accepted) return

    const projectId = project.id
    if (offlineMode) {
      offlineProjectStore.delete(projectId)
      vcsService.removeRepo(projectId)
      backupService.deleteProjectBackups(projectId)
      setProjects((current) => current.filter((entry) => entry.id !== projectId))
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
      setProjects((current) => current.filter((entry) => entry.id !== projectId))
    } catch (error) {
      setProjectError(`Could not delete the project: ${describeError(error)}`)
    }
  }

  /*
   * Renaming writes the project's own row — the offline store, or the cloud row —
   * and tells the shell so an open workspace re-titles itself with it. The click
   * gesture lives in `EditableProjectTitle`, the same one the workspace header
   * uses; this is only the storage behind it, and it throws so the reason can be
   * shown under a name that did not change.
   */
  const renameProject = async (project: Project, nextName: string): Promise<void> => {
    if (offlineMode) {
      const updated = offlineProjectStore.rename(project.id, nextName)
      if (!updated) throw new Error('This project is no longer in the workspace.')
      setProjects((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
      onProjectRenamed?.(updated)
      return
    }

    const updatedAt = new Date().toISOString()
    const { error } = await supabase
      .from('projects')
      .update({ name: nextName, updated_at: updatedAt })
      .eq('id', project.id)

    if (error) throw new Error(`Could not rename the project: ${describeError(error)}`)

    const updated: Project = { ...project, name: nextName, updated_at: updatedAt }
    setProjects((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)))
    onProjectRenamed?.(updated)
  }

  const filteredProjects = projects.filter(project =>
    project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    project.description?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // A read that failed with nothing to show is a different state from a search
  // that matched nothing, and different again from a workspace with no projects.
  const listFailure = projectError !== null && projects.length === 0

  if (loading) {
    /*
     * The shape of what is coming, not a word in the middle of an empty page:
     * the hero, the family tiles and the cards all appear here in the sizes
     * they will occupy, so the wait reads as a library loading rather than as a
     * surface that has nothing in it.
     */
    return (
      <div className="launcher-column" role="status" aria-live="polite">
        <span className="sr-only">Loading your projects…</span>
        <div className="launcher-hero launcher-hero--skeleton">
          <div className="cad-skeleton mb-4 h-3 w-32" />
          <div className="cad-skeleton mb-3 h-10 w-2/3 max-w-md" />
          <div className="cad-skeleton mb-8 h-4 w-full max-w-xl" />
          <div className="cad-skeleton h-14 w-full rounded-xl" />
        </div>
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="cad-skeleton h-[124px] rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="rounded-xl border border-border bg-card p-5">
              <div className="cad-skeleton mb-3 h-5 w-3/5" />
              <div className="cad-skeleton mb-4 h-3 w-4/5" />
              <div className="cad-skeleton mb-2 h-3 w-2/5" />
              <div className="mt-6 flex justify-end gap-2">
                <div className="cad-skeleton h-7 w-20 rounded-md" />
                <div className="cad-skeleton h-7 w-20 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="launcher-column">
      {/* ── Hero: the one statement of what this place is, and the two doors
          into it. The ambient field passes through the glass. ─────────────── */}
      <section className="launcher-hero" aria-labelledby="launcher-heading">
        <div className="launcher-hero__aura" aria-hidden="true" />
        <div className="launcher-hero__layout">
          <div className="launcher-hero__copy">
            <p className="launcher-eyebrow">
              <span className="launcher-eyebrow__dot" aria-hidden="true" />
              Engineering workbench
            </p>
            <h1 id="launcher-heading" className="launcher-title">From first sketch to <span className="hero-accent">verified build.</span></h1>
            <p className="launcher-lede">
              Describe the board in one line — Copilot drafts the circuit,
              routes it, checks every handoff and hands you a fab package.
              You keep the engineering; it does the legwork.
            </p>

            <form className="launcher-composer" onSubmit={handleBriefSubmit} aria-label="Describe your project">
              <div className="launcher-composer__row">
                <CopilotIcon className="launcher-composer__orb" aria-hidden="true" />
                <textarea
                  rows={2}
                  autoFocus
                  value={brief}
                  onChange={(event) => setBrief(event.target.value)}
                  placeholder="Describe what you want to build"
                  aria-label="Describe your project"
                  className="launcher-composer__input"
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                />
                <HoverHelp title="Create from brief" description="Create a project from the description you typed. Ctrl+Enter works too.">
                  <button
                    type="submit"
                    className="launcher-composer__submit"
                    aria-label="Create from brief"
                    disabled={brief.trim().length < 3}
                  >
                    <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </HoverHelp>
              </div>
              <div className="launcher-composer__meta">
                <div className="launcher-composer__scaffold" role="group" aria-label="Project type">
                  <button
                    type="button"
                    className="launcher-composer__scaffold-option"
                    aria-pressed={scaffold === 'electronics'}
                    onClick={() => setScaffold('electronics')}
                  >
                    Electronics
                  </button>
                  <button
                    type="button"
                    className="launcher-composer__scaffold-option"
                    aria-pressed={scaffold === 'embedded'}
                    onClick={() => setScaffold('embedded')}
                  >
                    Electronics + firmware
                  </button>
                </div>
                <div className="launcher-composer__suggestions" aria-label="Example briefs">
                  {IDEA_CHIPS.map((idea) => (
                    <button
                      key={idea}
                      type="button"
                      className="launcher-composer__suggestion"
                      onClick={() => setBrief(idea)}
                    >
                      {idea}
                    </button>
                  ))}
                </div>
              </div>
            </form>

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Find a project by name or description"
                  aria-label="Search projects"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="launcher-search"
                />
                {searchTerm ? (
                  <HoverHelp title="Clear search" description="Empty the search box.">
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      aria-label="Clear project search"
                      className="cad-ctl cad-ctl--icon absolute right-3 top-1/2 -translate-y-1/2"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </HoverHelp>
                ) : null}
                <span className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 font-mono text-xs tabular-nums text-muted-foreground">
                  {searchTerm ? `${filteredProjects.length}/${projects.length}` : ''}
                </span>
              </div>

              <Button onClick={() => onNewProject()} className="h-12 flex-shrink-0 gap-2 rounded-xl px-5 text-sm font-semibold">
                <Plus className="h-4 w-4" />
                New Project
              </Button>
              {onOpenDemos ? (
                <Button
                  variant="outline"
                  onClick={onOpenDemos}
                  className="h-12 flex-shrink-0 gap-2 rounded-xl px-4 text-sm"
                >
                  <FlaskConical className="h-4 w-4" aria-hidden="true" />
                  Explore designs
                </Button>
              ) : null}
            </div>
          </div>

          <div className="launcher-hero__visual" role="img" aria-label="Engineering disciplines connected through one shared product model">
            <div className="launcher-hero__visual-head">
              <span>ONE PRODUCT · CONNECTED DISCIPLINES</span>
              <span className="launcher-hero__live"><span aria-hidden="true" /> SHARED DESIGN DATA</span>
            </div>
            <div className="launcher-hero__diagram" aria-hidden="true">
              <svg viewBox="0 0 480 206" role="presentation">
                <path className="launcher-diagram__trace" d="M75 48h88v50h76m0 0h60V54h105M163 98v58h87m49-58v58h105" />
                <path className="launcher-diagram__trace launcher-diagram__trace--soft" d="M75 48v108h88m-88 0h-26m336-102v102h-42" />
                <circle className="launcher-diagram__node" cx="75" cy="48" r="7" />
                <circle className="launcher-diagram__node" cx="239" cy="98" r="9" />
                <circle className="launcher-diagram__node" cx="404" cy="54" r="7" />
                <circle className="launcher-diagram__node" cx="163" cy="156" r="6" />
                <circle className="launcher-diagram__node" cx="299" cy="156" r="6" />
                <circle className="launcher-diagram__node" cx="404" cy="156" r="6" />
                <rect className="launcher-diagram__chip" x="202" y="61" width="74" height="74" rx="13" />
                <path className="launcher-diagram__chipline" d="M217 86h44M217 98h30M217 110h38" />
                <path className="launcher-diagram__pin" d="M218 61v-8m14 8v-8m14 8v-8m14 8v-8m-42 90v-8m14 8v-8m14 8v-8m14 8v-8m-72-45h-8m-54 0h-8m174 0h-8m-8 0h-8m94-44h-8m-8 0h-8" />
                <circle className="launcher-diagram__pulse" cx="239" cy="98" r="23" />
              </svg>
              <div className="launcher-hero__core">
                <span className="launcher-hero__core-icon"><Layers aria-hidden="true" /></span>
                <span><strong>Product model</strong><small>One source of truth</small></span>
              </div>
            </div>
            <div className="launcher-hero__domains">
              <span><CircuitBoard aria-hidden="true" /> Electronics</span>
              <span><Wrench aria-hidden="true" /> Mechanical</span>
              <span><Code2 aria-hidden="true" /> Firmware</span>
              <span><ShieldCheck aria-hidden="true" /> Verification</span>
            </div>
          </div>
        </div>

      </section>

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

      {listFailure && (
        <Card className="launcher-empty text-center py-12">
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
      )}

      {!listFailure && filteredProjects.length > 0 && (
        <section className="launcher-projects" aria-labelledby="projects-list-heading">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 id="projects-list-heading" className="launcher-section-title">
              {searchTerm ? 'Matching projects' : 'Pick up where you left off'}
            </h2>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {filteredProjects.length} of {projects.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {filteredProjects.map((project) => {
            // Commit history is kept with the local workspace even for a cloud row,
            // so this is the revision count available here — not the project's
            // whole history on other machines.
            const repo = vcsService.getRepo(project.id)
            const revisionCount = repo ? Object.keys(repo.commits).length : 0
            const historyTitle = repo
              ? `${revisionCount} ${revisionCount === 1 ? 'commit' : 'commits'} on branch ${repo.currentBranch}, stored with the project`
              : 'No commit has been taken for this project yet'
            const monogram = project.name.trim().charAt(0).toUpperCase() || 'P'
            return (
            <Card
              key={project.id}
              className="project-card launcher-project group"
              role="button"
              tabIndex={0}
              aria-label={`Open ${project.name}`}
              onClick={() => onSelectProject(project)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectProject(project)
                }
              }}
            >
              {/* Whole card is the open target — the one thing it is not is a
                  button, and the corner carries the only other decision here.
                  Out of the reading flow, out of the drop target, named for
                  its job. */}
              <HoverHelp title="Delete this project" description="Delete this project">
<Button variant="ghost"
                size="bar-icon"
                className="launcher-project__delete"
                aria-label={`Delete ${project.name}`} onClick={(e) => handleDeleteProject(project, e)}
              >
                <Trash2 />
              </Button>
</HoverHelp>

              <CardHeader className="gap-3 pb-3 pr-8">
                <div className="flex items-start gap-3">
                  <span className="launcher-project__monogram" aria-hidden="true">
                    {monogram}
                  </span>
                  <div className="min-w-0 flex-1">
                    {/* The name is the control: click it, type, click away or press
                        Enter and the write happens. The rest of the card opens the
                        project, so a click on the title must not do both. */}
                    <EditableProjectTitle
                      headingLevel="h3"
                      stopClickPropagation
                      name={project.name}
                      onRename={(nextName) => renameProject(project, nextName)}
                      titleClassName="text-base font-semibold"
                      inputClassName="text-[15px]"
                    />
                    {project.description && (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {project.description}
                      </p>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                {/* Each fact once: the row's last write, and the commit history the
                    workspace really holds for this project. */}
                <div className="launcher-project__facts">
                  <div className="flex items-center gap-1" title={new Date(project.updated_at).toLocaleString()}>
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    {relativeTime(project.updated_at)}
                  </div>
                  <div
                    className="flex items-center gap-1"
                    title={historyTitle}
                  >
                    <History className="w-3 h-3" aria-hidden="true" />
                    {repo
                      ? `${revisionCount} revision${revisionCount === 1 ? '' : 's'} · ${repo.currentBranch}`
                      : 'No revisions yet'}
                  </div>
                  {/* The whole card is the target; this hint just says so. */}
                  <span className="launcher-project__open-hint" aria-hidden="true">
                    Open
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </span>
                </div>
              </CardContent>
            </Card>
            )
          })}
          </div>
        </section>
      )}

      {/*
       * Keep discovery after a project's recent work in both visual and
       * document order, so keyboard and screen-reader navigation tell the same
       * story as the page.
       */}
      <section className="launcher-family-section mb-10" aria-labelledby="family-start-heading">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="family-start-heading" className="launcher-section-title">
            Start in a family
          </h2>
          <p className="text-xs text-muted-foreground">
            Creates a project and opens the first workspace of that family.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {WORKSPACE_GROUPS.map((family) => {
            const firstMode = WORKSPACE_MODE_META[FIRST_MODE_BY_GROUP[family.id]]
            const workspaceCount = MODE_COUNT_BY_GROUP[family.id]
            const FamilyIcon = FAMILY_ICONS[family.id]
            return (
              <li key={family.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onNewProject(family.id)}
                  className="family-tile"
                  style={{ '--family-accent': groupAccent(family.id) } as React.CSSProperties}
                  aria-label={`Start a project in the ${family.label} family, opening ${firstMode.label} first`}
                >
                  <span className="family-tile__top">
                    <span className="family-tile__icon" aria-hidden="true">
                      <FamilyIcon />
                    </span>
                    <span className="family-tile__count-badge">{workspaceCount}</span>
                  </span>
                  <span className="family-tile__label">{family.label}</span>
                  <span className="family-tile__desc">{family.description}</span>
                  <span className="family-tile__foot">
                    Opens {firstMode.label}
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      {onOpenDemo ? (
        <section className="launcher-featured-section mb-10" aria-labelledby="featured-demos-heading">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id="featured-demos-heading" className="launcher-section-title">
                Start from a running design
              </h2>
              <p className="text-xs text-muted-foreground">
                Every demo runs the real solver, router or exporter.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenDemos}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary transition-colors hover:text-foreground"
            >
              All {DEMO_SCENARIOS.length} demos
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {FEATURED_DEMO_IDS.map((id) => {
              const scenario = DEMO_SCENARIOS.find((entry) => entry.id === id)
              if (!scenario) return null
              const modeMeta = WORKSPACE_MODE_META[scenario.mode]
              return (
                <li key={scenario.id} className="min-w-0">
                  <article
                    className="launcher-demo"
                    style={{ '--family-accent': groupAccent(scenario.group) } as React.CSSProperties}
                  >
                    <div className="launcher-demo__top">
                      <span className="launcher-demo__mode">
                        <CircuitBoard className="h-3.5 w-3.5" aria-hidden="true" />
                        {modeMeta.label}
                      </span>
                    </div>
                    <h3 className="launcher-demo__title">{scenario.title}</h3>
                    <p className="launcher-demo__summary">{scenario.summary}</p>
                    <button
                      type="button"
                      onClick={() => onOpenDemo(scenario)}
                      className="launcher-demo__open"
                      aria-label={`Open demo: ${scenario.title}`}
                    >
                      Open demo
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </article>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}

      {!listFailure && filteredProjects.length === 0 && (
        <Card className="launcher-empty">
          <CardContent>
            <span className="launcher-empty__mark" aria-hidden="true">
              <FolderOpen />
            </span>
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {searchTerm ? 'No projects found' : 'No projects yet'}
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              {searchTerm
                ? 'Try adjusting your search terms'
                : 'Start with a blank project, choose an engineering family above, or open a tested design.'}
            </p>
            {!searchTerm && (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button onClick={() => onNewProject()} className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Create Project
                </Button>
                {onOpenDemos ? (
                  <Button variant="outline" onClick={onOpenDemos} className="flex items-center gap-2">
                    <FlaskConical className="w-4 h-4" aria-hidden="true" />
                    Browse demos
                  </Button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* The delete question is asked here, in the app's own panel. */}
      <ConfirmDialog spec={confirmSpec} onResolve={resolveConfirm} />
    </div>
  )
}
