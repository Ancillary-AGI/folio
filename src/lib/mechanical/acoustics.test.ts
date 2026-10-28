import { describe, expect, it } from 'vitest'
import {
  analyseRoomAcoustics,
  criticalDistanceM,
  partitionTransmissionLoss,
} from './acoustics'

describe('partition mass law', () => {
  it('matches 20 log10(m f) - 47 dB', () => {
    const result = partitionTransmissionLoss({ surfaceMassKgPerM2: 10, frequencyHz: 500 })
    expect(result.transmissionLossDb).toBeCloseTo(20 * Math.log10(5000) - 47, 12)
    expect(result.transmissionLossDb).toBeCloseTo(26.98, 1)
    expect(result.transmissionCoefficient).toBeCloseTo(10 ** (-result.transmissionLossDb / 10), 12)
  })

  it('gains about 6 dB per doubling of mass or frequency', () => {
    const base = partitionTransmissionLoss({ surfaceMassKgPerM2: 10, frequencyHz: 500 })
    const doubledMass = partitionTransmissionLoss({ surfaceMassKgPerM2: 20, frequencyHz: 500 })
    const doubledFrequency = partitionTransmissionLoss({ surfaceMassKgPerM2: 10, frequencyHz: 1000 })
    expect(doubledMass.transmissionLossDb - base.transmissionLossDb).toBeCloseTo(6.0206, 3)
    expect(doubledFrequency.transmissionLossDb - base.transmissionLossDb).toBeCloseTo(6.0206, 3)
  })

  it('rejects a non-positive mass or frequency', () => {
    expect(() => partitionTransmissionLoss({ surfaceMassKgPerM2: 0, frequencyHz: 500 })).toThrow(
      /surface mass must be finite and > 0/,
    )
    expect(() => partitionTransmissionLoss({ surfaceMassKgPerM2: 10, frequencyHz: 0 })).toThrow(
      /frequency must be finite and > 0/,
    )
  })
})

describe('room acoustics', () => {
  it('computes Sabine and Eyring reverberation from the surface table', () => {
    const result = analyseRoomAcoustics({
      volumeM3: 100,
      surfaces: [
        { id: 'floor', areaM2: 20, absorptionCoefficient: 0.5 },
      ],
    })
    expect(result.totalAbsorptionM2).toBeCloseTo(10, 12)
    expect(result.totalSurfaceAreaM2).toBeCloseTo(20, 12)
    expect(result.meanAbsorptionCoefficient).toBeCloseTo(0.5, 12)
    expect(result.sabineRt60S).toBeCloseTo((0.161 * 100) / 10, 12)
    expect(result.eyringRt60S).toBeCloseTo((0.161 * 100) / (-20 * Math.log(0.5)), 12)
    expect(result.eyringRt60S).toBeLessThan(result.sabineRt60S)
    expect(result.roomConstantM2).toBeCloseTo(20, 10)
  })

  it('weights absorption by area across several surfaces', () => {
    const result = analyseRoomAcoustics({
      volumeM3: 60,
      surfaces: [
        { id: 'ceiling', areaM2: 20, absorptionCoefficient: 0.8 },
        { id: 'walls', areaM2: 60, absorptionCoefficient: 0.1 },
        { id: 'floor', areaM2: 20, absorptionCoefficient: 0.05 },
      ],
    })
    expect(result.totalAbsorptionM2).toBeCloseTo(16 + 6 + 1, 12)
    expect(result.meanAbsorptionCoefficient).toBeCloseTo(23 / 100, 12)
    expect(result.sabineRt60S).toBeCloseTo((0.161 * 60) / 23, 12)
  })

  it('reaches the zero-time limit for a fully absorbing room rather than dividing by zero', () => {
    const result = analyseRoomAcoustics({
      volumeM3: 50,
      surfaces: [{ areaM2: 30, absorptionCoefficient: 1 }],
    })
    expect(result.sabineRt60S).toBeCloseTo((0.161 * 50) / 30, 12)
    expect(Number.isFinite(result.eyringRt60S)).toBe(true)
    expect(result.eyringRt60S).toBeLessThan(result.sabineRt60S)
    expect(result.roomConstantM2).toBe(Number.POSITIVE_INFINITY)
  })

  it('rejects an invalid coefficient, zero absorption and zero volume', () => {
    expect(() =>
      analyseRoomAcoustics({ volumeM3: 100, surfaces: [{ areaM2: 10, absorptionCoefficient: 1.2 }] }),
    ).toThrow(/coefficient between 0 and 1/)
    expect(() =>
      analyseRoomAcoustics({ volumeM3: 100, surfaces: [{ areaM2: 10, absorptionCoefficient: 0 }] }),
    ).toThrow(/total absorption is zero/)
    expect(() =>
      analyseRoomAcoustics({ volumeM3: 0, surfaces: [{ areaM2: 10, absorptionCoefficient: 0.2 }] }),
    ).toThrow(/volume must be finite and > 0/)
  })

  it('reports the critical distance from the room constant', () => {
    expect(criticalDistanceM(20)).toBeCloseTo(0.141 * Math.sqrt(20), 12)
    expect(() => criticalDistanceM(0)).toThrow(/room constant must be finite and > 0/)
  })
})
