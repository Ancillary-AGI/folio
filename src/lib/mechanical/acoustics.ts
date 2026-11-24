/**
 * Room and partition acoustics — closed-form models with named limits.
 *
 *   • mass law   — single-leaf transmission loss 20·log10(m·f) − 47 dB (field
 *                  incidence, m in kg/m², f in Hz). No coincidence dip, no
 *                  double-leaf cavity, no flanking path;
 *   • rooms      — Sabine and Eyring reverberation times from the declared
 *                  surface areas and absorption coefficients, plus the mean
 *                  absorption and room constant.
 *
 * These are the numbers an engineer uses for a first-pass check, not a
 * measurement or a wave-based room solve.
 */

export interface PartitionTransmissionLossInput {
  /** Surface mass of the leaf (kg/m²). */
  surfaceMassKgPerM2: number
  /** One-third-octave or octave band centre frequency (Hz). */
  frequencyHz: number
}

export interface PartitionTransmissionLossResult {
  transmissionLossDb: number
  /** Transmission coefficient τ = 10^(−TL/10). */
  transmissionCoefficient: number
  note: string
}

/** Mass-law transmission loss of a homogeneous single-leaf partition. */
export function partitionTransmissionLoss(input: PartitionTransmissionLossInput): PartitionTransmissionLossResult {
  const mass = input.surfaceMassKgPerM2
  const frequency = input.frequencyHz
  if (!Number.isFinite(mass) || !(mass > 0)) throw new Error('Acoustics: surface mass must be finite and > 0 kg/m².')
  if (!Number.isFinite(frequency) || !(frequency > 0)) throw new Error('Acoustics: frequency must be finite and > 0 Hz.')
  const transmissionLossDb = 20 * Math.log10(mass * frequency) - 47
  return {
    transmissionLossDb,
    transmissionCoefficient: 10 ** (-transmissionLossDb / 10),
    note: 'Mass law for a single homogeneous leaf; coincidence, cavity resonance and flanking transmission are not modelled.',
  }
}

export interface AcousticSurface {
  id?: string
  areaM2: number
  /** Absorption coefficient α, 0–1. */
  absorptionCoefficient: number
}

export interface RoomAcousticsInput {
  volumeM3: number
  surfaces: readonly AcousticSurface[]
}

export interface RoomAcousticsResult {
  /** Sabine absorption ΣαS (m²). */
  totalAbsorptionM2: number
  totalSurfaceAreaM2: number
  meanAbsorptionCoefficient: number
  /** Sabine reverberation time (s). */
  sabineRt60S: number
  /** Eyring reverberation time (s). */
  eyringRt60S: number
  /** Room constant R = Sᾱ/(1 − ᾱ) (m²). */
  roomConstantM2: number
  note: string
}

/**
 * Sabine and Eyring reverberation times.
 *
 * Sabine: RT60 = 0.161 V / A. Eyring: RT60 = 0.161 V / (−S·ln(1 − ᾱ)). Both
 * use metric units. Eyring is the better estimate above ᾱ ≈ 0.2, where Sabine's
 * assumption of a diffuse field with small absorption breaks down; the panel
 * reports both so the difference is visible rather than hidden.
 */
export function analyseRoomAcoustics(input: RoomAcousticsInput): RoomAcousticsResult {
  if (!Number.isFinite(input.volumeM3) || !(input.volumeM3 > 0)) {
    throw new Error('Acoustics: room volume must be finite and > 0 m³.')
  }
  if (input.surfaces.length === 0) throw new Error('Acoustics: at least one surface is required.')

  let totalArea = 0
  let totalAbsorption = 0
  input.surfaces.forEach((surface, index) => {
    const label = surface.id ?? `surface ${index + 1}`
    if (!Number.isFinite(surface.areaM2) || !(surface.areaM2 > 0)) {
      throw new Error(`Acoustics: ${label} needs a finite, positive area.`)
    }
    if (!Number.isFinite(surface.absorptionCoefficient) || surface.absorptionCoefficient < 0 || surface.absorptionCoefficient > 1) {
      throw new Error(`Acoustics: ${label} needs an absorption coefficient between 0 and 1.`)
    }
    totalArea += surface.areaM2
    totalAbsorption += surface.areaM2 * surface.absorptionCoefficient
  })

  if (!(totalAbsorption > 0)) {
    throw new Error('Acoustics: total absorption is zero, so the reverberation time is unbounded.')
  }

  const meanAbsorption = totalAbsorption / totalArea
  const sabine = (0.161 * input.volumeM3) / totalAbsorption
  // ln(1 − α) → −∞ as α → 1, so the Eyring time collapses to zero in a fully
  // absorbing room. Guard the limit instead of dividing by an epsilon-sized
  // denominator, which would turn silence into an enormous time.
  const eyring = meanAbsorption >= 1 ? 0 : (0.161 * input.volumeM3) / (-totalArea * Math.log(1 - meanAbsorption))
  const roomConstant = meanAbsorption >= 1 ? Number.POSITIVE_INFINITY : (totalArea * meanAbsorption) / (1 - meanAbsorption)

  return {
    totalAbsorptionM2: totalAbsorption,
    totalSurfaceAreaM2: totalArea,
    meanAbsorptionCoefficient: meanAbsorption,
    sabineRt60S: sabine,
    eyringRt60S: eyring,
    roomConstantM2: roomConstant,
    note: 'Closed-form Sabine/Eyring estimates from the declared surfaces; air absorption, furniture scattering and non-diffuse rooms are not modelled.',
  }
}

/**
 * Distance at which the direct sound equals the reverberant field:
 * r_c = 0.141·√(Q·R) for a room constant R in m² (metric). Reported as an
 * engineering aid, not measured.
 */
export function criticalDistanceM(roomConstantM2: number, directivity = 1): number {
  if (!Number.isFinite(roomConstantM2) || roomConstantM2 <= 0) {
    throw new Error('Acoustics: the room constant must be finite and > 0 m².')
  }
  if (!Number.isFinite(directivity) || directivity <= 0) {
    throw new Error('Acoustics: directivity must be finite and > 0.')
  }
  return 0.141 * Math.sqrt(directivity * roomConstantM2)
}
