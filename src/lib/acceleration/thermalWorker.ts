import { solvePcbThermalGrid, type ThermalGridConfig, type ThermalGridResult } from './thermalGrid'

export interface ThermalWorkerRequest {
  config: ThermalGridConfig
  maxIterations: number
}

export type ThermalWorkerResponse =
  | { ok: true; result: ThermalGridResult }
  | { ok: false; error: string }

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ThermalWorkerRequest>) => void) | null
  postMessage: (message: ThermalWorkerResponse, transfer?: Transferable[]) => void
}

scope.onmessage = (event) => {
  try {
    const result = solvePcbThermalGrid(event.data.config, event.data.maxIterations)
    scope.postMessage({ ok: true, result }, [result.temperatureMatrix.buffer])
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
