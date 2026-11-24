/**
 * Running a biology job from a React view without stopping the tab.
 *
 * A tissue run is 0.7 s at the shipping mesh and 41 s at the finest one the dial
 * offers, so it cannot live in a `useMemo`: every dial tick would block the main
 * thread for the length of the solve, and the panel would look broken while it
 * thought. Both hooks here hand the job to `runBioRun` and keep the answer as state.
 *
 * `useBioRun` is for the run the view always owes the screen — the one that follows
 * the dials. It keeps the previous result visible while the next one solves, so a
 * drag does not empty the chart it is drawing on, and it cancels the superseded
 * worker instead of letting it finish something nobody is looking at.
 *
 * `useBioJob` is for a study the engineer asked for by button press: nothing runs
 * until it is started, and the caller decides what the finished result becomes.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { runBioRun, type BioRunAccelerator, type BioRunHandle } from '../../lib/biology/bioRunDispatch'
import type { BioRunJob, BioRunResult } from '../../lib/biology/bioRunCore'

export interface BioRunView {
  /** The run that is on screen: the newest answer, or null while solving or after a refusal. */
  result: BioRunResult | null
  /** The solver's own message when the newest run refused. */
  error: string | null
  /** A job is in flight. */
  solving: boolean
  /** Which thread produced the result on screen; null before the first one lands. */
  accelerator: BioRunAccelerator | null
  durationMs: number
}

export function useBioRun(job: BioRunJob): BioRunView {
  const [view, setView] = useState<BioRunView>({
    result: null,
    error: null,
    solving: true,
    accelerator: null,
    durationMs: 0,
  })

  useEffect(() => {
    let active = true
    setView((current) => ({ ...current, solving: true }))
    const handle = runBioRun(job)
    void handle.promise.then((outcome) => {
      if (!active || outcome.status === 'cancelled') return
      setView({
        result: outcome.status === 'done' ? outcome.result : null,
        error: outcome.status === 'failed' ? outcome.error : null,
        solving: false,
        accelerator: outcome.accelerator,
        durationMs: outcome.durationMs,
      })
    })
    return () => {
      active = false
      handle.cancel()
    }
  }, [job])

  return view
}

export interface BioJobRunner {
  /** True while a started study is still running. */
  busy: boolean
  /** Start a study; a second call supersedes the first. `onSettled` never sees a cancelled run. */
  start: (job: BioRunJob, onSettled: (outcome: { result: BioRunResult | null; error: string | null }) => void) => void
  /** Drop the study in flight, if any. */
  cancel: () => void
}

export function useBioJob(): BioJobRunner {
  const [busy, setBusy] = useState(false)
  const inFlight = useRef<BioRunHandle | null>(null)

  useEffect(
    () => () => {
      inFlight.current?.cancel()
      inFlight.current = null
    },
    [],
  )

  const cancel = useCallback(() => {
    inFlight.current?.cancel()
    inFlight.current = null
    setBusy(false)
  }, [])

  const start = useCallback<BioJobRunner['start']>((job, onSettled) => {
    inFlight.current?.cancel()
    setBusy(true)
    const handle = runBioRun(job)
    inFlight.current = handle
    void handle.promise.then((outcome) => {
      if (inFlight.current !== handle || outcome.status === 'cancelled') return
      inFlight.current = null
      setBusy(false)
      onSettled(
        outcome.status === 'done'
          ? { result: outcome.result, error: null }
          : { result: null, error: outcome.error ?? 'The study stopped without an answer.' },
      )
    })
  }, [])

  return { busy, start, cancel }
}
