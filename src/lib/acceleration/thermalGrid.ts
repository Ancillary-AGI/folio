/**
 * 2D steady-state PCB thermal solver.
 *
 * Discretises the thin-plate heat equation
 *
 *   k·∇²T + q''' − (2h/t)·(T − T∞) = 0
 *
 * on a uniform grid with adiabatic edges. The update below is the steady-state
 * equation rearranged so every coefficient stays positive, which makes the
 * iteration unconditionally stable for positive k, h and t:
 *
 *   T(i,j) = [k/dx²·ΣT_neighbours + q''' + (2h/t)·T∞] / (4k/dx² + 2h/t)
 *
 * Convection from both faces is folded into `2h/t`; that is the standard
 * thin-fin treatment and is why the board thickness matters even though the
 * model is two-dimensional.
 *
 * The CPU path here is the reference implementation. The WebGPU path in
 * `webgpuThermal.ts` uses the exact same coefficients from `prepareThermalGrid`
 * and the same `summariseThermalGrid`, so choosing an accelerator cannot change
 * the answer — only how quickly it is reached.
 */

export interface HeatSource {
  id: string
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
  powerWatts: number
}

export interface ThermalGridConfig {
  boardWidthMm: number
  boardHeightMm: number
  boardThicknessMm: number
  gridResolutionMm: number
  /** Effective in-plane conductivity, W/(m·K). */
  effectiveConductivityWmk: number
  /** Convection coefficient on both faces, W/(m²·K). */
  convectionCoeffWperM2K: number
  ambientTempC: number
  heatSources: HeatSource[]
}

export interface ThermalGridResult {
  cols: number
  rows: number
  gridResolutionMm: number
  peakTemperatureC: number
  averageTemperatureC: number
  hotspots: Array<{ id: string; tempC: number }>
  /** Flattened row-major [row * cols + col], °C. */
  temperatureMatrix: Float32Array
  iterations: number
  converged: boolean
}

export interface ThermalSourceRange {
  id: string
  colStart: number
  colEnd: number
  rowStart: number
  rowEnd: number
}

/** Validated geometry and coefficients shared by every accelerator. */
export interface PreparedThermalGrid {
  cols: number
  rows: number
  gridResolutionMm: number
  totalCells: number
  dxM: number
  thicknessM: number
  conduction: number
  loss: number
  centre: number
  ambientTempC: number
  /** Volumetric source term q''' per cell, W/m³. */
  powerDensityGrid: Float64Array
  sourceRanges: ThermalSourceRange[]
}

const MAX_CELLS = 250_000
export const MAX_THERMAL_ITERATIONS = 20_000
const CONVERGENCE_C = 1e-6

/**
 * Validate a configuration and build the grid every solver consumes.
 *
 * Extracted rather than duplicated so the CPU, Worker and WebGPU paths cannot
 * drift apart in source mapping or boundary treatment.
 */
export function prepareThermalGrid(config: ThermalGridConfig): PreparedThermalGrid {
  const {
    boardWidthMm,
    boardHeightMm,
    boardThicknessMm,
    gridResolutionMm,
    effectiveConductivityWmk,
    convectionCoeffWperM2K,
    ambientTempC,
    heatSources,
  } = config

  if (!(boardWidthMm > 0 && boardHeightMm > 0)) throw new Error('Board dimensions must be positive.')
  if (!(boardThicknessMm > 0)) throw new Error('Board thickness must be positive.')
  if (!(gridResolutionMm > 0)) throw new Error('Grid resolution must be positive.')
  if (!(effectiveConductivityWmk > 0)) throw new Error('Thermal conductivity must be positive.')
  if (!(convectionCoeffWperM2K >= 0)) throw new Error('Convection coefficient cannot be negative.')
  if (!Number.isFinite(ambientTempC)) throw new Error('Ambient temperature must be finite.')
  for (const source of heatSources) {
    if (!Number.isFinite(source.powerWatts) || source.powerWatts < 0) {
      throw new Error(`Heat source ${source.id} power must be a finite, non-negative number.`)
    }
  }

  const cols = Math.max(4, Math.round(boardWidthMm / gridResolutionMm))
  const rows = Math.max(4, Math.round(boardHeightMm / gridResolutionMm))
  if (cols * rows > MAX_CELLS) {
    throw new Error(
      `Thermal grid would have ${cols * rows} cells; use a coarser resolution than ${gridResolutionMm} mm.`,
    )
  }

  const dxM = gridResolutionMm * 1e-3
  const thicknessM = boardThicknessMm * 1e-3
  const cellArea = dxM * dxM
  const conduction = effectiveConductivityWmk / cellArea
  const loss = (2 * convectionCoeffWperM2K) / thicknessM
  const centre = 4 * conduction + loss

  const totalCells = cols * rows
  const cellVolume = dxM * dxM * thicknessM
  const powerDensityGrid = new Float64Array(totalCells)

  const sourceRanges = heatSources.map((source) => {
    const colStart = Math.max(0, Math.min(cols - 1, Math.floor((source.xMm - source.widthMm / 2) / gridResolutionMm)))
    const colEnd = Math.max(0, Math.min(cols - 1, Math.ceil((source.xMm + source.widthMm / 2) / gridResolutionMm)))
    const rowStart = Math.max(0, Math.min(rows - 1, Math.floor((source.yMm - source.heightMm / 2) / gridResolutionMm)))
    const rowEnd = Math.max(0, Math.min(rows - 1, Math.ceil((source.yMm + source.heightMm / 2) / gridResolutionMm)))
    const affected = Math.max(1, (colEnd - colStart + 1) * (rowEnd - rowStart + 1))
    const densityPerCell = source.powerWatts / affected / cellVolume
    for (let row = rowStart; row <= rowEnd; row += 1) {
      for (let col = colStart; col <= colEnd; col += 1) {
        powerDensityGrid[row * cols + col] += densityPerCell
      }
    }
    return { id: source.id, colStart, colEnd, rowStart, rowEnd }
  })

  return {
    cols,
    rows,
    gridResolutionMm,
    totalCells,
    dxM,
    thicknessM,
    conduction,
    loss,
    centre,
    ambientTempC,
    powerDensityGrid,
    sourceRanges,
  }
}

/**
 * Largest change one Jacobi update would make, °C.
 *
 * Used by the WebGPU path, which cannot cheaply read the grid back every
 * iteration. The CPU path measures the change of its in-place SOR sweep instead.
 */
export function thermalIterationResidual(
  prepared: PreparedThermalGrid,
  temperatures: ArrayLike<number>,
): number {
  const { cols, rows, conduction, centre, loss, ambientTempC, powerDensityGrid } = prepared
  let maxDelta = 0

  for (let row = 0; row < rows; row += 1) {
    const up = row > 0 ? row - 1 : row
    const down = row < rows - 1 ? row + 1 : row
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col
      const left = col > 0 ? col - 1 : col
      const right = col < cols - 1 ? col + 1 : col
      const neighbours =
        temperatures[row * cols + left] +
        temperatures[row * cols + right] +
        temperatures[up * cols + col] +
        temperatures[down * cols + col]
      const target =
        (conduction * neighbours + powerDensityGrid[index] + loss * ambientTempC) / centre
      const delta = Math.abs(target - temperatures[index])
      if (delta > maxDelta) maxDelta = delta
    }
  }

  return maxDelta
}

/** Build the public result from a solved temperature grid. */
export function summariseThermalGrid(
  prepared: PreparedThermalGrid,
  temperatures: ArrayLike<number>,
  iterations: number,
  converged: boolean,
): ThermalGridResult {
  const { cols, rows, totalCells, ambientTempC, sourceRanges, gridResolutionMm } = prepared

  let peak = -Infinity
  let sum = 0
  for (let index = 0; index < totalCells; index += 1) {
    const value = temperatures[index]
    sum += value
    if (value > peak) peak = value
  }

  const hotspots = sourceRanges.map((range) => {
    let hottest = ambientTempC
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      for (let col = range.colStart; col <= range.colEnd; col += 1) {
        const value = temperatures[row * cols + col]
        if (value > hottest) hottest = value
      }
    }
    return { id: range.id, tempC: Number(hottest.toFixed(2)) }
  })

  return {
    cols,
    rows,
    gridResolutionMm,
    peakTemperatureC: Number(peak.toFixed(2)),
    averageTemperatureC: Number((sum / totalCells).toFixed(2)),
    hotspots,
    temperatureMatrix: Float32Array.from(temperatures),
    iterations,
    converged,
  }
}

export function solvePcbThermalGrid(
  config: ThermalGridConfig,
  maxIterations: number = 2_000,
): ThermalGridResult {
  const prepared = prepareThermalGrid(config)
  const { cols, rows, totalCells, conduction, centre, loss, ambientTempC, powerDensityGrid } = prepared

  // Double precision internally: a 1 µK convergence target is below the
  // representable resolution of a Float32 grid at board temperatures.
  const current = new Float64Array(totalCells).fill(ambientTempC)

  /*
   * Gauss–Seidel with over-relaxation. The update is done in place so newly
   * computed neighbours feed the next cell in the same sweep.
   */
  const omega = 1.5
  const limit = Math.min(Math.max(1, Math.floor(maxIterations)), MAX_THERMAL_ITERATIONS)
  let iterations = 0
  let maxDelta = Infinity

  while (iterations < limit && maxDelta > CONVERGENCE_C) {
    iterations += 1
    maxDelta = 0
    for (let row = 0; row < rows; row += 1) {
      const up = row > 0 ? row - 1 : row
      const down = row < rows - 1 ? row + 1 : row
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col
        const left = col > 0 ? col - 1 : col
        const right = col < cols - 1 ? col + 1 : col
        const neighbours =
          current[row * cols + left] +
          current[row * cols + right] +
          current[up * cols + col] +
          current[down * cols + col]
        const target = (conduction * neighbours + powerDensityGrid[index] + loss * ambientTempC) / centre
        const delta = target - current[index]
        current[index] += omega * delta
        const magnitude = Math.abs(delta)
        if (magnitude > maxDelta) maxDelta = magnitude
      }
    }
  }

  return summariseThermalGrid(prepared, current, iterations, maxDelta <= CONVERGENCE_C)
}
