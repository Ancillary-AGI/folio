import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Hand, ShieldAlert, X } from 'lucide-react'
import { useAppStore } from '../stores/useAppStore'
import { Button } from './ui/button'
import { writeOnboardingStep } from '../lib/onboarding/onboardingStorage'
import { CAPABILITY_RECORDS } from '../lib/workspace/limitsRegistry'
import {
  chapterForStep,
  chapterStepIndices,
  clampOnboardingStep,
  ONBOARDING_CHAPTERS,
  ONBOARDING_STEPS,
  stepPositionInChapter,
} from '../lib/onboarding/onboardingSteps'
import { computeTourLayout, computeTourCaret, type TourCaret, type TourRect } from '../lib/onboarding/tourLayout'

export type TourExitReason = 'finished' | 'skipped' | 'dismissed'

export interface OnboardingTourProps {
  onClose: (reason: TourExitReason) => void
  onCreateProject: () => void
  onLoadSampleCircuit: () => void
  onLoadDemoBoard: () => void
  onOpenLimits: () => void
  hasProject: boolean
  stepIndex: number
  setStepIndex: (step: number) => void
}

const EMPTY_VIEWPORT = { width: 1280, height: 800 }

const COMPACT_VIEWPORT_HEIGHT = 620

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

function caretStyle(caret: TourCaret): CSSProperties {
  return caret.side === 'top' || caret.side === 'bottom'
    ? { left: caret.along }
    : { top: caret.along }
}

const BRACKETS = [
  { id: 'tl', sides: 'border-t-2 border-l-2', style: { top: -4, left: -4 } },
  { id: 'tr', sides: 'border-t-2 border-r-2', style: { top: -4, right: -4 } },
  { id: 'bl', sides: 'border-b-2 border-l-2', style: { bottom: -4, left: -4 } },
  { id: 'br', sides: 'border-b-2 border-r-2', style: { bottom: -4, right: -4 } },
] as const

/** Short chapter names for the rail — the card width cannot hold all six in full. */
const RAIL_LABEL: Record<string, string> = {
  orientation: 'Orient',
  capture: 'Capture',
  prove: 'Prove',
  physical: 'Build',
  connect: 'Connect',
  govern: 'Govern',
}

/**
 * The guide.
 *
 * One idea per screen, stated once. The chapter rail and a single thin
 * progress line carry the journey; nothing competes with the step. Motion is
 * limited to one staggered fade per step; everything else stays still.
 */
export default function OnboardingTour({
  onClose,
  onCreateProject,
  onLoadSampleCircuit,
  onLoadDemoBoard,
  onOpenLimits,
  hasProject,
  stepIndex,
  setStepIndex,
}: OnboardingTourProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const activeIndex = useMemo(() => clampOnboardingStep(stepIndex), [stepIndex])
  const step = ONBOARDING_STEPS[activeIndex]
  const { chapter, ordinal: chapterOrdinal } = chapterForStep(activeIndex)
  const chapterPosition = stepPositionInChapter(activeIndex)
  const isLast = activeIndex === ONBOARDING_STEPS.length - 1
  const showSampleAction = step.action === 'load-sample-circuit'
  const showLimitsAction = step.action === 'open-limits'
  const StepIcon = step.icon
  const [targetRect, setTargetRect] = useState<TourRect | null>(null)
  const [cardSize, setCardSize] = useState({ width: 0, height: 0 })
  const [viewport, setViewport] = useState(readViewport)
  const animations = useAppStore((state) => state.settings.animations)
  const motionClass = animations ? 'duration-500 ease-out motion-reduce:transition-none' : ''

  useEffect(() => {
    /* The mode switch happens here rather than in the data so the workspace
     * always matches the step on screen. */
    useAppStore.getState().setWorkspaceMode(step.mode)
    if (step.target === 'component-library') useAppStore.setState({ sidebarOpen: true })
    writeOnboardingStep(activeIndex)
  }, [step.mode, step.target, activeIndex])

  useEffect(() => {
    const selectors = [step.target, step.fallbackTarget].filter((value): value is string => Boolean(value))
    if (selectors.length === 0) {
      setTargetRect(null)
      return
    }
    let cancelled = false
    let frame = 0
    let observed: Element | null = null
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => update()) : null
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
      const element = query()
      if (observer && element !== observed) {
        if (observed) observer.unobserve(observed)
        if (element) observer.observe(element)
        observed = element
      }
      const next = measuredRect(element)
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

  const caret = useMemo(
    () => computeTourCaret(layout, cardSize.height, targetRect),
    [layout, cardSize.height, targetRect],
  )

  const fadeClass = animations ? 'animate-rise-in' : ''
  const fadeDelay = (delay: number): CSSProperties | undefined =>
    animations ? { animationDelay: `${delay}ms` } : undefined

  const goTo = useCallback(
    (index: number) => {
      setStepIndex(Math.min(Math.max(index, 0), ONBOARDING_STEPS.length - 1))
    },
    [setStepIndex],
  )
  const exit = useCallback((reason: TourExitReason) => onClose(reason), [onClose])
  const advance = useCallback(() => {
    if (isLast) exit('finished')
    else goTo(activeIndex + 1)
  }, [activeIndex, exit, goTo, isLast])
  const createAndAdvance = useCallback(() => {
    if (!hasProject) onCreateProject()
    goTo(activeIndex + 1)
  }, [activeIndex, goTo, hasProject, onCreateProject])

  const openLimits = useCallback(() => {
    exit('finished')
    onOpenLimits()
  }, [exit, onOpenLimits])

  const isLiveStep = Boolean(step.handsOn && layout.spotlight)

  const compact = viewport.height < COMPACT_VIEWPORT_HEIGHT

  /* Project creation is a choice, never a side effect of pressing Next. It is
   * offered for as long as no design is open. */
  const needsProject = !hasProject

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); exit('dismissed'); return }
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
      const root = dialogRef.current
      const focusIsOurs =
        event.target instanceof Node && root !== null && root.contains(event.target)
      if (isLiveStep && !focusIsOurs) return
      event.preventDefault()
      if (event.key === 'ArrowRight') advance()
      else goTo(activeIndex - 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, advance, exit, goTo, isLiveStep])

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

  const checklist = (
    <ul className="mt-3 space-y-2">
      {step.checklist.map((item) => (
        <li key={item} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-card-foreground/90">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )

  return (
    <div className={`fixed inset-0 z-[100] ${isLiveStep ? 'pointer-events-none' : ''}`} role="presentation">
      {!layout.spotlight && (
        <div
          className={`pointer-events-auto absolute inset-0 bg-overlay/70 backdrop-blur-[1px] ${animations ? 'animate-fade-in' : ''}`}
          onClick={() => exit('dismissed')}
          aria-hidden="true"
        />
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
            boxShadow: `0 0 0 9999px hsl(var(--overlay) / ${isLiveStep ? 0.4 : 0.72})`,
          }}
        >
          {BRACKETS.map((bracket) => (
            <span
              key={`${step.id}-${bracket.id}`}
              className={`tour-bracket ${bracket.sides}`}
              style={bracket.style}
            />
          ))}
        </div>
      )}

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal={isLiveStep ? undefined : true}
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-summary"
        tabIndex={-1}
        className={`pointer-events-auto app-panel fixed flex flex-col overflow-visible rounded-xl border border-border shadow-2xl outline-none ${animations ? 'transition-[top,left,width]' : ''} ${motionClass}`}
        style={{
          top: layout.card.top,
          left: layout.card.left,
          width: layout.card.width,
          maxHeight: 'min(34rem, calc(100vh - 2rem))',
        }}
      >
        {caret && (
          <span
            key={`${step.id}-caret`}
            className={`tour-caret tour-caret-${caret.side} ${animations ? 'animate-fade-in' : ''}`}
            style={caretStyle(caret)}
            aria-hidden="true"
          />
        )}

        {/* One line of orientation, then nothing else. */}
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 overflow-hidden rounded-t-xl border-b border-border bg-surface px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              key={`icon-${step.id}`}
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground ${fadeClass}`}
              aria-hidden="true"
            >
              <StepIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
                {chapter.label} <span className="text-muted-foreground">· {chapterOrdinal} of {ONBOARDING_CHAPTERS.length}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Step {chapterPosition.position} of {chapterPosition.size} · <span className="tabular-nums">{activeIndex + 1} of {ONBOARDING_STEPS.length}</span>
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={() => exit('dismissed')} aria-label="Close the guide" title="Leave the guide. What you have already done stays done.">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Thin progress line sits right under the header. */}
        <div
          className="h-0.5 w-full flex-shrink-0 bg-muted"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={ONBOARDING_STEPS.length}
          aria-valuenow={activeIndex + 1}
          aria-label={`Step ${activeIndex + 1} of ${ONBOARDING_STEPS.length}`}
        >
          <div className={`h-full bg-primary ${animations ? 'transition-[width] duration-300 motion-reduce:transition-none' : ''}`} style={{ width: `${((activeIndex + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          Step {activeIndex + 1} of {ONBOARDING_STEPS.length}: {step.title}
        </p>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <div key={step.id} className="px-5 py-5">
            <h2 id="onboarding-title" className={`text-2xl font-extrabold leading-tight tracking-[-0.02em] text-card-foreground ${fadeClass}`} style={fadeDelay(0)}>
              {step.title}
            </h2>
            <p id="onboarding-summary" className={`mt-2 text-sm font-semibold text-primary ${fadeClass}`} style={fadeDelay(60)}>
              {step.summary}
            </p>
            <p className={`mt-3 text-[15px] leading-relaxed text-card-foreground/90 ${fadeClass}`} style={fadeDelay(120)}>
              {step.detail}
            </p>

            {isLiveStep && (
              <div className={`mt-4 flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 ${fadeClass}`} style={fadeDelay(180)}>
                <Hand className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-card-foreground">
                  Try it now on the highlighted control — the app is live behind this card.
                </p>
              </div>
            )}

            {compact ? (
              <details className={`group mt-4 ${fadeClass}`} style={fadeDelay(220)}>
                <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
                  <ChevronDown
                    className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                  What you will do ({step.checklist.length})
                </summary>
                {checklist}
              </details>
            ) : (
              <div className="mt-4 border-t border-border/60 pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">What you will do</p>
                {checklist}
              </div>
            )}

            {showSampleAction && (
              <div className={`mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 ${fadeClass}`} style={fadeDelay(320)}>
                <p className="text-sm font-semibold text-card-foreground">Run a known circuit</p>
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
            {showLimitsAction && (
              <div className={`mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 ${fadeClass}`} style={fadeDelay(320)}>
                <p className="text-sm font-semibold text-card-foreground">Take the register with you</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {CAPABILITY_RECORDS.length} records, each naming the method, the test files and the not-modelled
                  list for one family of results. Filter it to the workspace you are in, or search a solver name.
                </p>
                <Button variant="outline" size="sm" className="mt-2 h-9 w-full justify-center whitespace-nowrap" onClick={openLimits}>
                  <ShieldAlert className="mr-2 h-4 w-4 shrink-0" /> Open capabilities and limits
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Chapter rail — one short word per chapter, the whole curriculum in view. */}
        <div className="flex flex-shrink-0 items-center justify-center gap-1 border-t border-border bg-surface/60 px-3 py-2">
          {ONBOARDING_CHAPTERS.map((chapterEntry) => {
            const indices = chapterStepIndices(chapterEntry.id)
            if (indices.length === 0) return null
            const firstIndex = indices[0]
            const done = indices.every((index) => index < activeIndex)
            const activeChapter = step.chapter === chapterEntry.id
            return (
              <button
                key={chapterEntry.id}
                type="button"
                onClick={() => goTo(firstIndex)}
                title={chapterEntry.promise}
                aria-current={activeChapter ? 'step' : undefined}
                aria-label={`${activeChapter ? 'Current chapter: ' : done ? 'Reviewed chapter: ' : 'Upcoming chapter: '}${chapterEntry.label}`}
                className={`rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  activeChapter
                    ? 'bg-primary/15 text-primary'
                    : done
                      ? 'text-muted-foreground hover:text-foreground'
                      : 'text-muted-foreground/60 hover:text-foreground'
                }`}
              >
                {RAIL_LABEL[chapterEntry.id] ?? chapterEntry.label}
              </button>
            )
          })}
        </div>

        {/* Footer — the only two decisions on screen. */}
        <div className="cad-footer-row flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={() => exit('skipped')}>Skip</Button>
          <div className="cad-action-pair">
            {needsProject ? (
              <Button variant="outline" size="sm" onClick={advance}>Keep reading</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0} aria-label="Previous step">
                <ArrowLeft className="mr-2 h-4 w-4 shrink-0" />Back
              </Button>
            )}
            {needsProject ? (
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
        <p className="flex-shrink-0 overflow-hidden rounded-b-xl border-t border-border px-5 py-2 text-[10px] leading-relaxed text-muted-foreground/80">
          Arrow keys move between steps, Esc closes. Always validate critical results independently before fabrication or before connecting real hardware.
        </p>
      </div>
    </div>
  )
}
