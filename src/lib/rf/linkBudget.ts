/**
 * Radio link budget, atmospheric and rain loss, satellite slant range, and NR
 * numerology.
 *
 * Every figure here is a closed-form engineering estimate:
 *
 *   • free-space loss from the Friis equation,
 *   • atmospheric loss from ITU-R P.676 sea-level spot values, log-interpolated
 *     — accurate enough to force a link onto a different band, not a substitute
 *     for the full line-by-line calculation,
 *   • rain loss from ITU-R P.838 k/α coefficients for horizontal polarisation,
 *   • thermal noise from kTB with the receiver's declared noise figure,
 *   • Shannon capacity and the Eb/N0 conversion that follows from it.
 *
 * The result carries its own assumptions so a UI can print them next to the
 * margin instead of presenting a single number as a measured guarantee.
 */

export const BOLTZMANN = 1.380649e-23
export const REFERENCE_TEMPERATURE_K = 290
export const EARTH_RADIUS_M = 6_371_000
export const SPEED_OF_LIGHT = 299_792_458

export interface LinkBudgetInput {
  frequencyHz: number
  /** Transmitter output power at the connector, dBm. */
  txPowerDbm: number
  /** Antenna gains, dBi, including any array gain the caller has already added. */
  txAntennaGainDbi: number
  rxAntennaGainDbi: number
  /** Feed and connector losses, dB (positive numbers are losses). */
  txLossDb?: number
  rxLossDb?: number
  /** Path length; for a satellite pass use `slantRangeM`. */
  distanceM: number
  bandwidthHz: number
  receiverNoiseFigureDb: number
  /** Modem requirement before coding margin, dB. */
  requiredEbN0Db: number
  bitRateBps: number
  /** Include the sea-level atmospheric model over the path. */
  atmospheric?: boolean
  /** Rainfall rate, mm/h; zero or absent disables rain loss. */
  rainRateMmPerHour?: number
  /** Any further loss (body, foliage, clutter), dB. */
  additionalLossDb?: number
  /** Coherent transmit/receive elements; each doubles power (+3 dB). */
  txElements?: number
  rxElements?: number
}

export interface LinkBudgetResult {
  wavelengthM: number
  freeSpaceLossDb: number
  atmosphericLossDb: number
  rainLossDb: number
  txEirpDbm: number
  receivedPowerDbm: number
  noiseFloorDbm: number
  snrDb: number
  spectralEfficiency: number
  ebN0Db: number
  shannonCapacityBps: number
  /** Received Eb/N0 minus the modem requirement. Negative means the link fails. */
  linkMarginDb: number
  closes: boolean
  assumptions: string[]
}

const positive = (value: number | undefined): number =>
  value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, value)

/** Coherent array gain over one element, dB. */
export function arrayGainDb(elements: number | undefined): number {
  const count = elements === undefined || !Number.isFinite(elements) ? 1 : Math.max(1, Math.floor(elements))
  return 10 * Math.log10(count)
}

/** Free-space path loss, dB. */
export function freeSpaceLossDb(frequencyHz: number, distanceM: number): number {
  if (!(frequencyHz > 0) || !(distanceM > 0)) return Number.POSITIVE_INFINITY
  return 20 * Math.log10((4 * Math.PI * distanceM * frequencyHz) / SPEED_OF_LIGHT)
}

/**
 * Sea-level specific attenuation, dB/km, tabulated from the ITU-R P.676 curves
 * and log-interpolated between points.
 *
 * A two-line Lorentzian was tried first and was wrong by more than an order of
 * magnitude in the windows between lines: a Lorentzian wing spreads 183 GHz
 * absorption all the way down to 2.4 GHz. The line complex is not a single
 * Lorentzian, so this uses spot values instead:
 *
 *   60 GHz oxygen complex 15 dB/km, 118/183 GHz oxygen and water lines, the
 *   22.235 GHz water line, and the low-loss windows at 2–10, 30–40 and 80–100 GHz.
 *
 * Between tabulated frequencies the log of attenuation against the log of
 * frequency is interpolated. This is a design estimate at sea level, 7.5 g/m³
 * water vapour and 15 °C — not the full line-by-line calculation, and not valid
 * for an elevated or dry site without rescaling.
 */
const ATMOSPHERE_TABLE: ReadonlyArray<readonly [number, number]> = [
  [1, 0.006],
  [2, 0.007],
  [5, 0.008],
  [10, 0.012],
  [15, 0.03],
  [20, 0.06],
  [23, 0.15],
  [30, 0.12],
  [40, 0.25],
  [50, 0.9],
  [60, 15],
  [70, 4.5],
  [80, 0.5],
  [90, 0.35],
  [100, 0.45],
  [120, 1.0],
  [140, 1.8],
  [160, 5],
  [183, 30],
  [200, 12],
  [250, 6],
  [300, 15],
]

export function specificAttenuationDbPerKm(frequencyHz: number): number {
  const f = frequencyHz / 1e9
  if (!(f > 0)) return 0
  const [firstF, firstGamma] = ATMOSPHERE_TABLE[0]
  if (f < firstF) return firstGamma * (f / firstF) ** 2
  for (let index = 1; index < ATMOSPHERE_TABLE.length; index += 1) {
    const [upper, gamma2] = ATMOSPHERE_TABLE[index]
    if (f <= upper) {
      const [lower, gamma1] = ATMOSPHERE_TABLE[index - 1]
      const t = Math.log(f / lower) / Math.log(upper / lower)
      return Math.exp(Math.log(gamma1) + t * (Math.log(gamma2) - Math.log(gamma1)))
    }
  }
  const [lastF, lastGamma] = ATMOSPHERE_TABLE[ATMOSPHERE_TABLE.length - 1]
  return lastGamma * (f / lastF) ** 2
}

/** ITU-R P.838 horizontal-polarisation k/α at spot frequencies, 1–100 GHz. */
const RAIN_COEFFICIENTS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0.0000387, 0.912],
  [2, 0.000154, 0.963],
  [4, 0.00065, 1.121],
  [6, 0.00175, 1.308],
  [8, 0.00454, 1.327],
  [10, 0.0101, 1.276],
  [12, 0.0188, 1.217],
  [15, 0.0367, 1.154],
  [20, 0.0751, 1.099],
  [30, 0.187, 1.021],
  [40, 0.525, 0.949],
  [50, 1.12, 0.912],
  [60, 1.73, 0.895],
  [80, 2.46, 0.868],
  [100, 3.07, 0.826],
]

/** Specific rain attenuation, dB/km, γ = k·R^α. */
export function rainAttenuationDbPerKm(frequencyHz: number, rainRateMmPerHour: number): number {
  const rate = positive(rainRateMmPerHour)
  if (rate === 0) return 0
  const f = frequencyHz / 1e9
  if (!(f > 0)) return 0
  if (f <= RAIN_COEFFICIENTS[0][0]) {
    const [, k, alpha] = RAIN_COEFFICIENTS[0]
    return k * rate ** alpha
  }
  for (let index = 1; index < RAIN_COEFFICIENTS.length; index += 1) {
    const [upper, k2, a2] = RAIN_COEFFICIENTS[index]
    if (f <= upper) {
      const [lower, k1, a1] = RAIN_COEFFICIENTS[index - 1]
      // Log-log interpolation matches how k and α themselves vary.
      const t = Math.log(f / lower) / Math.log(upper / lower)
      return Math.exp(Math.log(k1) + t * (Math.log(k2) - Math.log(k1))) * rate ** (a1 + t * (a2 - a1))
    }
  }
  const [, k, alpha] = RAIN_COEFFICIENTS[RAIN_COEFFICIENTS.length - 1]
  return k * rate ** alpha
}

/** Atmospheric loss over a horizontal path, dB. */
export function atmosphericLossDb(frequencyHz: number, distanceM: number): number {
  return (specificAttenuationDbPerKm(frequencyHz) * distanceM) / 1000
}

/** Rain loss over a horizontal path, dB. */
export function rainLossDb(frequencyHz: number, rainRateMmPerHour: number, distanceM: number): number {
  return (rainAttenuationDbPerKm(frequencyHz, rainRateMmPerHour) * distanceM) / 1000
}

/**
 * Slant range from a ground terminal to a satellite, metres.
 *
 * `elevationDeg` is the elevation above the local horizon; 90° is zenith.
 */
export function slantRangeM(altitudeM: number, elevationDeg: number, earthRadiusM = EARTH_RADIUS_M): number {
  if (!(altitudeM >= 0) || !(elevationDeg > 0) || !(elevationDeg <= 90)) {
    throw new Error('Satellite altitude must be >= 0 and elevation must be in (0, 90] degrees.')
  }
  const theta = (elevationDeg * Math.PI) / 180
  const r = earthRadiusM + altitudeM
  return Math.sqrt(r * r - (earthRadiusM * Math.cos(theta)) ** 2) - earthRadiusM * Math.sin(theta)
}

/** One-way thermal noise floor, dBm, for a declared bandwidth and noise figure. */
export function noiseFloorDbm(bandwidthHz: number, noiseFigureDb: number): number {
  if (!(bandwidthHz > 0)) return Number.NEGATIVE_INFINITY
  const kTBWatts = BOLTZMANN * REFERENCE_TEMPERATURE_K * bandwidthHz
  return 10 * Math.log10(kTBWatts) + 30 + noiseFigureDb
}

/** Shannon capacity, bit/s. */
export function shannonCapacityBps(bandwidthHz: number, snrDb: number): number {
  const snr = 10 ** (snrDb / 10)
  return bandwidthHz * Math.log2(1 + snr)
}

export function linkBudget(input: LinkBudgetInput): LinkBudgetResult {
  if (!(input.frequencyHz > 0)) throw new Error('Link frequency must be > 0 Hz.')
  if (!(input.distanceM > 0)) throw new Error('Link distance must be > 0 m.')
  if (!(input.bandwidthHz > 0)) throw new Error('Link bandwidth must be > 0 Hz.')
  if (!(input.bitRateBps > 0)) throw new Error('Bit rate must be > 0 bit/s.')

  const wavelengthM = SPEED_OF_LIGHT / input.frequencyHz
  const fspl = freeSpaceLossDb(input.frequencyHz, input.distanceM)
  const atmosphere = input.atmospheric ? atmosphericLossDb(input.frequencyHz, input.distanceM) : 0
  const rain = rainLossDb(input.frequencyHz, positive(input.rainRateMmPerHour), input.distanceM)
  const txGain = input.txAntennaGainDbi + arrayGainDb(input.txElements)
  const rxGain = input.rxAntennaGainDbi + arrayGainDb(input.rxElements)
  const txLoss = positive(input.txLossDb)
  const rxLoss = positive(input.rxLossDb)
  const extra = positive(input.additionalLossDb)
  const eirp = input.txPowerDbm + txGain - txLoss
  const received = eirp - fspl - atmosphere - rain - extra + rxGain - rxLoss
  const noise = noiseFloorDbm(input.bandwidthHz, input.receiverNoiseFigureDb)
  const snr = received - noise
  const spectralEfficiency = input.bitRateBps / input.bandwidthHz
  // Eb/N0 = SNR − 10log10(R/B); each bit sharing more bandwidth needs less SNR.
  const ebN0 = snr - 10 * Math.log10(spectralEfficiency)
  const margin = ebN0 - input.requiredEbN0Db

  return {
    wavelengthM,
    freeSpaceLossDb: fspl,
    atmosphericLossDb: atmosphere,
    rainLossDb: rain,
    txEirpDbm: eirp,
    receivedPowerDbm: received,
    noiseFloorDbm: noise,
    snrDb: snr,
    spectralEfficiency,
    ebN0Db: ebN0,
    shannonCapacityBps: shannonCapacityBps(input.bandwidthHz, snr),
    linkMarginDb: margin,
    closes: margin >= 0,
    assumptions: [
      'Free-space loss from Friis; no multipath, blockage or antenna misalignment is included.',
      'Atmospheric loss is interpolated from ITU-R P.676 sea-level spot values, not a line-by-line calculation; it assumes 7.5 g/m³ water vapour.',
      'Rain uses ITU-R P.838 horizontal-polarisation coefficients over the whole path length; no rain-cell or path-reduction factor is applied.',
      'Noise is kTB at 290 K plus the declared noise figure; interference and phase noise are excluded.',
      'Shannon capacity is an upper bound on a memoryless AWGN channel, not a modem throughput.',
    ],
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * NR / candidate 6G numerology
 * ──────────────────────────────────────────────────────────────────────────── */

export interface Numerology {
  mu: number
  subcarrierSpacingHz: number
  /** OFDM symbol length excluding the cyclic prefix, seconds. */
  symbolUs: number
  /** Slot length including the normal cyclic prefix, µs. */
  slotUs: number
  slotsPerFrame: number
  slotsPerSubframe: number
  /** 10 ms frame carries this many symbols of the given numerology. */
  symbolsPerFrame: number
  /** Highest FFT size NR defines, and the resulting sample rate. */
  fftSize: number
  sampleRateHz: number
}

/**
 * NR numerology for µ = 0…4 (15–240 kHz), plus the µ = 6 research point used in
 * sub-THz studies. Slot duration follows 1 ms / 2^µ; the symbol duration is
 * 1 / SCS. Normal cyclic prefix overhead is about 7 %, so a slot is 14 symbols.
 */
export function numerology(mu: number): Numerology {
  if (!Number.isInteger(mu) || mu < 0 || mu > 6) {
    throw new Error('Numerology µ must be an integer from 0 to 6.')
  }
  const scs = 15_000 * 2 ** mu
  const slotSeconds = 1e-3 / 2 ** mu
  return {
    mu,
    subcarrierSpacingHz: scs,
    symbolUs: 1e6 / scs,
    slotUs: slotSeconds * 1e6,
    slotsPerFrame: Math.round(10e-3 / slotSeconds),
    slotsPerSubframe: Math.round(1e-3 / slotSeconds),
    symbolsPerFrame: Math.round(10e-3 / slotSeconds) * 14,
    fftSize: 4096,
    sampleRateHz: scs * 4096,
  }
}

/**
 * Candidate bands studied for 6G, with the range each one covers. They are
 * research and WRC agenda items, not allocations this module can promise.
 */
export interface CandidateBand {
  name: string
  startHz: number
  stopHz: number
  note: string
}

export const CANDIDATE_6G_BANDS: readonly CandidateBand[] = [
  {
    name: 'Upper 6 GHz',
    startHz: 6.425e9,
    stopHz: 7.125e9,
    note: 'Licensed mobile candidate; rain and atmosphere are still modest.',
  },
  {
    name: 'FR3 (upper mid-band)',
    startHz: 7.125e9,
    stopHz: 8.4e9,
    note: 'Wide contiguous blocks with macro-cell-like propagation.',
  },
  {
    name: '10–15 GHz',
    startHz: 10e9,
    stopHz: 15e9,
    note: 'Capacity layer; rain fade becomes material above 10 GHz.',
  },
  {
    name: 'Sub-THz 92–300 GHz',
    startHz: 92e9,
    stopHz: 300e9,
    note: 'Short-range research band; oxygen and water-vapour lines dominate.',
  },
]

/** Bands whose range covers a frequency, with the band name. */
export function candidateBandsFor(frequencyHz: number): CandidateBand[] {
  return CANDIDATE_6G_BANDS.filter((band) => frequencyHz >= band.startHz && frequencyHz <= band.stopHz)
}
