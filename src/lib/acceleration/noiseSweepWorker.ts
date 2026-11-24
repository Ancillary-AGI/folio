import type { CircuitModel } from '../simulation/circuitModel'
import {
  solveNoiseFrequencyPoints,
  type NoiseBias,
  type NoisePoint,
} from '../simulation/noise'

export interface NoiseSweepBatchRequest {
  model: CircuitModel
  frequencies: number[]
  bias: NoiseBias
  outputIndex: number
  gmin?: number
}

export type NoiseSweepWorkerResponse =
  | { ok: true; points: NoisePoint[] }
  | { ok: false; error: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<NoiseSweepBatchRequest>) => void) | null
  postMessage: (message: NoiseSweepWorkerResponse) => void
}

scope.onmessage = (event) => {
  try {
    const { model, frequencies, bias, outputIndex, gmin } = event.data
    scope.postMessage({
      ok: true,
      points: solveNoiseFrequencyPoints(model, frequencies, bias, outputIndex, gmin),
    })
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
