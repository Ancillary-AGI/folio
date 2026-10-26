import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { Button } from './ui/button'
import { writeOnboardingStep } from '../lib/onboarding/onboardingStorage'
import {
  clampOnboardingStep,
  ONBOARDING_STEPS,
} from '../lib/onboarding/onboardingSteps'
import { computeTourLayout, type TourRect } from '../lib/onboarding/tourLayout'

export interface OnboardingTourProps {
  onClose: () => void
  onCreateProject: () => void
  onLoadSampleCircuit: () => void
  onLoadDemoBoard: () => void
  hasProject: boolean
  stepIndex: number
  setStepIndex: (step: number | ((current: number) => number)) => void
}

const EMPTY_VIEWPORT = { width: 1280, height: 800 }

function readViewport() {
  if (typeof window === 'undefined') return EMPTY_VIEWPORT
  return { width: window.innerWidth, height: window.innerHeight }
}

function measuredRect(element: Element | null): TourRect | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

function sameRect(a: TourRect | null, b: TourRect | null) {
  if (a === b) return true
  if (!a || !b) return false
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

export default function OnboardingTour({
  onClose,
  onCreateProject,
  onLoadSampleCircuit,
  onLoadDemoBoard,
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
  const [targetRect, setTargetRect] = useState<TourRect | null>(null)
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState(readViewport)
  // Respect the app-level motion preference as well as the OS setting.
  const animations = useAppStore((state) => state.settings.animations)
  const motionClass = animations ? 'duration-500 ease-out motion-reduce:transition-none' : ''

  useEffect(() => {
    useAppStore.getState().setWorkspaceMode(step.mode)
    // A step can only point at the library once it is on screen; revealing it
    // here is less surprising than a coach mark that silently loses its target.
    if (step.target === 'component-library') useAppStore.setState({ sidebarOpen: true })
    writeOnboardingStep(activeIndex)
  }, [step.mode, step.target, activeIndex])

  /*
   * Targets can mount after the card (lazy workspace chunks, a mode the step
   * just switched to, the sidebar opening). Measure now, then poll for a short
   * while and keep listening to layout changes so the spotlight follows the
   * real element instead of a guessed position.
   */
  useEffect(() => {
    const selectors = [step.target, step.fallbackTarget].filter((value): value is string => Boolean(value))
    if (selectors.length === 0) {
      setTargetRect(null)
      return
    }
    let cancelled = false
    let frame = 0
    /* Duplicated controls (desktop header vs compact menu) can coexist in the
     * DOM; pick the one that is actually laid out at this viewport width. */
    const query = () => {
      for (const selector of selectors) {
        const elements = document.querySelectorAll<HTMLElement>(`[data-tour="${selector}"]`)
        for (const element of elements) {
          if (element.getBoundingClientRect().width > 0) return element
        }
      }
      return null
    }
    const update = () => {
      if (cancelled) return
      const next = measuredRect(query())
      setTargetRect((previous) => (sameRect(previous, next) ? previous : next))
    }
    update()
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const tick = (now: number) => {
      if (cancelled) return
      update()
      const elapsed = now - startedAt
      if (elapsed < 1600) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const timers = [80, 240, 600, 1200, 2400].map((delay) => window.setTimeout(update, delay))
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    const element = query()
    if (observer && element) observer.observe(element)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      timers.forEach((timer) => window.clearTimeout(timer))
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [step.target, step.fallbackTarget, step.mode, activeIndex])

  useEffect(() => {
    const update = () => setViewport(readViewport())
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useLayoutEffect(() => {
    const card = dialogRef.current
    if (!card) return
    const update = () => {
      const next = { width: card.offsetWidth, height: card.offsetHeight }
      setCardSize((previous) =>
        previous.width === next.width && previous.height === next.height ? previous : next,
      )
    }
    update()
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(card)
    return () => observer?.disconnect()
  }, [activeIndex])

  const layout = useMemo(
    () => computeTourLayout(targetRect, cardSize, viewport, step.placement),
    [targetRect, cardSize, viewport, step.placement],
  )

  const goTo = useCallback(
    (index: number) => {
      setStepIndex(Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1))
    },
    [setStepIndex],
  )
  const finish = useCallback(() => onClose(), [onClose])
  /*
   * Project creation is explicit: the tour explains on step 1 and offers a
   * single clearly-labelled action there. Advancing never creates anything —
   * KiCad/Altium wizards review, they don't mutate the design behind Next.
   */
  const advance = useCallback(() => {
    if (isLast) finish()
    else goTo(activeIndex + 1)
  }, [activeIndex, finish, goTo, isLast])
  const createAndAdvance = useCallback(() => {
    if (!hasProject) onCreateProject()
    goTo(activeIndex + 1)
  }, [activeIndex, goTo, hasProject, onCreateProject])

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
      ).filter((element) => element.offsetParent !== null)
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
    <div className="fixed inset-0 z-[100]" role="presentation">
      {/* No-target steps behave like a modal; targeted steps dim everything
       * except the spotlight and keep outside clicks inert so a stray click
       * cannot silently end the tour mid-step. */}
      {layout.spotlight ? (
        <div className="absolute inset-0" aria-hidden="true" />
      ) : (
        <div className="absolute inset-0 bg-overlay/70 backdrop-blur-[1px]" onClick={finish} aria-hidden="true" />
      )}

      {layout.spotlight && (
        <div
          aria-hidden="true"
          className={`pointer-events-none fixed rounded-xl ring-2 ring-primary/80 ${animations ? 'transition-[top,left,width,height]' : ''} ${motionClass}`}
          style={{
            top: layout.spotlight.top,
            left: layout.spotlight.left,
            width: layout.spotlight.width,
            height: layout.spotlight.height,
            boxShadow: '0 0 0 9999px hsl(var(--overlay) / 0.72)',
          }}
        />
      )}

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-summary"
        tabIndex={-1}
        className={`app-panel fixed flex flex-col overflow-hidden rounded-xl border border-border shadow-2xl outline-none ${animations ? 'transition-[top,left,width]' : ''} ${motionClass}`}
        style={{
          top: layout.card.top,
          left: layout.card.left,
          width: layout.card.width,
          maxHeight: 'min(36rem, calc(100vh - 2rem))',
        }}
      >
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
              <StepIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Guided tour</p>
              <p className="truncate text-sm font-semibold text-surface-foreground">Step {activeIndex + 1} of {ONBOARDING_STEPS.length}</p>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            <div
              className="h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:w-32"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={ONBOARDING_STEPS.length}
              aria-valuenow={activeIndex + 1}
              aria-label={`Step ${activeIndex + 1} of ${ONBOARDING_STEPS.length}`}
            >
              <div className={`h-full bg-primary ${animations ? 'transition-[width] duration-300 motion-reduce:transition-none' : ''}`} style={{ width: `${((activeIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
            </div>
            <Button variant="ghost" size="icon" onClick={finish} aria-label="Close the guide">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          Step {activeIndex + 1} of {ONBOARDING_STEPS.length}: {step.title}
        </p>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 py-4">
            <h2 id="onboarding-title" className="text-lg font-semibold leading-snug text-card-foreground">{step.title}</h2>
            <p id="onboarding-summary" className="mt-1.5 text-sm font-medium text-primary">{step.summary}</p>
            <p className="mt-3 text-sm leading-relaxed text-card-foreground/90">{step.detail}</p>
            <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">In this stage</h3>
            <ul className="mt-2 space-y-1.5">
              {step.checklist.map((item) => (
                <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-card-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            {showSampleAction && (
              <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3">
                <h3 className="text-sm font-semibold text-card-foreground">Run a known circuit</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Loads the tested 1N5817 half-wave rectifier (6 parts, 4 nets): the transient run shows OUT
                  riding the positive half-cycle and never swinging negative, and the fab export ships with
                  zero DRC violations.
                </p>
                <div className="mt-2 grid grid-cols-2 items-stretch gap-2">
                  <Button variant="outline" size="sm" className="h-9 justify-center whitespace-nowrap" onClick={onLoadDemoBoard}>Load rectifier</Button>
                  <Button variant="outline" size="sm" className="h-9 justify-center whitespace-nowrap" onClick={onLoadSampleCircuit}>Load divider</Button>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* CAD-wizard footer: shared classes, never hand-rolled per dialog. */}
        <div className="cad-footer-row flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={finish}>Skip the guide</Button>
          <div className="cad-action-pair">
            <Button variant="outline" size="sm" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0} aria-label="Previous step">
              <ArrowLeft className="mr-2 h-4 w-4 shrink-0" />Back
            </Button>
            {activeIndex === 0 && !hasProject ? (
              <Button size="sm" onClick={createAndAdvance}>
                New project<ArrowRight className="ml-2 h-4 w-4 shrink-0" />
              </Button>
            ) : (
              <Button size="sm" onClick={advance}>
                {isLast ? 'Finish' : 'Continue'}
                {!isLast && <ArrowRight className="ml-2 h-4 w-4 shrink-0" />}
              </Button>
            )}
          </div>
        </div>
        <p className="flex-shrink-0 border-t border-border px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Arrow keys move between steps, Esc closes. Always validate critical results independently before fabrication or before connecting real hardware.
        </p>
      </div>
    </div>
  )
}
