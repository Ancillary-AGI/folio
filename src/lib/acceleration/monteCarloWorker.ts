import { executeMonteCarloBatch, type MonteCarloBatchRequest } from './monteCarloBatch'
import type { MonteCarloRunSample } from '../simulation/monteCarlo'

export type MonteCarloWorkerResponse =
  | { ok: true; samples: MonteCarloRunSample[] }
  | { ok: false; error: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MonteCarloBatchRequest>) => void) | null
  postMessage: (message: MonteCarloWorkerResponse) => void
}

scope.onmessage = (event) => {
  try {
    scope.postMessage({ ok: true, samples: executeMonteCarloBatch(event.data) })
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
