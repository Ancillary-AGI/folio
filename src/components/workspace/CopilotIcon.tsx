'use client'

/**
 * Copilot's mark: an amoeba that never holds still.
 *
 * The outline is a closed path sampled around a circle whose radius is modulated
 * by three sine waves of different frequency and phase. Animating the phase makes
 * the shape flow continuously — no keyframe snapping, because the path is
 * recomputed from a continuous function rather than interpolated between poses.
 *
 * The loop stops when the tab is hidden, when the element scrolls out of view, and
 * when the platform asks for reduced motion, so an idle window costs nothing.
 */
import { forwardRef, useEffect, useRef, type SVGProps } from 'react'

/** Points around the outline. More points, smoother curve. */
const POINTS = 48
/** Milliseconds per radian of phase — one full cycle is about 9 seconds. */
const PHASE_SPEED = 0.0007

interface Blob {
  /** Radius multiplier for each harmonic. */
  harmonics: readonly [number, number, number]
  /** Phase offset for each harmonic, so they do not peak together. */
  offsets: readonly [number, number, number]
}

const BLOBS: readonly Blob[] = [
  { harmonics: [0.16, 0.09, 0.05], offsets: [0, 2.1, 4.2] },
  { harmonics: [0.11, 0.14, 0.04], offsets: [1.1, 3.3, 5.0] },
  { harmonics: [0.07, 0.06, 0.13], offsets: [2.4, 0.6, 3.7] },
]

/** Build the closed path for one phase. */
function blobPath(phase: number, blob: Blob, cx: number, cy: number, radius: number): string {
  const points: string[] = []
  for (let index = 0; index < POINTS; index += 1) {
    const angle = (index / POINTS) * Math.PI * 2
    let modulation = 1
    for (let harmonic = 0; harmonic < 3; harmonic += 1) {
      const frequency = harmonic + 2
      modulation += blob.harmonics[harmonic] * Math.sin(frequency * angle + phase + blob.offsets[harmonic])
    }
    const x = cx + Math.cos(angle) * radius * modulation
    const y = cy + Math.sin(angle) * radius * modulation
    points.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
  }
  return `${points.join(' ')} Z`
}

const CopilotIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function CopilotIcon(props, ref) {
  const pathRef = useRef<SVGPathElement>(null)
  const frame = useRef<number>(0)

  useEffect(() => {
    const element = pathRef.current
    if (!element) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (reduced) {
      // A single static amoeba: the shape without the motion.
      element.setAttribute('d', blobPath(0, BLOBS[0], 12, 12, 8.5))
      return
    }

    let phase = 0
    let previous = performance.now()

    const tick = (now: number): void => {
      const delta = now - previous
      previous = now
      phase += delta * PHASE_SPEED
      // Cycle the blob set so the outline keeps evolving rather than repeating.
      const blob = BLOBS[Math.floor(phase / (Math.PI * 2)) % BLOBS.length]
      element.setAttribute('d', blobPath(phase, blob, 12, 12, 8.5))
      frame.current = requestAnimationFrame(tick)
    }

    const stop = (): void => cancelAnimationFrame(frame.current)
    const start = (): void => {
      if (frame.current) return
      previous = performance.now()
      frame.current = requestAnimationFrame(tick)
    }

    const onVisibility = (): void => {
      if (document.hidden) stop()
      else start()
    }

    /* Do not animate off-screen: the icon sits in a rail that can be scrolled
 * away, and a running rAF loop for an invisible element is pure waste. */
    const svg = element.ownerSVGElement
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !document.hidden) start()
      else stop()
    })
    if (svg) observer.observe(svg)

    document.addEventListener('visibilitychange', onVisibility)
    start()

    return () => {
      stop()
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <svg
      ref={ref}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path ref={pathRef} d={blobPath(0, BLOBS[0], 12, 12, 8.5)} />
    </svg>
  )
})

export default CopilotIcon