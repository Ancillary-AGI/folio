import { describe, expect, it } from 'vitest';
import {
  HEAT_SHRINK_TUBING,
  REFLOW_PROFILES,
  getMinimumCrimpTensileForce,
  validateReflowProfile,
} from './assemblyTools';

describe('Assembly Tools & Techniques', () => {
  it('validates a compliant SAC305 reflow profile', () => {
    const sac305 = REFLOW_PROFILES.sac305;
    expect(sac305.isLeadFree).toBe(true);

    // Simulated standard thermal profile
    const validSamples = [
      { timeSec: 0, tempC: 25 },
      { timeSec: 60, tempC: 150 }, // Ramp: (150-25)/60 = 2.08 C/s <= 3.0
      { timeSec: 150, tempC: 190 }, // Soak: (190-150)/90 = 0.44 C/s
      { timeSec: 180, tempC: 220 }, // Cross liquidus (217C) at ~177s
      { timeSec: 210, tempC: 248 }, // Peak at 248 C (within 240-255)
      { timeSec: 260, tempC: 217 }, // TAL duration ~ 260 - 177 = 83s (within 60-150s)
      { timeSec: 300, tempC: 100 }, // Cooling rate (217-100)/40 = 2.9 C/s <= 6.0
    ];

    const result = validateReflowProfile(sac305, validSamples);
    expect(result.valid).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it('detects thermal shock and over-temperature violations in reflow profile', () => {
    const sac305 = REFLOW_PROFILES.sac305;
    const badSamples = [
      { timeSec: 0, tempC: 25 },
      { timeSec: 10, tempC: 150 }, // Ramp rate 12.5 C/s! > 3.0 (Thermal Shock)
      { timeSec: 50, tempC: 275 }, // Peak 275 C! > 255 (Over-temperature)
      { timeSec: 70, tempC: 50 },  // Cool rate 11.25 C/s! > 6.0
    ];

    const result = validateReflowProfile(sac305, badSamples);
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.parameter.includes('Ramp-up'))).toBe(true);
    expect(result.violations.some((v) => v.parameter.includes('Peak'))).toBe(true);
    expect(result.violations.some((v) => v.parameter.includes('Cooling'))).toBe(true);
  });

  it('enforces IPC/WHMA-A-620 crimp pull-off force limits', () => {
    expect(getMinimumCrimpTensileForce(22)).toBe(49.0);
    expect(getMinimumCrimpTensileForce(18)).toBe(111.0);
    expect(getMinimumCrimpTensileForce(12)).toBe(356.0);
    expect(() => getMinimumCrimpTensileForce(4)).toThrow(/outside/);
  });

  it('specifies dual-wall and single-wall heat shrink tubing', () => {
    expect(HEAT_SHRINK_TUBING.length).toBeGreaterThanOrEqual(4);
    const dualWall = HEAT_SHRINK_TUBING.find((h) => h.hasAdhesiveLining);
    expect(dualWall).toBeDefined();
    expect(dualWall?.shrinkRatio).toBe('3:1');
    expect(dualWall?.expandedDiameterMm).toBeGreaterThan(dualWall?.recoveredDiameterMm ?? 0);
  });
});
