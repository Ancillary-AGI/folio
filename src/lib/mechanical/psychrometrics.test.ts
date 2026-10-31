import { describe, expect, it } from 'vitest'
import {
  analyseZoneCoolingLoad,
  dewPointC,
  humidityRatioFromRh,
  moistAirEnthalpyKJPerKg,
  moistAirState,
  relativeHumidityFromHumidityRatio,
  saturationVapourPressureKPa,
  wetBulbC,
} from './psychrometrics'

describe('psychrometric properties', () => {
  it('matches the saturation curve at 25 °C', () => {
    expect(saturationVapourPressureKPa(25)).toBeCloseTo(3.169, 2)
    expect(humidityRatioFromRh(25, 1)).toBeCloseTo(0.02008, 4)
  })

  it('computes the 25 °C / 50 % state consistently', () => {
    const state = moistAirState(25, 0.5)
    expect(state.humidityRatio).toBeCloseTo(0.00988, 4)
    expect(state.enthalpyKJPerKg).toBeCloseTo(50.32, 1)
    expect(state.dewPointC).toBeCloseTo(13.86, 1)
    expect(state.wetBulbC).toBeCloseTo(17.88, 1)
    expect(state.dewPointC).toBeLessThan(state.wetBulbC)
    expect(state.wetBulbC).toBeLessThan(25)
    expect(state.densityKgPerM3).toBeGreaterThan(1.1)
    expect(state.densityKgPerM3).toBeLessThan(1.25)
  })

  it('collapses dew point and wet bulb onto the dry bulb at saturation', () => {
    expect(dewPointC(25, 1)).toBeCloseTo(25, 6)
    expect(wetBulbC(25, 1)).toBeCloseTo(25, 6)
  })

  it('round-trips humidity ratio and relative humidity', () => {
    const ratio = humidityRatioFromRh(30, 0.6)
    expect(relativeHumidityFromHumidityRatio(30, ratio)).toBeCloseTo(0.6, 6)
  })

  it('increases enthalpy with humidity ratio at fixed temperature', () => {
    expect(moistAirEnthalpyKJPerKg(24, 0.012)).toBeGreaterThan(moistAirEnthalpyKJPerKg(24, 0.008))
  })

  it('refuses states outside the correlation', () => {
    expect(() => moistAirState(25, 1.2)).toThrow(/Relative humidity/)
    expect(() => saturationVapourPressureKPa(120)).toThrow(/Dry-bulb temperature/)
    expect(() => humidityRatioFromRh(25, 0.5, 40)).toThrow(/Atmospheric pressure/)
    expect(() => wetBulbC(25, 0)).toThrow(/Relative humidity/)
    expect(() => dewPointC(25, 0)).toThrow(/Relative humidity/)
  })
})

describe('zone cooling load', () => {
  const design = {
    indoorDryBulbC: 24,
    indoorRelativeHumidity: 0.5,
    outdoorDryBulbC: 35,
    outdoorRelativeHumidity: 0.4,
    envelopeUaWPerK: 150,
    solarGainW: 800,
    internalSensibleW: 600,
    occupantSensibleW: 400,
    occupantLatentW: 300,
    ventilationLps: 150,
    supplyDryBulbC: 13,
    ductVelocityMps: 5,
  }

  it('splits a design-day balance into sensible and latent parts', () => {
    const load = analyseZoneCoolingLoad(design)
    expect(load.envelopeW).toBeCloseTo(1650, 0)
    expect(load.ventilationSensibleW).toBeGreaterThan(1800)
    expect(load.ventilationSensibleW).toBeLessThan(1900)
    expect(load.ventilationLatentW).toBeGreaterThan(2050)
    expect(load.ventilationLatentW).toBeLessThan(2180)
    expect(load.sensibleW).toBeGreaterThan(5250)
    expect(load.sensibleW).toBeLessThan(5360)
    expect(load.latentW).toBeGreaterThan(2360)
    expect(load.latentW).toBeLessThan(2470)
    expect(load.netLoadW).toBeCloseTo(load.sensibleW + load.latentW, 6)
    expect(load.netLoadW).toBeGreaterThan(7650)
    expect(load.netLoadW).toBeLessThan(7790)
    expect(load.sensibleHeatRatio).not.toBeNull()
    expect(load.sensibleHeatRatio).toBeGreaterThan(0.68)
    expect(load.sensibleHeatRatio).toBeLessThan(0.70)
  })

  it('sizes supply air and one equivalent round duct from the sensible load', () => {
    const load = analyseZoneCoolingLoad(design)
    expect(load.supplyAirMassFlowKgPerS).toBeGreaterThan(0.47)
    expect(load.supplyAirMassFlowKgPerS).toBeLessThan(0.49)
    expect(load.supplyAirVolumeLps).toBeGreaterThan(390)
    expect(load.supplyAirVolumeLps).toBeLessThan(400)
    expect(load.equivalentDuctDiameterMm).toBeGreaterThan(312)
    expect(load.equivalentDuctDiameterMm).toBeLessThan(322)
    expect(load.condensationExpected).toBe(false)
    expect(load.notes.join(' ')).toMatch(/equivalent round duct/)
  })

  it('flags condensation when the supply is below the room dew point', () => {
    const load = analyseZoneCoolingLoad({ ...design, supplyDryBulbC: 10 })
    expect(load.indoor.dewPointC).toBeGreaterThan(10)
    expect(load.condensationExpected).toBe(true)
    expect(load.notes.join(' ')).toMatch(/must remove moisture/)
  })

  it('reports a heating balance without inventing supply airflow', () => {
    const load = analyseZoneCoolingLoad({
      indoorDryBulbC: 24,
      indoorRelativeHumidity: 0.5,
      outdoorDryBulbC: 5,
      outdoorRelativeHumidity: 0.4,
      envelopeUaWPerK: 100,
      ventilationLps: 0,
      supplyDryBulbC: 13,
    })
    expect(load.netLoadW).toBeLessThan(0)
    expect(load.sensibleHeatRatio).toBeNull()
    expect(load.supplyAirMassFlowKgPerS).toBe(0)
    expect(load.supplyAirVolumeLps).toBe(0)
    expect(load.equivalentDuctDiameterMm).toBe(0)
    expect(load.notes.join(' ')).toMatch(/not a cooling load/)
  })

  it('refuses impossible design inputs', () => {
    expect(() => analyseZoneCoolingLoad({ ...design, ventilationLps: -1 })).toThrow(/Ventilation/)
    expect(() => analyseZoneCoolingLoad({ ...design, supplyDryBulbC: 24 })).toThrow(/at least 0.5 °C below/)
    expect(() => analyseZoneCoolingLoad({ ...design, ductVelocityMps: 0 })).toThrow(/Duct velocity/)
    expect(() => analyseZoneCoolingLoad({ ...design, envelopeUaWPerK: Number.NaN })).toThrow(/Envelope UA/)
  })
})
