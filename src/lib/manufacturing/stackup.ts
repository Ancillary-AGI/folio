/**
 * Multilayer stackup + impedance engine (Pi-class leg 1).
 *
 * A Pi-class board is 4–8+ layers with planes and controlled impedance.
 * None of that existed. This module is the physics core: stackup with
 * symmetry/thickness checks, reference-plane assignment, microstrip +
 * stripline closed forms, pair skew, and width-for-impedance solving.
 * All dimensions in millimetres, impedance in ohms, skew in picoseconds.
 */

export interface StackupLayer {
  name: string
  kind: 'signal' | 'plane' | 'dielectric'
  /** Copper weight oz for signal/plane, thickness mm + er for dielectric. */
  thickness?: number
  er?: number
  /** Net name for planes (GND, VCC…); undefined for signal. */
  net?: string
}

export interface Stackup {
  layers: StackupLayer[]
  totalThickness: number
}

export interface StackupViolation {
  rule: 'symmetry' | 'thickness' | 'reference' | 'impedance'
  severity: 'error'
  message: string
}

/** Copper thickness: 1 oz = 0.035 mm. */
export const ozToMm = (oz: number): number => oz * 0.035

const COPPER_OZ_DEFAULT = 1

/** Validate symmetry (warp control) and total thickness. Never throws. */
export function validateStackup(layers: StackupLayer[]): { stackup: Stackup; violations: StackupViolation[] } {
  const violations: StackupViolation[] = []
  let total = 0
  let validTotal = true
  for (const layer of layers) {
    const label = layer.name || `${layer.kind} layer`
    if (layer.kind === 'dielectric') {
      if (Number.isFinite(layer.thickness) && (layer.thickness ?? -1) >= 0) {
        total += layer.thickness!
      } else {
        validTotal = false
        violations.push({
          rule: 'thickness',
          severity: 'error',
          message: `${label} dielectric thickness must be zero or positive and finite.`,
        })
      }
      if (!(Number.isFinite(layer.er) && (layer.er ?? 0) >= 1)) {
        violations.push({
          rule: 'thickness',
          severity: 'error',
          message: `${label} dielectric constant must be finite and at least 1.`,
        })
      }
      continue
    }
    const ounces = layer.thickness ?? COPPER_OZ_DEFAULT
    if (Number.isFinite(ounces) && ounces > 0) {
      total += ozToMm(ounces)
    } else {
      validTotal = false
      violations.push({
        rule: 'thickness',
        severity: 'error',
        message: `${label} copper weight must be positive and finite.`,
      })
    }
  }
  if (validTotal && (total < 0.2 || total > 4)) {
    violations.push({ rule: 'thickness', severity: 'error', message: `Stackup thickness ${total.toFixed(2)} mm outside 0.2–4 mm.` })
  }
  // Symmetry is about copper weights and dielectric — plane net names
  // (GND vs VCC) do not warp a board, so they are excluded.
  const signature = layers.map((layer) =>
    layer.kind === 'dielectric' ? `d:${layer.thickness}:${layer.er}` : `cu:${layer.thickness ?? COPPER_OZ_DEFAULT}`,
  )
  if (signature.join('|') !== [...signature].reverse().join('|')) {
    violations.push({ rule: 'symmetry', severity: 'error', message: 'Stackup asymmetric about centre — warp risk.' })
  }
  return { stackup: { layers, totalThickness: validTotal ? total : Number.NaN }, violations }
}

/** Nearest plane above/below a signal layer, with dielectric distance. */
export function nearestPlane(
  layers: StackupLayer[],
  signalIndex: number,
): { planeIndex: number; distance: number; er: number } | undefined {
  let best: { planeIndex: number; distance: number; er: number } | undefined
  const scan = (step: -1 | 1): void => {
    let distance = 0
    for (let i = signalIndex + step; i >= 0 && i < layers.length; i += step) {
      const layer = layers[i]
      if (layer.kind === 'dielectric') {
        distance += layer.thickness ?? 0
        continue
      }
      if (layer.kind === 'plane') {
        const adjacent = layers[i - step]
        const er = adjacent?.kind === 'dielectric' ? adjacent.er ?? 4.4 : 4.4
        if (!best || distance < best.distance) best = { planeIndex: i, distance, er }
      }
      break
    }
  }
  scan(-1)
  scan(1)
  return best
}

/** Microstrip impedance (Hammerstad–Jensen simplified IPC form). */
export function microstripImpedance(width: number, height: number, thickness: number, er: number): number {
  if (!(Number.isFinite(width) && width > 0) || !(Number.isFinite(height) && height > 0)) {
    throw new Error('microstrip width and dielectric height must be positive and finite')
  }
  if (!(Number.isFinite(thickness) && thickness >= 0) || !(Number.isFinite(er) && er >= 1)) {
    throw new Error('microstrip copper thickness must be >= 0 and er must be >= 1')
  }
  const erEff = (er + 1) / 2 + ((er - 1) / 2) / Math.sqrt(1 + 12 / (width / height))
  return (87 / Math.sqrt(erEff + 1.41)) * Math.log((5.98 * height) / (0.8 * width + thickness))
}

/**
 * Symmetric stripline impedance, IPC-2141:
 * Z0 = 60/√er · ln(4b / (0.67π(0.8w + t))), b = plane-to-plane spacing.
 */
export function striplineImpedance(width: number, spacing: number, thickness: number, er: number): number {
  if (!(Number.isFinite(width) && width > 0) || !(Number.isFinite(spacing) && spacing > 0)) {
    throw new Error('stripline width and plane spacing must be positive and finite')
  }
  if (!(Number.isFinite(thickness) && thickness >= 0) || !(Number.isFinite(er) && er >= 1)) {
    throw new Error('stripline copper thickness must be >= 0 and er must be >= 1')
  }
  return (60 / Math.sqrt(er)) * Math.log((4 * spacing) / (0.67 * Math.PI * (0.8 * width + thickness)))
}

/** Pair skew from routed lengths: ~6 ps/mm on FR4. Positive means P longer. */
export function pairSkewPs(lengthP: number, lengthN: number): number {
  return (lengthP - lengthN) * 6
}

/** Width for a target impedance by bisection; undefined when unreachable. */
export function widthForImpedance(
  target: number,
  geometry: { height: number; thickness: number; er: number; mode: 'microstrip' | 'stripline'; spacing?: number },
  low = 0.05,
  high = 1,
): number | undefined {
  if (!(Number.isFinite(target) && target > 0)) throw new Error('target impedance must be positive and finite')
  if (!(Number.isFinite(low) && low > 0) || !(Number.isFinite(high) && high > low)) {
    throw new Error('width search range must satisfy 0 < low < high')
  }
  const at = (w: number): number =>
    geometry.mode === 'microstrip'
      ? microstripImpedance(w, geometry.height, geometry.thickness, geometry.er)
      : striplineImpedance(w, geometry.spacing ?? geometry.height * 2, geometry.thickness, geometry.er)
  if (at(low) < target || at(high) > target) return undefined
  let lo = low
  let hi = high
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2
    if (at(mid) > target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Standard 4-layer SIG+PWR/GND/SIG stackup, 1.6 mm, symmetric. */
export function fourLayerStackup(): StackupLayer[] {
  return [
    { name: 'Top', kind: 'signal', thickness: 1 },
    { name: 'Prepreg', kind: 'dielectric', thickness: 0.2, er: 4.4 },
    { name: 'VCC', kind: 'plane', thickness: 1, net: 'VCC' },
    { name: 'Core', kind: 'dielectric', thickness: 1.1, er: 4.4 },
    { name: 'GND', kind: 'plane', thickness: 1, net: 'GND' },
    { name: 'Prepreg', kind: 'dielectric', thickness: 0.2, er: 4.4 },
    { name: 'Bottom', kind: 'signal', thickness: 1 },
  ]
}

