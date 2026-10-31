import type { CircuitModel } from '../simulation/circuitModel'
import {
  solveAcFrequencyPoints,
  type AcBias,
  type AcFrequencyPoint,
} from '../simulation/solver'

export interface AcSweepBatchRequest {
  model: CircuitModel
  frequencies: number[]
  bias: AcBias
  gmin?: number
}

export type AcSweepWorkerResponse =
  | { ok: true; points: AcFrequencyPoint[] }
  | { ok: false; error: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AcSweepBatchRequest>) => void) | null
  postMessage: (message: AcSweepWorkerResponse) => void
}

scope.onmessage = (event) => {
  try {
    const { model, frequencies, bias, gmin } = event.data
    scope.postMessage({ ok: true, points: solveAcFrequencyPoints(model, frequencies, bias, gmin) })
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
