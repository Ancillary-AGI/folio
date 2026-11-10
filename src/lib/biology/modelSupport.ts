/**
 * Shared plumbing for the biology models.
 *
 * Every model in this domain is a set of lumped ordinary differential equations
 * integrated by the robotics RK4 (`../robotics/timeIntegration`), plotted at a
 * coarser cadence than it is solved. This file holds the three things that would
 * otherwise be re-typed in each model: parameter validation with a message that
 * names the parameter, the run window, and the "integrate finely, report
 * coarsely" loop.
 *
 * Time units are the model's own, stated in each model's header. They are never
 * mixed inside one call: a Hodgkin–Huxley run is in milliseconds, a
 * pharmacokinetic run in hours, a gene-circuit run in dimensionless time.
 */

import {
  assertOutputPlan,
  integrate,
  planStableSubSteps,
  type FirstOrderMethod,
  type Sample,
} from '../robotics/timeIntegration'

/** Ceiling on internal integration steps, shared with the machine models. */
export const MAX_BIOLOGY_STEPS = 400_000

/** A simulation run: when to stop, how often to report, and which integrator. */
export interface BiologyWindow {
  /** End of the run, in the model's time unit. Must be positive. */
  tEnd: number
  /** Reporting step, in the model's time unit. Must be positive. */
  dt: number
  /** Defaults to RK4; `euler` exists to let a test show what accuracy costs. */
  method?: FirstOrderMethod
}

export function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite (got ${value}).`)
}

export function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite (got ${value}).`)
  }
}

export function requireNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative and finite (got ${value}).`)
  }
}

export function requireFraction(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1 (got ${value}).`)
  }
}

export function requireInteger(value: number, name: string): void {
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number (got ${value}).`)
}

/** Validate a run window against the shared step ceiling. */
export function validateWindow(window: BiologyWindow): void {
  assertOutputPlan(window.tEnd, window.dt, MAX_BIOLOGY_STEPS, 'output')
}

/**
 * Integrate `dy/dt = f(t, y)` finely and return samples at the caller's cadence.
 *
 * `fastestTau` is the smallest time constant in the system — the caller computes
 * it from its own parameters, which is the only honest way to size a step for a
 * model this code does not know. Pass `Infinity` when nothing is faster than the
 * reporting step.
 */
export function integrateModel(
  derivative: (time: number, state: readonly number[]) => number[],
  initial: readonly number[],
  window: BiologyWindow,
  fastestTau: number,
): Sample[] {
  validateWindow(window)
  for (let i = 0; i < initial.length; i += 1) {
    requireFinite(initial[i], `Initial state ${i}`)
  }
  const plan = planStableSubSteps(window.tEnd, window.dt, fastestTau, MAX_BIOLOGY_STEPS)
  // The stride is handed to the integrator rather than applied to its output:
  // copying a state vector for every internal step of a cable run is seconds of
  // work that `decimate` then throws away.
  return integrate(derivative, initial, 0, window.tEnd, {
    dt: plan.dt,
    method: window.method ?? 'rk4',
    keepEvery: plan.stride,
  })
}

/** Largest and smallest value in a trace, ignoring nothing: NaN throws. */
export function traceRange(values: readonly number[]): { min: number; max: number } {
  if (values.length === 0) throw new Error('Trace range needs at least one sample.')
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    requireFinite(value, 'Trace value')
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}
