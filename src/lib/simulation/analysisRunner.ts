/**
 * Analysis dispatch: one analysis request against a built circuit model.
 *
 * This lives apart from the `spiceEngine` facade so a Worker can execute a
 * single run without pulling in the facade (and, through it, the acceleration
 * dispatcher that spawns workers). The numerics are unchanged: each branch
 * delegates to the solver module that owns it.
 */

import type { CircuitModel } from './circuitModel'
import { runMonteCarlo } from './monteCarlo'
import { runNoiseAnalysis } from './noise'
import { runAcSweep, runDcSweep, runOperatingPoint, runTransient, type AnalysisOutcome } from './solver'
import type { SimulationParameters } from './spiceEngine'

export const DEFAULT_TEMPERATURE_CELSIUS = 27

/** The analysis temperature, refusing values at or below absolute zero. */
export function resolveTemperatureCelsius(parameters: SimulationParameters): number {
  const temperatureCelsius = parameters.temperature ?? DEFAULT_TEMPERATURE_CELSIUS
  if (!Number.isFinite(temperatureCelsius) || temperatureCelsius <= -273.15) {
    throw new Error('Temperature must be a finite value above absolute zero (-273.15 °C).')
  }
  return temperatureCelsius
}

/** Run the analysis requested by `parameters` against `model`. */
export function runCircuitAnalysis(model: CircuitModel, parameters: SimulationParameters): AnalysisOutcome {
  const temperatureCelsius = resolveTemperatureCelsius(parameters)

  switch (parameters.type) {
    case 'dc':
      return runOperatingPoint(model, { temperatureCelsius }).outcome

    case 'dc-sweep': {
      /*
       * `sweepSource` doubles as the selector between the two things SPICE's
       * `.dc` can step: a component, or the temperature when it is `TEMP`.
       */
      const sweepsTemperature = (parameters.sweepSource ?? '').trim().toUpperCase() === 'TEMP'
      return runDcSweep(model, {
        temperatureCelsius,
        deviceName: sweepsTemperature ? undefined : parameters.sweepSource,
        sweepTemperature: sweepsTemperature,
        startValue: parameters.sweepStart ?? 0,
        stopValue: parameters.sweepStop ?? 5,
        stepValue: parameters.sweepStep ?? 0.1,
      }).outcome
    }

    case 'transient':
      return runTransient(model, {
        temperatureCelsius,
        stopTime: parameters.stopTime ?? 1e-3,
        stepTime: parameters.stepTime ?? 1e-6,
        useInitialConditions: parameters.useInitialConditions ?? false,
        integrationMethod: parameters.integrationMethod ?? 'backward-euler',
      })

    case 'ac':
      return runAcSweep(model, {
        temperatureCelsius,
        startFrequency: parameters.startFreq ?? 10,
        stopFrequency: parameters.stopFreq ?? 1e6,
        pointsPerDecade: parameters.pointsPerDecade ?? 20,
      })

    case 'noise':
      return runNoiseAnalysis(model, {
        temperatureCelsius,
        startFrequency: parameters.startFreq ?? 10,
        stopFrequency: parameters.stopFreq ?? 1e6,
        pointsPerDecade: parameters.pointsPerDecade ?? 10,
        outputNode: parameters.outputNode,
      })

    case 'montecarlo': {
      /*
       * The tolerance sweep measures the DC operating point: "how far does my
       * bias move over tolerance?". Every run is a full bias solve; the panel
       * exposes no waveform parent for this analysis, so claiming to repeat one
       * would misdescribe the result.
       */
      const parent: SimulationParameters = { ...parameters, type: 'dc' }
      return runMonteCarlo(model, (perturbed) => runCircuitAnalysis(perturbed, parent), {
        iterations: parameters.iterations ?? 100,
        tolerance: parameters.tolerance ?? 0.05,
        seed: parameters.seed,
      })
    }
  }
}
