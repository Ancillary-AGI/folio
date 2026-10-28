import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronUp, RotateCcw, X } from 'lucide-react'
import { Button } from '../ui/button'
import { WORKSPACE_MODE_META } from '../../lib/workspace/modes'
import {
  readTutorialProgress,
  writeTutorialProgress,
  type Tutorial,
  type TutorialProgress,
} from '../../lib/tutorials/tutorials'
import { useAppStore } from '../../stores/useAppStore'

interface TutorialRunnerProps {
  tutorial: Tutorial
  onClose: () => void
  /** Reloads the tutorial's demo without asking again. */
  onRestartDemo: () => void
  onOpenHelp: () => void
}

/**
 * Floating, non-modal tutorial card.
 *
 * It switches the workspace for each step and records where the engineer
 * stopped, but it never blocks the sheet: the point is to do the step, not to
 * read about it. The footer states plainly that steps are self-checked.
 */
export default function TutorialRunner({ tutorial, onClose, onRestartDemo, onOpenHelp }: TutorialRunnerProps) {
  const [index, setIndex] = useState(() => {
    const saved = readTutorialProgress(tutorial.id)
    return saved && !saved.completed ? Math.min(Math.max(saved.step, 0), tutorial.steps.length - 1) : 0
  })
  const [completed, setCompleted] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const step = tutorial.steps[index]
  const total = tutorial.steps.length

  useEffect(() => {
    useAppStore.getState().setWorkspaceMode(step.mode)
  }, [step.mode])

  const save = (next: number, done: boolean) => {
    const entry: TutorialProgress = { step: next, completed: done, updatedAt: new Date().toISOString() }
    writeTutorialProgress(tutorial.id, entry)
  }

  const goTo = (next: number) => {
    setIndex(next)
    save(next, false)
  }

  const finish = () => {
    setCompleted(true)
    save(total - 1, true)
  }

  const restart = () => {
    onRestartDemo()
    useAppStore.getState().setWorkspaceMode(tutorial.steps[0].mode)
    setIndex(0)
    setCompleted(false)
    save(0, false)
  }

  return (
    <aside
      className="app-panel fixed bottom-8 right-4 z-40 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-border shadow-2xl"
      aria-label={`Tutorial: ${tutorial.title}`}
      data-tour="tutorial-runner"
    >
      <header className="app-panel-header gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-sm bg-primary/15 font-mono text-[10px] font-bold text-primary">
            {completed ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : `${index + 1}/${total}`}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold text-foreground">{tutorial.title}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {completed ? 'Tutorial complete' : `${WORKSPACE_MODE_META[step.mode].label} · Step ${index + 1} of ${total}`}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={collapsed ? 'Expand tutorial' : 'Collapse tutorial'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(value => !value)}
          >
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Close tutorial" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="h-0.5 flex-shrink-0 bg-muted" aria-hidden="true">
        <div
          className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${Math.round(((completed ? total : index) / total) * 100)}%` }}
        />
      </div>

      {!collapsed && (
        <>
          <div className="scrollbar-thin max-h-[50vh] min-h-0 overflow-y-auto p-3">
            {completed ? (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-foreground">You walked the whole flow.</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  You opened {tutorial.modes.map((mode) => WORKSPACE_MODE_META[mode].label).join(', ')}. Nothing here was graded:
                  the results you read came from each workspace's own model, and the capability records state their limits.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" className="h-7 text-[11px]" onClick={onOpenHelp}>
                    Find another tutorial
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={restart}>
                    <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />
                    Run it again
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    {WORKSPACE_MODE_META[step.mode].label}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    {index + 1} / {total}
                  </span>
                </div>
                <h2 className="text-[13px] font-semibold leading-snug text-foreground">{step.title}</h2>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-primary">Do</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-foreground">{step.do}</p>
                </div>
                <div className="rounded-md border border-border bg-muted/40 p-2">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Look for</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{step.see}</p>
                </div>
              </div>
            )}
          </div>

          <footer className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border bg-muted/30 px-3 py-2">
            {completed ? (
              <span className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">Self-checked · not graded</span>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={index === 0}
                  onClick={() => goTo(index - 1)}
                >
                  <ArrowLeft className="mr-1 h-3 w-3" aria-hidden="true" />
                  Back
                </Button>
                <button
                  type="button"
                  onClick={restart}
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Restart demo
                </button>
                <Button size="sm" className="h-7 text-[11px]" onClick={() => (index === total - 1 ? finish() : goTo(index + 1))}>
                  {index === total - 1 ? 'Finish' : 'Next'}
                  <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
                </Button>
              </>
            )}
          </footer>
          <p className="flex-shrink-0 border-t border-border px-3 py-1 text-[9px] leading-snug text-muted-foreground">
            Steps are self-checked. Folio does not watch your screen or grade the result.
          </p>
        </>
      )}
    </aside>
  )
}
