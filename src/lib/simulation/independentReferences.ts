/**
 * Independent reference answers for the e-CAD solver (Giant 1).
 *
 * Every function below computes what a circuit *must* produce from the device
 * equations alone, using none of the solver's own code paths — no Newton
 * iteration, no matrix, no stamps. A test that compares the solver against
 * these answers measures the solver against the physics, not against itself.
 *
 * ngspice is the reference the plan calls for, but it is not installed on any
 * machine this repo builds on, so these closed forms stand in for it. They
 * are deliberately the textbook equations (Ebers–Moll with Early, square-law
 * FET, RC exponential), *not* the fuller models the solver stamps
 * (Gummel–Poon base charge, high-current rolloff, junction capacitance). The
 * solver must therefore land *within tolerance of the textbook answer* while
 * solving a richer model — that gap is the honest part.
 *
 * Convention: all voltages in volts, currents in amps, time in seconds.
 */
import { thermalVoltage } from './devices'

/** kT/q at 27 °C, the temperature every stock card is quoted at. */
const THERMAL = thermalVoltage(27)

/**
 * Ebers–Moll collector current for an NPN at (vbe, vce), with the Early
 * effect as the single correction: `Ic = IS·e^(Vbe/Vt)·(1 + Vce/VAF)`.
 * Deliberately no base-charge or high-current terms — the textbook answer.
 */
export function referenceBjtCollectorCurrent(
  vbe: number,
  vce: number,
  saturationCurrent: number,
  earlyVoltage: number,
): number {
  return saturationCurrent * Math.exp(vbe / THERMAL) * (1 + vce / earlyVoltage)
}

/**
 * Common-emitter bias point by fixed-point iteration on the textbook model:
 * `Ib = (VCC − Vbe)/RB`, `Ic = β·Ib`, `Vce = VCC − Ic·RC`, with Vbe solved
 * from `Ib = (IS/β)·e^(Vbe/Vt)`. Returns `{ base, collector }` in volts.
 *
 * This is a hand iteration, not a Newton solve: it converges from Vbe = 0.7
 * and stops when the base voltage moves less than 1 nV.
 */
export function referenceCommonEmitter(
  supplyVoltage: number,
  baseResistance: number,
  collectorResistance: number,
  saturationCurrent: number,
  beta: number,
): { base: number; collector: number } {
  let vbe = 0.7
  for (let pass = 0; pass < 1000; pass += 1) {
    const ib = (supplyVoltage - vbe) / baseResistance
    const next = THERMAL * Math.log((ib * beta) / saturationCurrent)
    if (Math.abs(next - vbe) < 1e-9) {
      vbe = next
      break
    }
    vbe = next
  }
  const ib = (supplyVoltage - vbe) / baseResistance
  return { base: vbe, collector: supplyVoltage - beta * ib * collectorResistance }
}

/**
 * Square-law (Shichman–Hodges) drain current for an N-channel FET at
 * (vgs, vds): triode below pinch-off, saturation beyond it, plus the
 * channel-length term `(1 + λ·Vds)`. No body effect, no subthreshold.
 */
export function referenceMosfetDrainCurrent(
  vgs: number,
  vds: number,
  threshold: number,
  kp: number,
  lambda: number,
): number {
  const overdrive = vgs - threshold
  if (overdrive <= 0) return 0
  const factor = 1 + lambda * vds
  if (vds < overdrive) return kp * (overdrive * vds - (vds * vds) / 2) * factor
  return (kp / 2) * overdrive * overdrive * factor
}

/**
 * JFET drain current in saturation: `IDSS·(1 − Vgs/VTO)²·(1 + λ·Vds)`.
 * Valid for Vgs between VTO (negative) and 0; outside that the caller is
 * asking a question the textbook model refuses.
 */
export function referenceJfetDrainCurrent(
  vgs: number,
  vds: number,
  idss: number,
  pinchOff: number,
  lambda: number,
): number {
  if (vgs > 0 || vgs < pinchOff) throw new Error(`Vgs ${vgs} is outside [VTO, 0]`)
  const ratio = 1 - vgs / pinchOff
  return idss * ratio * ratio * (1 + lambda * vds)
}

/**
 * Ideal op-amp in a closed loop: the output is whatever the feedback network
 * demands, clamped at the rails minus the dropout. `gainExpression` is the
 * closed-loop gain the network sets (e.g. −Rf/Rin for an inverter); the
 * reference asserts the solver tracks it inside the linear region and clamps
 * outside it.
 */
export function referenceOpAmpOutput(
  input: number,
  closedLoopGain: number,
  positiveRail: number,
  negativeRail: number,
  dropout: number,
): number {
  const linear = input * closedLoopGain
  return Math.min(positiveRail - dropout, Math.max(negativeRail + dropout, linear))
}

/**
 * Step response of a series RC network charged from 0 toward `asymptote`:
 * `V(t) = asymptote·(1 − e^(−t/τ))` with `τ = R·C`. The textbook curve every
 * transient integrator must track within its own step error.
 */
export function referenceRcStep(time: number, asymptote: number, tau: number): number {
  if (time < 0) return 0
  return asymptote * (1 - Math.exp(-time / tau))
}

/**
 * Sine-driven divider: two resistors see `amplitude·sin(2πft + phase)` at
 * the tap. Phase-exact at every instant — an AC-coupled transient that
 * drifts in phase is mis-stamping its sources, not integrating loosely.
 */
export function referenceSineDivider(
  time: number,
  amplitude: number,
  frequency: number,
  phase: number,
): number {
  return amplitude * Math.sin(2 * Math.PI * frequency * time + phase)
}
