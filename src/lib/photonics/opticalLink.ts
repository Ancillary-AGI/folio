/**
 * Fibre-optic link budget for on-off-keyed (OOK) intensity modulation.
 *
 * Every figure is a closed-form engineering estimate, and the estimate is
 * labelled as such:
 *
 *   • fibre and splice loss from the declared attenuation, connector and splice
 *     losses — the wavelength attenuation is an input, not a hidden lookup,
 *     because the real value depends on the installed fibre;
 *   • chromatic-dispersion broadening σ = |D|·Δλ·L and a Gaussian eye-closure
 *     penalty;
 *   • PIN receiver sensitivity with shot noise from the signal and dark current
 *     plus a declared input-referred thermal-noise density, solved from the
 *     Q-factor that corresponds to the target bit-error rate;
 *   • the ideal photon-counting bound ln(1/BER) photons per bit, reported only
 *     as a comparison — a PIN transimpedance receiver does not reach it.
 *
 * This is not a full waveform or DSP simulation. The returned `assumptions`
 * array says so next to the numbers in the UI.
 */

export const PLANCK_CONSTANT = 6.62607015e-34
export const SPEED_OF_LIGHT_M_PER_S = 299_792_458
export const ELECTRON_CHARGE = 1.602176634e-19

/** Gaussian eye-closure coefficient used in the dispersion penalty. */
const EYE_CLOSURE_COEFFICIENT = 2 * Math.PI

export interface OpticalLinkInput {
  /** Vacuum wavelength (nm). */
  wavelengthNm: number
  /** Launch power at the transmitter connector (dBm). */
  launchPowerDbm: number
  /** OOK line rate (Gbit/s). */
  bitRateGbps: number
  /** Fibre span (km). */
  lengthKm: number
  /** Fibre attenuation at the operating wavelength (dB/km). */
  attenuationDbPerKm: number
  /** Patch-panel and connector losses, dB. */
  connectorLossDb?: number
  /** Number of fusion splices over the span. */
  spliceCount?: number
  /** Loss per splice, dB. */
  spliceLossDb?: number
  /** Chromatic dispersion, ps/(nm·km). Zero for a dispersion-shifted or short link. */
  dispersionPsPerNmKm?: number
  /** Transmitter RMS spectral width, nm. */
  transmitterLinewidthNm?: number
  /** Photodiode responsivity (A/W). */
  receiverResponsivityAW?: number
  /** Input-referred receiver current noise density (A/√Hz). */
  receiverNoisePAPerSqrtHz?: number
  /** Photodiode dark current (nA). */
  darkCurrentNa?: number
  /** Target bit-error rate. */
  targetBer?: number
  /** Ageing, repair and temperature allowance, dB. */
  systemMarginDb?: number
}

export interface OpticalLinkResult {
  opticalFrequencyThz: number
  photonEnergyJ: number
  fibreLossDb: number
  spliceLossDb: number
  connectorLossDb: number
  totalPassiveLossDb: number
  /** RMS pulse broadening (ps). */
  dispersionBroadeningPs: number
  /** Broadening divided by the bit period (dimensionless). */
  dispersionRatio: number
  dispersionPenaltyDb: number
  /** Average received optical power required at the target BER (dBm). */
  receiverSensitivityDbm: number
  receivedPowerDbm: number
  /** Received power minus sensitivity minus the system allowance, dB. */
  linkMarginDb: number
  closes: boolean
  qFactor: number
  /** Average photons per bit at the computed sensitivity. */
  photonsPerBitAtSensitivity: number
  /** Ideal photon-counting OOK bound, ln(1/BER). */
  quantumLimitPhotonsPerBit: number
  assumptions: string[]
}

const optional = (value: number | undefined, fallback: number): number =>
  value === undefined ? fallback : value

/** Error function, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
export function errorFunction(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : -1
  const sign = x < 0 ? -1 : 1
  const magnitude = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * magnitude)
  const polynomial =
    0.254829592 * t -
    0.284496736 * t * t +
    1.421413741 * t * t * t -
    1.453152027 * t * t * t * t +
    1.061405429 * t * t * t * t * t
  return sign * (1 - polynomial * Math.exp(-magnitude * magnitude))
}

/** Complementary error function from the same approximation. */
export function complementaryErrorFunction(x: number): number {
  return 1 - errorFunction(x)
}

/**
 * Inverse complementary error function by bisection.
 *
 * `y` must lie strictly between 0 and 1. 80 halvings put the bracket below
 * double precision, so the answer is limited by the erfc approximation rather
 * than the search.
 */
export function inverseComplementaryErrorFunction(y: number): number {
  if (!(y > 0 && y < 1)) throw new Error('Photonics: the complementary error probability must be between 0 and 1.')
  let low = 0
  let high = 30
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const middle = (low + high) / 2
    if (complementaryErrorFunction(middle) > y) low = middle
    else high = middle
  }
  return (low + high) / 2
}

/**
 * Thermal-noise-limited PIN sensitivity.
 *
 * For OOK with equal noise on both rails, `Q = I₁ / √(2qI₁B + iₙ²B + 2qI_dB)`.
 * Solving for the photocurrent gives
 *   I₁ = Q²qB + √(Q⁴q²B² + Q²(iₙ²B + 2qI_dB)).
 * The peak optical power is I₁/R and the average power of a 50 %-ones stream is
 * half of that.
 */
export function receiverSensitivityDbm(
  bitRateBps: number,
  responsivityAW: number,
  noiseCurrentAPerSqrtHz: number,
  darkCurrentA: number,
  targetBer: number,
): { sensitivityDbm: number; photocurrentPeakA: number; qFactor: number } {
  const qFactor = Math.SQRT2 * inverseComplementaryErrorFunction(2 * targetBer)
  const bandwidth = bitRateBps
  const shotCoefficient = ELECTRON_CHARGE * bandwidth
  const variance = noiseCurrentAPerSqrtHz ** 2 * bandwidth + 2 * ELECTRON_CHARGE * darkCurrentA * bandwidth
  const peakCurrent =
    qFactor ** 2 * shotCoefficient + Math.sqrt(qFactor ** 4 * shotCoefficient ** 2 + qFactor ** 2 * variance)
  const peakPower = peakCurrent / responsivityAW
  const averagePower = peakPower / 2
  return {
    sensitivityDbm: 10 * Math.log10(averagePower / 1e-3),
    photocurrentPeakA: peakCurrent,
    qFactor,
  }
}

/** Full OOK fibre link budget. Throws on inputs that have no physical meaning. */
export function opticalLink(input: OpticalLinkInput): OpticalLinkResult {
  const wavelengthNm = input.wavelengthNm
  const bitRateGbps = input.bitRateGbps
  const lengthKm = input.lengthKm
  const attenuation = input.attenuationDbPerKm
  const targetBer = optional(input.targetBer, 1e-9)
  const responsivity = optional(input.receiverResponsivityAW, 0.8)
  const noiseDensity = optional(input.receiverNoisePAPerSqrtHz, 5e-12)
  const darkCurrentNa = optional(input.darkCurrentNa, 5)
  const connectorLossDb = optional(input.connectorLossDb, 0)
  const spliceLossDb = optional(input.spliceLossDb, 0)
  const systemMarginDb = optional(input.systemMarginDb, 3)
  const dispersion = optional(input.dispersionPsPerNmKm, 17)
  const linewidth = optional(input.transmitterLinewidthNm, 0.1)
  const spliceCount = input.spliceCount ?? 0

  if (!(wavelengthNm > 0)) throw new Error('Photonics: wavelength must be > 0 nm.')
  if (!Number.isFinite(input.launchPowerDbm)) throw new Error('Photonics: launch power must be finite.')
  if (!(bitRateGbps > 0)) throw new Error('Photonics: bit rate must be > 0 Gbit/s.')
  if (!(lengthKm >= 0)) throw new Error('Photonics: fibre length must be >= 0 km.')
  if (!(attenuation >= 0)) throw new Error('Photonics: attenuation must be >= 0 dB/km.')
  if (!(responsivity > 0)) throw new Error('Photonics: responsivity must be > 0 A/W.')
  if (!(noiseDensity >= 0)) throw new Error('Photonics: noise current density must be >= 0 A/√Hz.')
  if (!(darkCurrentNa >= 0)) throw new Error('Photonics: dark current must be >= 0 nA.')
  if (!(targetBer > 0 && targetBer < 0.5)) throw new Error('Photonics: target BER must be between 0 and 0.5.')
  if (!Number.isInteger(spliceCount) || spliceCount < 0) {
    throw new Error('Photonics: splice count must be a non-negative integer.')
  }
  if (![connectorLossDb, spliceLossDb, systemMarginDb, dispersion, linewidth].every(Number.isFinite)) {
    throw new Error('Photonics: loss allowances, dispersion and linewidth must be finite.')
  }
  if (connectorLossDb < 0 || spliceLossDb < 0 || systemMarginDb < 0) {
    throw new Error('Photonics: loss allowances must be >= 0 dB.')
  }
  if (dispersion < 0 || linewidth < 0) {
    throw new Error('Photonics: dispersion and linewidth must be >= 0.')
  }

  const wavelengthM = wavelengthNm * 1e-9
  const opticalFrequencyHz = SPEED_OF_LIGHT_M_PER_S / wavelengthM
  const photonEnergyJ = (PLANCK_CONSTANT * SPEED_OF_LIGHT_M_PER_S) / wavelengthM
  const bitPeriodS = 1 / (bitRateGbps * 1e9)

  const fibreLossDb = attenuation * lengthKm
  const spliceTotalDb = spliceCount * spliceLossDb
  const totalPassiveLossDb = fibreLossDb + spliceTotalDb + connectorLossDb

  const dispersionBroadeningPs = dispersion * linewidth * lengthKm
  const dispersionRatio = (dispersionBroadeningPs * 1e-12) / bitPeriodS
  const dispersionPenaltyDb =
    dispersionRatio > 0
      ? 5 * Math.log10(1 + (EYE_CLOSURE_COEFFICIENT * dispersionRatio) ** 2)
      : 0

  const { sensitivityDbm, qFactor } = receiverSensitivityDbm(
    bitRateGbps * 1e9,
    responsivity,
    noiseDensity,
    darkCurrentNa * 1e-9,
    targetBer,
  )

  const receivedPowerDbm =
    input.launchPowerDbm - totalPassiveLossDb - dispersionPenaltyDb
  const linkMarginDb = receivedPowerDbm - sensitivityDbm - systemMarginDb
  const averageSensitivityW = 10 ** (sensitivityDbm / 10) * 1e-3
  const photonsPerBitAtSensitivity = (averageSensitivityW * bitPeriodS) / photonEnergyJ
  const quantumLimitPhotonsPerBit = Math.log(1 / targetBer)

  return {
    opticalFrequencyThz: opticalFrequencyHz / 1e12,
    photonEnergyJ,
    fibreLossDb,
    spliceLossDb: spliceTotalDb,
    connectorLossDb,
    totalPassiveLossDb,
    dispersionBroadeningPs,
    dispersionRatio,
    dispersionPenaltyDb,
    receiverSensitivityDbm: sensitivityDbm,
    receivedPowerDbm,
    linkMarginDb,
    closes: linkMarginDb >= 0,
    qFactor,
    photonsPerBitAtSensitivity,
    quantumLimitPhotonsPerBit,
    assumptions: [
      `OOK at ${bitRateGbps.toFixed(3)} Gbit/s over a single fibre span; bit period ${(bitPeriodS * 1e12).toFixed(1)} ps.`,
      `Fibre attenuation is the declared ${attenuation.toFixed(3)} dB/km at ${wavelengthNm} nm, not a wavelength-dependent model.`,
      `Dispersion penalty is the Gaussian eye-closure estimate 5·log10(1 + (2π·B·σ)²) with σ = D·Δλ·L; it is not a waveform or DSP simulation.`,
      `Receiver sensitivity uses shot noise from the peak photocurrent plus dark current and the declared thermal-noise density, at BER ${targetBer.toExponential(1)} (Q = ${qFactor.toFixed(2)}).`,
      'No fibre nonlinearity (SPM/XPM/FWM), polarisation-mode dispersion, amplifier noise or forward-error correction is modelled.',
      'The ideal ln(1/BER) photon-per-bit figure is a comparison bound only; a PIN transimpedance receiver is many orders above it.',
    ],
  }
}
