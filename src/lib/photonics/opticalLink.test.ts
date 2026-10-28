/**
 * Verified properties of the OOK fibre link budget.
 *
 * The eye-closure penalty is a stated Gaussian approximation, so the tests pin
 * the formula and its monotonic behaviour rather than an external measurement.
 * The error-function pair is checked against published values, the receiver
 * sensitivity against its own Q-equation, and the photon budget against hν.
 */
import { describe, expect, it } from 'vitest'
import {
  complementaryErrorFunction,
  errorFunction,
  inverseComplementaryErrorFunction,
  opticalLink,
  receiverSensitivityDbm,
} from './opticalLink'

const defaults = {
  wavelengthNm: 1550,
  launchPowerDbm: 0,
  bitRateGbps: 10,
  lengthKm: 40,
  attenuationDbPerKm: 0.2,
  connectorLossDb: 1,
  spliceCount: 8,
  spliceLossDb: 0.1,
  dispersionPsPerNmKm: 17,
  transmitterLinewidthNm: 0.1,
  receiverResponsivityAW: 0.8,
  receiverNoisePAPerSqrtHz: 5e-12,
  darkCurrentNa: 5,
  targetBer: 1e-9,
  systemMarginDb: 3,
}

describe('error functions', () => {
  it('matches published erfc values', () => {
    expect(complementaryErrorFunction(0)).toBeCloseTo(1, 7)
    expect(complementaryErrorFunction(1)).toBeCloseTo(0.157299, 5)
    expect(errorFunction(0.5)).toBeCloseTo(0.5205, 4)
    expect(errorFunction(-0.5)).toBeCloseTo(-0.5205, 4)
  })

  it('inverts the complementary error function', () => {
    for (const value of [1e-3, 1e-6, 2e-9, 0.05, 0.5]) {
      expect(complementaryErrorFunction(inverseComplementaryErrorFunction(value))).toBeCloseTo(value, 6)
    }
  })

  it('refuses a probability outside (0, 1)', () => {
    expect(() => inverseComplementaryErrorFunction(0)).toThrow(/between 0 and 1/)
    expect(() => inverseComplementaryErrorFunction(1)).toThrow(/between 0 and 1/)
  })
})

describe('receiver sensitivity', () => {
  it('solves the Q-equation it reports', () => {
    const { sensitivityDbm, photocurrentPeakA, qFactor } = receiverSensitivityDbm(10e9, 0.8, 5e-12, 5e-9, 1e-9)
    const bandwidth = 10e9
    const q = 1.602176634e-19 * bandwidth
    const variance = 5e-12 ** 2 * bandwidth + 2 * 1.602176634e-19 * 5e-9 * bandwidth
    const expected = qFactor ** 2 * q + Math.sqrt(qFactor ** 4 * q ** 2 + qFactor ** 2 * variance)
    expect(photocurrentPeakA).toBeCloseTo(expected, 12)
    expect(sensitivityDbm).toBeCloseTo(10 * Math.log10(photocurrentPeakA / 0.8 / 2 / 1e-3), 9)
    expect(qFactor).toBeGreaterThan(5.9)
    expect(qFactor).toBeLessThan(6.2)
  })

  it('needs more power as the bit rate rises', () => {
    const slow = receiverSensitivityDbm(1e9, 0.8, 5e-12, 5e-9, 1e-9)
    const fast = receiverSensitivityDbm(40e9, 0.8, 5e-12, 5e-9, 1e-9)
    expect(fast.sensitivityDbm).toBeGreaterThan(slow.sensitivityDbm)
  })
})

describe('opticalLink', () => {
  it('adds fibre, splice and connector loss and predicts a closing link', () => {
    const result = opticalLink(defaults)
    expect(result.fibreLossDb).toBeCloseTo(8, 9)
    expect(result.spliceLossDb).toBeCloseTo(0.8, 9)
    expect(result.connectorLossDb).toBe(1)
    expect(result.totalPassiveLossDb).toBeCloseTo(9.8, 9)
    expect(result.dispersionBroadeningPs).toBeCloseTo(68, 9)
    expect(result.dispersionRatio).toBeCloseTo(0.68, 9)
    expect(result.dispersionPenaltyDb).toBeCloseTo(5 * Math.log10(1 + (2 * Math.PI * 0.68) ** 2), 9)
    expect(result.receivedPowerDbm).toBeCloseTo(
      defaults.launchPowerDbm - result.totalPassiveLossDb - result.dispersionPenaltyDb,
      9,
    )
    expect(result.linkMarginDb).toBeCloseTo(result.receivedPowerDbm - result.receiverSensitivityDbm - 3, 9)
    expect(result.closes).toBe(true)
    expect(result.opticalFrequencyThz).toBeCloseTo(193.414, 2)
  })

  it('reports the photon budget honestly against the ideal bound', () => {
    const result = opticalLink(defaults)
    const bitPeriod = 1 / 10e9
    const averagePowerW = 10 ** (result.receiverSensitivityDbm / 10) * 1e-3
    expect(result.photonsPerBitAtSensitivity).toBeCloseTo((averagePowerW * bitPeriod) / result.photonEnergyJ, 6)
    expect(result.quantumLimitPhotonsPerBit).toBeCloseTo(Math.log(1e9), 9)
    expect(result.photonsPerBitAtSensitivity).toBeGreaterThan(result.quantumLimitPhotonsPerBit * 10)
    expect(result.assumptions.some((line) => line.includes('not a waveform'))).toBe(true)
  })

  it('treats a dispersion-free span as free of penalty', () => {
    const result = opticalLink({ ...defaults, dispersionPsPerNmKm: 0 })
    expect(result.dispersionBroadeningPs).toBe(0)
    expect(result.dispersionPenaltyDb).toBe(0)
  })

  it('fails a span beyond its power budget', () => {
    const result = opticalLink({ ...defaults, lengthKm: 200, spliceCount: 40 })
    expect(result.linkMarginDb).toBeLessThan(0)
    expect(result.closes).toBe(false)
  })

  it('marks a 10× lower noise density as a better receiver', () => {
    const standard = opticalLink(defaults)
    const quiet = opticalLink({ ...defaults, receiverNoisePAPerSqrtHz: 5e-13 })
    expect(quiet.receiverSensitivityDbm).toBeLessThan(standard.receiverSensitivityDbm)
    expect(quiet.linkMarginDb).toBeGreaterThan(standard.linkMarginDb)
  })

  it('refuses nonsensical inputs', () => {
    expect(() => opticalLink({ ...defaults, wavelengthNm: 0 })).toThrow(/wavelength/)
    expect(() => opticalLink({ ...defaults, bitRateGbps: 0 })).toThrow(/bit rate/)
    expect(() => opticalLink({ ...defaults, lengthKm: -1 })).toThrow(/length/)
    expect(() => opticalLink({ ...defaults, attenuationDbPerKm: -0.2 })).toThrow(/attenuation/)
    expect(() => opticalLink({ ...defaults, receiverResponsivityAW: 0 })).toThrow(/responsivity/)
    expect(() => opticalLink({ ...defaults, targetBer: 0.6 })).toThrow(/target BER/)
    expect(() => opticalLink({ ...defaults, spliceCount: 1.5 })).toThrow(/splice count/)
    expect(() => opticalLink({ ...defaults, launchPowerDbm: Number.NaN })).toThrow(/launch power/)
    expect(() => opticalLink({ ...defaults, systemMarginDb: Number.POSITIVE_INFINITY })).toThrow(/finite/)
  })
})
