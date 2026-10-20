import { describe, expect, it } from 'vitest';
import {
  THERMAL_GRID_WGSL,
  solvePcbThermalGrid,
} from './gpuThermalGrid';

describe('PCB Thermal Grid Solver', () => {
  it('contains valid WGSL compute shader for 2D Laplacian heat diffusion', () => {
    expect(THERMAL_GRID_WGSL).toContain('@compute');
    expect(THERMAL_GRID_WGSL).toContain('@workgroup_size(16, 16)');
    expect(THERMAL_GRID_WGSL).toContain('tCurrent');
    expect(THERMAL_GRID_WGSL).toContain('laplacian');
  });

  it('solves PCB board thermal gradient with concentrated power dissipation', () => {
    // 50mm x 50mm board with 1.6mm thickness
    // 1 Watt dissipating microcontroller in center (25, 25)
    // 25 °C ambient
    const result = solvePcbThermalGrid({
      boardWidthMm: 50,
      boardHeightMm: 50,
      boardThicknessMm: 1.6,
      gridResolutionMm: 2.0, // 25x25 grid
      effectiveConductivityWmk: 3.5,
      convectionCoeffWperM2K: 15.0,
      ambientTempC: 25.0,
      heatSources: [
        { id: 'MCU_U1', xMm: 25, yMm: 25, widthMm: 7, heightMm: 7, powerWatts: 1.0 },
      ],
    }, 150);

    expect(result.cols).toBe(25);
    expect(result.rows).toBe(25);
    expect(result.peakTemperatureC).toBeGreaterThan(25.0); // Hotter than ambient
    expect(result.averageTemperatureC).toBeGreaterThan(25.0);
    expect(result.hotspots[0].id).toBe('MCU_U1');
    expect(result.hotspots[0].tempC).toBe(result.peakTemperatureC);
    expect(result.temperatureMatrix.length).toBe(25 * 25);
  });
});
