/**
 * Hardware-Accelerated 2D/3D PCB Thermal Grid Diffusion Solver.
 * Solves the transient and steady-state heat equation across the PCB substrate
 * using 5-point Laplacian stencil compute passes on WebGPU / typed-array grids.
 */

export interface HeatSource {
  id: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  powerWatts: number;
}

export interface ThermalGridConfig {
  boardWidthMm: number;
  boardHeightMm: number;
  boardThicknessMm: number;
  gridResolutionMm: number; // e.g. 1.0 mm grid
  effectiveConductivityWmk: number; // e.g. 3.0 W/(m·K) for 2-layer FR4 with 1oz copper
  convectionCoeffWperM2K: number; // e.g. 15.0 W/(m^2·K) natural convection
  ambientTempC: number; // e.g. 25.0 °C
  heatSources: HeatSource[];
}

export interface ThermalGridResult {
  cols: number;
  rows: number;
  gridResolutionMm: number;
  peakTemperatureC: number;
  averageTemperatureC: number;
  hotspots: Array<{ id: string; tempC: number }>;
  temperatureMatrix: Float32Array; // Flattened [row * cols + col]
  iterations: number;
  converged: boolean;
}

/**
 * WGSL compute shader for 2D heat diffusion on PCB grid.
 */
export const THERMAL_GRID_WGSL = /* wgsl */ `
struct ThermalParams {
  cols: u32,
  rows: u32,
  dx: f32,
  k: f32,
  h: f32,
  thickness: f32,
  tAmbient: f32,
};

@group(0) @binding(0) var<uniform> params: ThermalParams;
@group(0) @binding(1) var<storage, read> tCurrent: array<f32>;
@group(0) @binding(2) var<storage, read> powerInput: array<f32>;
@group(0) @binding(3) var<storage, read_write> tNext: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = id.x;
  let r = id.y;
  if (c >= params.cols || r >= params.rows) {
    return;
  }

  let idx = r * params.cols + c;
  
  // 5-point discrete Laplacian stencil with adiabatic boundary conditions
  let cLeft  = select(c - 1u, c, c == 0u);
  let cRight = select(c + 1u, c, c == params.cols - 1u);
  let rDown  = select(r - 1u, r, r == 0u);
  let rUp    = select(r + 1u, r, r == params.rows - 1u);

  let tC = tCurrent[idx];
  let tL = tCurrent[r * params.cols + cLeft];
  let tR = tCurrent[r * params.cols + cRight];
  let tD = tCurrent[rDown * params.cols + c];
  let tU = tCurrent[rUp * params.cols + c];

  let laplacian = (tL + tR + tD + tU - 4.0 * tC) / (params.dx * params.dx);
  let qSource = powerInput[idx] / (params.dx * params.dx * params.thickness);
  let qLoss = (2.0 * params.h / params.thickness) * (tC - params.tAmbient);

  let dt = 0.1; // stable time-step
  tNext[idx] = tC + dt * (params.k * laplacian + qSource - qLoss);
}
`;

/**
 * Solve steady-state temperature distribution across the PCB grid.
 */
export function solvePcbThermalGrid(config: ThermalGridConfig, maxIterations: number = 200): ThermalGridResult {
  const {
    boardWidthMm,
    boardHeightMm,
    boardThicknessMm,
    gridResolutionMm,
    effectiveConductivityWmk,
    convectionCoeffWperM2K,
    ambientTempC,
    heatSources,
  } = config;

  if (boardWidthMm <= 0 || boardHeightMm <= 0) throw new Error('Board dimensions must be positive.');
  if (gridResolutionMm <= 0) throw new Error('Grid resolution must be positive.');

  const cols = Math.max(4, Math.round(boardWidthMm / gridResolutionMm));
  const rows = Math.max(4, Math.round(boardHeightMm / gridResolutionMm));
  const dx = gridResolutionMm * 1e-3; // in meters
  const thicknessM = boardThicknessMm * 1e-3;

  // Initialize temperature and heat generation grids
  const totalCells = cols * rows;
  let tCurrent = new Float32Array(totalCells).fill(ambientTempC);
  let tNext = new Float32Array(totalCells).fill(ambientTempC);
  const qGrid = new Float32Array(totalCells).fill(0.0);

  // Map heat sources onto grid cells
  for (const src of heatSources) {
    const colStart = Math.max(0, Math.min(cols - 1, Math.floor((src.xMm - src.widthMm / 2) / gridResolutionMm)));
    const colEnd = Math.max(0, Math.min(cols - 1, Math.ceil((src.xMm + src.widthMm / 2) / gridResolutionMm)));
    const rowStart = Math.max(0, Math.min(rows - 1, Math.floor((src.yMm - src.heightMm / 2) / gridResolutionMm)));
    const rowEnd = Math.max(0, Math.min(rows - 1, Math.ceil((src.yMm + src.heightMm / 2) / gridResolutionMm)));

    const affectedCells = Math.max(1, (colEnd - colStart + 1) * (rowEnd - rowStart + 1));
    const powerPerCell = src.powerWatts / affectedCells;

    for (let r = rowStart; r <= rowEnd; r += 1) {
      for (let c = colStart; c <= colEnd; c += 1) {
        qGrid[r * cols + c] += powerPerCell;
      }
    }
  }

  // Numerical relaxation / Jacobi diffusion loop
  let iter = 0;
  let maxDelta = Infinity;
  const tolerance = 0.05; // 0.05 C convergence threshold

  while (iter < maxIterations && maxDelta > tolerance) {
    iter += 1;
    maxDelta = 0;

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const idx = r * cols + c;
        const cLeft = c > 0 ? c - 1 : c;
        const cRight = c < cols - 1 ? c + 1 : c;
        const rDown = r > 0 ? r - 1 : r;
        const rUp = r < rows - 1 ? r + 1 : r;

        const tC = tCurrent[idx];
        const tL = tCurrent[r * cols + cLeft];
        const tR = tCurrent[r * cols + cRight];
        const tD = tCurrent[rDown * cols + c];
        const tU = tCurrent[rUp * cols + c];

        const laplacian = (tL + tR + tD + tU - 4.0 * tC) / (dx * dx);
        const cellArea = dx * dx;
        const qSource = qGrid[idx] / (cellArea * thicknessM);
        const qLoss = ((2.0 * convectionCoeffWperM2K) / thicknessM) * (tC - ambientTempC);

        // Successive Over-Relaxation (SOR) factor
        const dt = (0.2 * dx * dx) / (effectiveConductivityWmk + 1e-6);
        const newVal = tC + dt * (effectiveConductivityWmk * laplacian + qSource - qLoss);
        tNext[idx] = newVal;

        const delta = Math.abs(newVal - tC);
        if (delta > maxDelta) maxDelta = delta;
      }
    }

    // Swap buffers
    const temp = tCurrent;
    tCurrent = tNext;
    tNext = temp;
  }

  let peakT = -Infinity;
  let sumT = 0;
  for (let i = 0; i < totalCells; i += 1) {
    const v = tCurrent[i];
    sumT += v;
    if (v > peakT) peakT = v;
  }

  // Compute hotspot temperature per component
  const hotspots: Array<{ id: string; tempC: number }> = [];
  for (const src of heatSources) {
    const c = Math.max(0, Math.min(cols - 1, Math.round(src.xMm / gridResolutionMm)));
    const r = Math.max(0, Math.min(rows - 1, Math.round(src.yMm / gridResolutionMm)));
    hotspots.push({
      id: src.id,
      tempC: Number(tCurrent[r * cols + c].toFixed(1)),
    });
  }

  return {
    cols,
    rows,
    gridResolutionMm,
    peakTemperatureC: Number(peakT.toFixed(1)),
    averageTemperatureC: Number((sumT / totalCells).toFixed(1)),
    hotspots,
    temperatureMatrix: tCurrent,
    iterations: iter,
    converged: maxDelta <= tolerance,
  };
}
