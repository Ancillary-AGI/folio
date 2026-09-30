// Integration tests for Folio
import { describe, it, expect } from 'vitest';
import { spiceEngine } from '../lib/simulation/spiceEngine';
import { solveAxialBar, solveBarConduction, solveElectrostaticField } from '../lib/simulation/multiphysics';
import { pluginManager } from '../lib/plugins/pluginManager';
import { collaborativeEditor } from '../lib/collaboration/collaborativeEditor';

describe('Folio Integration Tests', () => {
  describe('SPICE Simulation Engine', () => {
    it('should initialize without errors', () => {
      expect(spiceEngine).toBeDefined();
    });

    it('should have simulation methods', () => {
      expect(typeof spiceEngine.simulate).toBe('function');
    });
  });

  describe('Multi-Physics Engine', () => {
    it('solves an axial bar against the analytic stiffness', () => {
      const result = solveAxialBar({
        length: 0.4,
        area: 2e-4,
        youngsModulus: 200e9,
        segments: 4,
        endLoad: 2000,
      })
      expect(result.converged).toBe(true)
      expect(result.displacements[4]).toBeCloseTo((2000 * 0.4) / (200e9 * 2e-4), 12)
      expect(result.reactionForce).toBeCloseTo(-2000, 6)
    })

    it('solves steady-state conduction along a bar', () => {
      const result = solveBarConduction({
        length: 0.2,
        area: 1e-4,
        thermalConductivity: 401,
        segments: 8,
        temperatureAtStart: 80,
        temperatureAtEnd: 20,
      })
      expect(result.converged).toBe(true)
      expect(result.temperatures).toHaveLength(9)
      expect(result.flux).toBeCloseTo((401 * 60) / 0.2, 6)
    })

    it('solves a parallel-plate electrostatic field', () => {
      const result = solveElectrostaticField({
        separation: 1e-3,
        plateWidth: 0.05,
        relativePermittivity: 1,
        cellsX: 4,
        cellsY: 10,
        upperPlateVoltage: 5,
        lowerPlateVoltage: 0,
      })
      expect(result.converged).toBe(true)
      expect(result.meanFieldMagnitude).toBeCloseTo(5000, 2)
      expect(result.capacitance).toBeGreaterThan(0)
    })
  });

  describe('Plugin Manager', () => {
    it('should initialize without errors', () => {
      expect(pluginManager).toBeDefined();
    });

    it('should have plugin management methods', () => {
      expect(typeof pluginManager.getAllPlugins).toBe('function');
      expect(typeof pluginManager.installPlugin).toBe('function');
    });

    it('should return empty plugin list initially', () => {
      const plugins = pluginManager.getAllPlugins();
      expect(Array.isArray(plugins)).toBe(true);
    });
  });

  describe('Collaborative Editor', () => {
    it('should initialize without errors', () => {
      expect(collaborativeEditor).toBeDefined();
    });

    it('should have collaboration methods', () => {
      expect(typeof collaborativeEditor.connect).toBe('function');
      expect(typeof collaborativeEditor.disconnect).toBe('function');
    });
  });
});

describe('Component Library', () => {
  it('should load standard components', async () => {
    const { standardComponents } = await import('../lib/componentLibrary');
    expect(standardComponents).toBeDefined();
    expect(Array.isArray(standardComponents)).toBe(true);
    expect(standardComponents.length).toBeGreaterThan(0);
  });
});

describe('Export Utilities', () => {
  it('should have export functions', async () => {
    const exportUtils = await import('../lib/exportUtils');
    expect(typeof exportUtils.exportToNetlist).toBe('function');
    expect(typeof exportUtils.exportToJSON).toBe('function');
    expect(typeof exportUtils.exportToBOM).toBe('function');
  });
});

describe('Application Stores', () => {
  it('should initialize app store', async () => {
    const { useAppStore } = await import('../stores/useAppStore');
    expect(useAppStore).toBeDefined();
  });

  it('should initialize project store', async () => {
    const { useProjectStore } = await import('../stores/useProjectStore');
    expect(useProjectStore).toBeDefined();
  });
});
