import { solveBioRun, type BioRunJob, type BioRunResult } from './bioRunCore'

export interface BioRunRequest {
  /** The token the caller posted; echoed back so a stale answer can be dropped. */
  token: number
  job: BioRunJob
}

export type BioRunResponse =
  | { token: number; ok: true; result: BioRunResult }
  | { token: number; ok: false; error: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BioRunRequest>) => void) | null
  postMessage: (message: BioRunResponse) => void
}

scope.onmessage = (event) => {
  const { token, job } = event.data
  try {
    scope.postMessage({ token, ok: true, result: solveBioRun(job) })
  } catch (error) {
    scope.postMessage({ token, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
