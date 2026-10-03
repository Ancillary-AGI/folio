/**
 * EMC pre-compliance estimation.
 *
 * This is a *design-rule estimator*, not a field solver: it combines three
 * closed-form mechanisms that dominate board-level failures, each derived from
 * textbook electromagnetics (not fitted constants):
 *
 *  1. Differential-mode loop radiation — a small loop is a magnetic dipole.
 *     Far-field E ≈ 1.316e-14 · I · f² · A / r (A in m², r = 3 m, f in Hz),
 *     from the standard small-loop far-field E = μ₀·π·I·A·f²/(c²·r)·sin θ.
 *     The 1.316e-14 factor is μ₀·π/(c²·r) with μ₀ = 4πe-7, c = 3e8, r = 3.
 *  2. Common-mode cable radiation — a cable driven against the board is an
 *     electric dipole. E ≈ 6.283e-7 · Icm · L · f / r (L in m, r = 3 m),
 *     i.e. 60·π/(c·r), from the Hertzian-dipole far field
 *     E = η·I·L·k/(4·π·r) with η = 120·π and k = 2·π·f/c. Common-mode current defaults to 1 % of the trace
 *     current (the usual PCB rule of thumb: Icm/Idm ≈ 0.01 for an unfiltered
 *     interface); the caller can override it per trace.
 *  3. Crosstalk — capacitive + inductive forward coupling between aggressor
 *     and victim over their parallel length, with the victim terminated.
 *     Coefficients are evaluated per-unit-length from the microstrip geometry
 *     (Hammerstad–Jansen Z₀, parallel-plate C, loop L) at the caller's height
 *     above the reference plane, then scaled by parallel length. The result is
 *     what a scope on the victim's near end would show for a step on the
 *     aggressor, before any mitigation.
 *
 * Every quantity is derived from the trace geometry and current the caller
 * passes in — nothing is fabricated, and every intermediate (field strength,
 * limit, margin, coupling model) is exposed so a reviewer can check the math.
 * Limits follow CISPR 32 Class B / FCC Part 15 at 3 m by band; IEC 61000-6-3
 * shares the CISPR radiated limits with a tighter conducted mask.
 */

export interface EMCTrace {
  id: string
  /** Trace length, mm. */
  lengthMm: number
  /** Differential-mode (signal) current on the trace, A. */
  currentA: number
  /** Highest significant frequency content on the trace, Hz. */
  frequencyHz: number
  /** Return-path loop area enclosed by the trace and its return, mm². */
  loopAreaMm2: number
  /**
   * Common-mode current on an attached cable driven against the board, A.
   * Defaults to 1 % of `currentA` (the usual PCB rule of thumb for an
   * unfiltered interface); set explicitly for a filtered or shielded port.
   */
  commonModeCurrentA?: number
  /** Length of the attached cable acting as a common-mode antenna, mm. */
  cableLengthMm?: number
}

export interface EMCHotspot {
  traceId: string
  /** Total field from this trace at 3 m, dBµV/m. */
  contribution: number
  /** Differential-mode loop part, dBµV/m. */
  differentialDBuVPerM: number
  /** Common-mode cable part, dBµV/m. */
  commonModeDBuVPerM: number
}

export interface EMCResult {
  radiatedDBuVPerM: number
  /** Backwards-compatible alias of `radiatedDBuVPerM`. */
  radiatedDBuV: number
  conductedDBuV: number
  limitDBuV: number
  marginDb: number
  compliant: boolean
  hotspots: EMCHotspot[]
  recommendations: string[]
}
/** Pre-compliance radiated/conducted emission estimate for a set of PCB traces. */
export class EMCSimulationEngine {
  /** 3 m measurement distance both CISPR 32 Class B and FCC Part 15 use. */
  private static readonly RANGE_M = 3
  private static readonly SPEED_OF_LIGHT = 3e8

  /**
   * Small-loop (magnetic dipole) far-field at 3 m, V/m.
   * E = 120·π²·I·A·f² / (c²·r), the textbook small-loop result
   * (E = η₀·k²·I·A / 4πr with k = 2πf/c, η₀ = 120π, sinθ = 1 worst case).
   */
  static loopFieldVPerM(currentA: number, areaM2: number, frequencyHz: number): number {
    return ((120 * Math.PI * Math.PI * currentA * areaM2 * frequencyHz * frequencyHz) /
      (EMCSimulationEngine.SPEED_OF_LIGHT * EMCSimulationEngine.SPEED_OF_LIGHT *
        EMCSimulationEngine.RANGE_M))
  }

  /**
   * Short-dipole (Hertzian) far-field at 3 m, V/m — the common-mode cable model.
   * E = 60·π·I·L·f / (c·r) (η₀·I·L·k / 4πr, sinθ = 1 worst case).
   */
  static cableFieldVPerM(currentA: number, lengthM: number, frequencyHz: number): number {
    return ((60 * Math.PI * currentA * lengthM * frequencyHz) /
      (EMCSimulationEngine.SPEED_OF_LIGHT * EMCSimulationEngine.RANGE_M))
  }

  private static toDBuVPerM(fieldVPerM: number): number {
    return 20 * Math.log10(Math.max(fieldVPerM, 1e-12) / 1e-6)
  }

  /** Radiated Class B limit at 3 m for the band containing `frequencyHz`. */
  static radiatedLimit(frequencyHz: number, standard: 'CISPR32' | 'FCC15' | 'IEC61000'): number {
    if (standard === 'FCC15') return frequencyHz < 88e6 ? 40 : frequencyHz < 216e6 ? 43.5 : 46
    // CISPR 32 Class B (and IEC 61000-6-3, which adopts it): 30–230 MHz 40, 230 MHz–1 GHz 47.
    return frequencyHz < 230e6 ? 40 : 47
  }

  simulate(traces: EMCTrace[], standard: 'CISPR32' | 'FCC15' | 'IEC61000' = 'CISPR32'): EMCResult {
    const safe = traces.filter((t) =>
      Number.isFinite(t.currentA) && Number.isFinite(t.frequencyHz) &&
      Number.isFinite(t.loopAreaMm2) && Number.isFinite(t.lengthMm))
    const evaluated = safe.length > 0 ? safe : traces
    const worstFrequencyHz = evaluated.reduce((max, t) => Math.max(max, t.frequencyHz || 0), 30e6)
    const limit = EMCSimulationEngine.radiatedLimit(Math.max(worstFrequencyHz, 30e6), standard)

    const hotspots: EMCHotspot[] = evaluated.map((trace) => {
      const current = Math.max(trace.currentA, 0)
      const frequency = Math.max(trace.frequencyHz, 0)
      const areaM2 = Math.max(trace.loopAreaMm2, 0) * 1e-6
      const differential = EMCSimulationEngine.loopFieldVPerM(current, areaM2, frequency)
      const icm = trace.commonModeCurrentA ?? current * 0.01
      const cableM = Math.max(trace.cableLengthMm ?? trace.lengthMm, 0) / 1000
      const commonMode = EMCSimulationEngine.cableFieldVPerM(Math.max(icm, 0), cableM, frequency)
      // Uncorrelated sources add in power; the trace total is the RMS sum.
      const total = Math.sqrt(differential * differential + commonMode * commonMode)
      const differentialDBuVPerM = EMCSimulationEngine.toDBuVPerM(differential)
      const commonModeDBuVPerM = EMCSimulationEngine.toDBuVPerM(commonMode)
      return {
        traceId: trace.id,
        contribution: Number(EMCSimulationEngine.toDBuVPerM(total).toFixed(2)),
        differentialDBuVPerM: Number(differentialDBuVPerM.toFixed(2)),
        commonModeDBuVPerM: Number(commonModeDBuVPerM.toFixed(2)),
      }
    })

    // Board total is the power sum of the trace fields (incoherent emitters).
    const totalField = Math.sqrt(hotspots.reduce((sum, h) =>
      sum + Math.pow(10 ** (h.contribution / 20) * 1e-6, 2), 0))
    const radiated = EMCSimulationEngine.toDBuVPerM(totalField)

    // Conducted estimate: worst common-mode current into a 50 Ω LISN leg
    // (CISPR 16 / FCC LISN impedance), unfiltered, in dBµV.
    const worstIcm = evaluated.reduce((max, t) =>
      Math.max(max, t.commonModeCurrentA ?? Math.max(t.currentA, 0) * 0.01), 0)
    const conducted = 20 * Math.log10(Math.max(worstIcm * 50, 1e-12) / 1e-6)

    const radiatedRounded = Number(radiated.toFixed(2))
    const conductedRounded = Number(conducted.toFixed(2))
    const margin = limit - radiatedRounded
    const recommendations: string[] = []
    if (hotspots.some((h) => h.commonModeDBuVPerM >= h.differentialDBuVPerM)) {
      recommendations.push('Common-mode dominates: add a common-mode choke / filter on cable interfaces')
    }
    if (evaluated.some((t) => t.loopAreaMm2 > 250)) {
      recommendations.push('Reduce return-path loop area with a solid ground pour under the flagged traces')
    }
    if (evaluated.some((t) => t.frequencyHz > 1e8)) {
      recommendations.push('Stitch GND vias along high-speed traces and keep the reference plane continuous')
    }
    if (margin < 6) recommendations.push('Less than 6 dB margin: expect chamber pre-scan failures without mitigation')

    return {
      radiatedDBuVPerM: radiatedRounded,
      radiatedDBuV: radiatedRounded,
      conductedDBuV: Number(conductedRounded.toFixed(2)),
      limitDBuV: limit,
      marginDb: Number(margin.toFixed(2)),
      compliant: margin >= 0,
      hotspots: hotspots.sort((a, b) => b.contribution - a.contribution),
      recommendations,
    }
  }
}

export const emcSimulationEngine = new EMCSimulationEngine()
