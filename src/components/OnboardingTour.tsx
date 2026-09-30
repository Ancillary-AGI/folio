import { useCallback, useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { Button } from './ui/button'
import { writeOnboardingStep } from '../lib/onboarding/onboardingStorage'
import { clampOnboardingStep, ONBOARDING_STEPS } from '../lib/onboarding/onboardingSteps'

export interface OnboardingTourProps {
  onClose: () => void
  onCreateProject: () => void
  onLoadSampleCircuit: () => void
  hasProject: boolean
  stepIndex: number
  setStepIndex: (step: number | ((current: number) => number)) => void
}

export default function OnboardingTour({
  onClose,
  onCreateProject,
  onLoadSampleCircuit,
  hasProject,
  stepIndex,
  setStepIndex,
}: OnboardingTourProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const activeIndex = useMemo(() => clampOnboardingStep(stepIndex), [stepIndex])
  const step = ONBOARDING_STEPS[activeIndex]
  const isLast = activeIndex === ONBOARDING_STEPS.length - 1
  const showSampleAction = step.id === 'schematic'
  const StepIcon = step.icon

  useEffect(() => {
    useAppStore.getState().setWorkspaceMode(step.mode)
    writeOnboardingStep(activeIndex)
  }, [step.mode, activeIndex])

  const goTo = useCallback(
    (index: number) => {
      setStepIndex(Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1))
    },
    [setStepIndex],
  )
  const finish = useCallback(() => onClose(), [onClose])
  const advance = useCallback(() => {
    if (activeIndex === 0 && !hasProject) onCreateProject()
    if (isLast) finish()
    else goTo(activeIndex + 1)
  }, [activeIndex, finish, goTo, hasProject, isLast, onCreateProject])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); finish() }
      else if (event.key === 'ArrowRight') { event.preventDefault(); advance() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); goTo(activeIndex - 1) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, advance, finish, goTo])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="modal-scrim z-[100]" role="presentation" onClick={finish}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-summary"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="app-panel flex max-h-[calc(100vh-2rem)] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border shadow-2xl outline-none animate-rise-in"
      >
        <header className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
              <StepIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Guided setup
              </p>
              <p className="truncate text-sm font-semibold text-surface-foreground">
                Step {activeIndex + 1} of {ONBOARDING_STEPS.length}
              </p>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            <div
              className="h-1.5 w-28 overflow-hidden rounded-full bg-muted sm:w-40"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={ONBOARDING_STEPS.length}
              aria-valuenow={activeIndex + 1}
              aria-label={`Step ${activeIndex + 1} of ${ONBOARDING_STEPS.length}`}
            >
              <div
                className="h-full bg-primary transition-[width] duration-300"
                style={{ width: `${((activeIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }}
              />
            </div>
            <Button variant="ghost" size="icon" onClick={finish} aria-label="Close the guide">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>
        <p className="sr-only" role="status" aria-live="polite">
          Step {activeIndex + 1} of {ONBOARDING_STEPS.length}: {step.title}
        </p>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <nav aria-label="Guide steps" className="hidden min-h-0 w-52 flex-shrink-0 overflow-y-auto border-b border-border bg-muted/40 p-4 lg:block lg:border-b-0 lg:border-r">
            <ol className="space-y-1">
              {ONBOARDING_STEPS.map((entry, index) => {
                const Icon = entry.icon
                const isActive = index === activeIndex
                const isDone = index < activeIndex
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => goTo(index)}
                      aria-current={isActive ? 'step' : undefined}
                      className={isActive
                        ? 'flex w-full items-center gap-2.5 rounded-md bg-primary/10 px-2.5 py-2 text-left text-xs font-semibold text-card-foreground ring-1 ring-inset ring-primary/40 transition-colors'
                        : 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'}
                    >
                      <span
                        className={isActive
                          ? 'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-[11px] font-semibold text-primary-foreground'
                          : isDone
                            ? 'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-success bg-success text-[11px] font-semibold text-success-foreground'
                            : 'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-border bg-background text-[11px] font-semibold text-muted-foreground'}
                        aria-hidden="true"
                      >
                        {isDone ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                      </span>
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate">{entry.title}</span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {entry.summary}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>
          <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="px-6 py-6">
              <h2 id="onboarding-title" className="text-xl font-semibold leading-snug text-card-foreground sm:text-2xl">
                {step.title}
              </h2>
              <p id="onboarding-summary" className="mt-2 text-sm font-medium text-primary">
                {step.summary}
              </p>
              <p className="mt-4 text-sm leading-relaxed text-card-foreground/90">{step.detail}</p>
              <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                In this stage
              </h3>
              <ul className="mt-3 space-y-2">
                {step.checklist.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-relaxed text-card-foreground">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {showSampleAction && (
                <div className="mt-6 rounded-md border border-primary/40 bg-primary/5 p-4">
                  <h3 className="text-sm font-semibold text-card-foreground">Run a known circuit</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Loads a 5 V divider built from two 1 kΩ resistors. Solving its operating point
                    should give 2.5 V at the midpoint.
                  </p>
                  <Button className="mt-3" variant="outline" size="sm" onClick={onLoadSampleCircuit}>
                    Load the 5 V divider example
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-auto flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-4">
              <Button variant="ghost" size="sm" onClick={finish}>
                Skip the guide
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goTo(activeIndex - 1)}
                  disabled={activeIndex === 0}
                  aria-label="Previous step"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button size="sm" onClick={advance}>
                  {isLast
                    ? 'Finish and start designing'
                    : activeIndex === 0 && !hasProject
                      ? 'Create project and continue'
                      : 'Continue'}
                  {!isLast && <ArrowRight className="ml-2 h-4 w-4" />}
                </Button>
              </div>
            </div>
            <p className="flex-shrink-0 border-t border-border px-6 py-3 text-xs leading-relaxed text-muted-foreground">
              Use the arrow keys to move between steps, or Esc to close. Always validate critical
              results independently before fabrication or before connecting real hardware.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
