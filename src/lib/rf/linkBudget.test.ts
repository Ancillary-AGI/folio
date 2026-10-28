import { describe, expect, it } from 'vitest'
import {
  arrayGainDb,
  atmosphericLossDb,
  candidateBandsFor,
  freeSpaceLossDb,
  linkBudget,
  noiseFloorDbm,
  numerology,
  rainAttenuationDbPerKm,
  shannonCapacityBps,
  slantRangeM,
  specificAttenuationDbPerKm,
} from './linkBudget'

/**
 * The figures below are evaluated from the textbook equations independently of
 * the module: Friis at 1 GHz/1 km, kTB at 1 MHz, Shannon at 10 dB, and the
 * ITU-R P.838 coefficient at 20 GHz. None is a recorded module output.
 */
describe('link budget', () => {
  it('matches the 92.45 dB free-space loss at 1 GHz and 1 km', () => {
    expect(freeSpaceLossDb(1e9, 1000)).toBeCloseTo(92.45, 2)
    // Doubling distance adds 6.02 dB; doubling frequency does the same.
    expect(freeSpaceLossDb(1e9, 2000) - freeSpaceLossDb(1e9, 1000)).toBeCloseTo(6.02, 2)
    expect(freeSpaceLossDb(2e9, 1000) - freeSpaceLossDb(1e9, 1000)).toBeCloseTo(6.02, 2)
  })

  it('computes a −106.98 dBm noise floor for 1 MHz and 7 dB NF', () => {
    // kTB at 290 K in 1 MHz is −113.98 dBm; the receiver adds 7 dB.
    expect(noiseFloorDbm(1e6, 7)).toBeCloseTo(-106.98, 2)
    // Ten times the bandwidth is 10 dB more noise.
    expect(noiseFloorDbm(1e7, 7) - noiseFloorDbm(1e6, 7)).toBeCloseTo(10, 6)
  })

  it('gives Shannon 69.2 Mbit/s for 20 MHz at 10 dB SNR', () => {
    expect(shannonCapacityBps(20e6, 10)).toBeCloseTo(69.19e6, -4)
  })

  it('puts the oxygen complex at 60 GHz above its neighbours', () => {
    const peak = specificAttenuationDbPerKm(60e9)
    expect(peak).toBeGreaterThan(14)
    expect(peak).toBeGreaterThan(specificAttenuationDbPerKm(40e9) * 5)
    expect(peak).toBeGreaterThan(specificAttenuationDbPerKm(80e9) * 5)
    expect(specificAttenuationDbPerKm(23e9)).toBeGreaterThan(specificAttenuationDbPerKm(20e9))
    expect(atmosphericLossDb(60e9, 1000)).toBeCloseTo(peak, 9)
  })

  it('applies ITU-R P.838 rain coefficients', () => {
    // γ = 0.0751 · 50^1.099 = 5.53 dB/km at 20 GHz.
    expect(rainAttenuationDbPerKm(20e9, 50)).toBeCloseTo(5.53, 2)
    expect(rainAttenuationDbPerKm(20e9, 0)).toBe(0)
    // A heavier rate costs more, and a longer path scales linearly.
    expect(rainAttenuationDbPerKm(20e9, 100)).toBeGreaterThan(rainAttenuationDbPerKm(20e9, 50))
  })

  it('computes the satellite slant range and its zenith limit', () => {
    expect(slantRangeM(550_000, 90)).toBeCloseTo(550_000, 0)
    // 550 km LEO at 30° elevation, from R = 6 371 km plus the altitude.
    expect(slantRangeM(550_000, 30)).toBeCloseTo(992_800, -3)
    expect(() => slantRangeM(550_000, 0)).toThrow(/elevation/)
  })

  it('closes a direct-to-cell link and reports the margin arithmetic', () => {
    const result = linkBudget({
      frequencyHz: 2e9,
      txPowerDbm: 40,
      txAntennaGainDbi: 30,
      rxAntennaGainDbi: 0,
      txLossDb: 1,
      distanceM: 1_000_000,
      bandwidthHz: 5e6,
      receiverNoiseFigureDb: 7,
      requiredEbN0Db: 5,
      bitRateBps: 1e6,
    })
    expect(result.txEirpDbm).toBeCloseTo(69, 9)
    expect(result.freeSpaceLossDb).toBeCloseTo(158.47, 1)
    expect(result.receivedPowerDbm).toBeCloseTo(69 - 158.47, 1)
    expect(result.noiseFloorDbm).toBeCloseTo(-100.01, 1)
    expect(result.snrDb).toBeCloseTo(10.53, 1)
    // 1 Mbit/s in 5 MHz is 0.2 bit/s/Hz, so Eb/N0 gains 6.99 dB over SNR.
    expect(result.spectralEfficiency).toBeCloseTo(0.2, 12)
    expect(result.ebN0Db).toBeCloseTo(result.snrDb + 6.99, 1)
    expect(result.closes).toBe(true)
    expect(result.assumptions.length).toBeGreaterThan(3)
  })

  it('turns a link into a failure when rain is added to the same path', () => {
    const clear = linkBudget({
      frequencyHz: 20e9,
      txPowerDbm: 30,
      txAntennaGainDbi: 35,
      rxAntennaGainDbi: 25,
      distanceM: 2000,
      bandwidthHz: 20e6,
      receiverNoiseFigureDb: 5,
      requiredEbN0Db: 6,
      bitRateBps: 10e6,
    })
    const rainy = linkBudget({
      frequencyHz: 20e9,
      txPowerDbm: 30,
      txAntennaGainDbi: 35,
      rxAntennaGainDbi: 25,
      distanceM: 2000,
      bandwidthHz: 20e6,
      receiverNoiseFigureDb: 5,
      requiredEbN0Db: 6,
      bitRateBps: 10e6,
      rainRateMmPerHour: 50,
    })
    // 5.53 dB/km over 2 km is 11.06 dB of rain loss.
    expect(rainy.rainLossDb).toBeCloseTo(11.06, 2)
    expect(clear.receivedPowerDbm - rainy.receivedPowerDbm).toBeCloseTo(11.06, 2)
    expect(rainy.snrDb).toBeLessThan(clear.snrDb)
  })

  it('adds 3 dB per doubling of coherent array elements', () => {
    expect(arrayGainDb(1)).toBe(0)
    expect(arrayGainDb(4)).toBeCloseTo(6.02, 2)
    expect(arrayGainDb(0)).toBe(0)
  })
})

describe('NR and candidate 6G numerology', () => {
  it('derives slot and symbol timing from the subcarrier spacing', () => {
    const fr1 = numerology(0)
    expect(fr1.subcarrierSpacingHz).toBe(15_000)
    expect(fr1.slotUs).toBe(1000)
    expect(fr1.slotsPerFrame).toBe(10)
    expect(fr1.symbolsPerFrame).toBe(140)

    const fr2 = numerology(4)
    expect(fr2.subcarrierSpacingHz).toBe(240_000)
    expect(fr2.slotUs).toBe(62.5)
    expect(fr2.slotsPerFrame).toBe(160)
    expect(fr2.symbolUs).toBeCloseTo(4.1667, 3)
    expect(fr2.sampleRateHz).toBe(240_000 * 4096)
  })

  it('rejects a numerology outside 0…6', () => {
    expect(() => numerology(7)).toThrow(/0 to 6/)
    expect(() => numerology(1.5)).toThrow(/integer/)
  })

  it('names the candidate bands a frequency falls in', () => {
    expect(candidateBandsFor(7.0e9).map((band) => band.name)).toEqual(['Upper 6 GHz'])
    expect(candidateBandsFor(8.0e9).map((band) => band.name)).toEqual(['FR3 (upper mid-band)'])
    expect(candidateBandsFor(100e9).map((band) => band.name)).toEqual(['Sub-THz 92–300 GHz'])
    expect(candidateBandsFor(1e9)).toEqual([])
  })
})
