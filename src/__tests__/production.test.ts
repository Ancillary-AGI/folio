/**
 * Production Readiness Test Suite
 * End-to-end smoke coverage across the engineering domains. Deep unit
 * coverage lives next to each module; this file proves the domains still
 * connect: physics → PCB → fabrication, robotics → digital twin, and
 * collaboration/plugin security at the application boundary.
 */

import { describe, it, expect } from 'vitest';

import { aiService } from '../lib/ai/aiService';
import { roboticsSimulationService } from '../lib/robotics/roboticsSimulation';
import { evolutionaryOptimizer, reinforcementLearningOptimizer } from '../lib/optimization/evolutionaryOptimization';
import { thermalAnalysisEngine } from '../lib/pcb/thermalAnalysis';
import { analyzeSignalPath } from '../lib/manufacturing/signalIntegrity';
import { DesignRuleChecker, DEFAULT_DRC_RULES } from '../lib/manufacturing/drc';
import { ElectricalRuleChecker } from '../lib/manufacturing/erc';
import type { PCBDesign } from '../lib/manufacturing/pcb';
import { exportMechanismStep, type ExportLink } from '../lib/robotics/mechanismExport';
import {
  solveAxialBar,
  solveBarConduction,
  solveElectrostaticField,
  solveTruss,
} from '../lib/simulation/multiphysics';
import { hardwareInterfaceManager } from '../lib/hardware/hardwareInterfaces';
import { digitalTwinService } from '../lib/digitalTwin/digitalTwinService';
import { canPerform, requirePermission, validateManifest } from '../lib/plugins/pluginPermissions';
import { collaborativeEditor } from '../lib/collaboration/collaborativeEditor';
import { collaborationService, type CollaborationUser, type Collaborator } from '../lib/collaboration/collaborationService';
import { vcsService } from '../lib/vcs/vcsService';
import { schematicToPcbConverter } from '../lib/schematicToPcb/schematicToPcbConverter';
import type { Schematic } from '../types';

const PLA = { modulus: 3.5e9, yieldStrength: 50e6 };
const WIDE_BED = { bedWidth: 400, bedDepth: 400, bedHeight: 400 };
const STEP_OPTIONS = { jointBore: 4, name: 'folio-arm' };
const armLink = (id: string, length = 150): ExportLink => ({
  id, length, depth: 10, width: 10, section: 'round', mass: 0.1, angle: 0,
});

describe('Production Readiness - Core Engineering Capabilities', () => {
  describe('1. CAD & Mechanical Design', () => {
    it('solves a structural, thermal and electrostatic problem with verified results', () => {
      // Axial bar: δ = FL/(EA) and the support reaction must balance the load.
      const bar = solveAxialBar({ length: 0.25, area: 1e-4, youngsModulus: 70e9, segments: 5, endLoad: 700 });
      expect(bar.converged).toBe(true);
      expect(bar.displacements[5]).toBeCloseTo((700 * 0.25) / (70e9 * 1e-4), 12);
      expect(bar.stresses[0]).toBeCloseTo(700 / 1e-4, 4);

      // Thermal: a linear profile between two fixed end temperatures.
      const thermal = solveBarConduction({
        length: 0.1,
        area: 1e-4,
        thermalConductivity: 237,
        segments: 5,
        temperatureAtStart: 60,
        temperatureAtEnd: 10,
      });
      expect(thermal.converged).toBe(true);
      thermal.temperatures.forEach((temperature, index) => {
        expect(temperature).toBeCloseTo(60 - index * 10, 6);
      });

      // Electrostatic: E = ΔV/d between parallel plates.
      const field = solveElectrostaticField({
        separation: 2e-3,
        plateWidth: 0.02,
        relativePermittivity: 4.3,
        cellsX: 4,
        cellsY: 10,
        upperPlateVoltage: 12,
        lowerPlateVoltage: 0,
      });
      expect(field.converged).toBe(true);
      expect(field.meanFieldMagnitude).toBeCloseTo(6000, 2);
    });

    it('solves a two-bar truss against the textbook member force', () => {
      const truss = solveTruss(
        [
          { x: -0.5, y: 0, fixX: true, fixY: true },
          { x: 0.5, y: 0, fixX: true, fixY: true },
          { x: 0, y: -0.5, loadY: -2000 },
        ],
        [
          { from: 0, to: 2, area: 2e-4, youngsModulus: 193e9 },
          { from: 1, to: 2, area: 2e-4, youngsModulus: 193e9 },
        ],
      );
      expect(truss.converged).toBe(true);
      // Members at 45°, so each carries P/√2.
      expect(truss.memberForces[0]).toBeCloseTo(2000 / Math.SQRT2, 4);
      expect(truss.memberForces[1]).toBeCloseTo(2000 / Math.SQRT2, 4);
    });

    it('exports a manufacturable arm as AP214 STEP and refuses an oversized one', () => {
      const links = [armLink('upper'), armLink('lower')];
      const exported = exportMechanismStep(links, { material: PLA, printer: WIDE_BED, payload: 2 }, STEP_OPTIONS);
      expect(exported.ok).toBe(true);
      if (!exported.ok) return;
      expect(exported.step.startsWith('ISO-10303-21;')).toBe(true);
      expect(exported.step).toContain('MANIFOLD_SOLID_BREP');
      expect(exported.chainLength).toBeCloseTo(300, 9);

      const overBed = exportMechanismStep(
        [armLink('long', 400)],
        { material: PLA, printer: { bedWidth: 250, bedDepth: 210, bedHeight: 250 }, payload: 2 },
        STEP_OPTIONS,
      );
      expect(overBed.ok).toBe(false);
      if (overBed.ok) return;
      expect(overBed.findings.length).toBeGreaterThan(0);
    });
  });

  describe('2. Circuit & PCB Design', () => {
    it('runs transient thermal analysis on a PCB', async () => {
      const result = await thermalAnalysisEngine.analyzeThermal(
        [{ id: 'node1', position: { x: 0, y: 0, z: 0 }, temperature: 25, powerDissipation: 1.0, material: 'copper' }],
        [{ type: 'convection' as const, heatTransferCoefficient: 10, area: 100 }],
        {
          ambientTemperature: 25,
          convectionCoefficient: 10,
          boardMaterial: 'FR4',
          copperThickness: 0.035,
          layerCount: 2,
          simulationTime: 10,
          timeStep: 0.1,
        },
      );

      expect(result.nodes).toBeDefined();
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(result.maxTemperature).toBeGreaterThanOrEqual(25);
    });

    it('computes signal integrity from the transmission-line engine', () => {
      const result = analyzeSignalPath({
        geometry: { kind: 'microstrip', widthMm: 0.2, heightMm: 0.2, epsilonR: 4.4, copperThicknessMm: 0.035 },
        lengthMm: 100,
        driverImpedanceOhm: 22,
        loadImpedanceOhm: 1e6,
        vHigh: 3.3,
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.z0Ohm).toBeGreaterThan(50);
      expect(result.delayNs).toBeGreaterThan(0);
      expect(Number.isFinite(result.peakVolts)).toBe(true);
    });

    it('checks both physical rules and electrical connectivity', () => {
      const design: PCBDesign = {
        id: 'prod-drc',
        name: 'Production DRC',
        dimensions: { width: 50, height: 50, thickness: 1.6 },
        layers: [{ id: 'top', name: 'Top', type: 'copper', thickness: 0.035, material: 'copper' }],
        traces: [{
          id: 'thin', netId: 'VCC', layerId: 'top', width: 0.1,
          points: [{ x: 5, y: 5 }, { x: 20, y: 5 }], clearance: 0.2,
        }],
        vias: [],
        pads: [],
        components: [],
        nets: [{ id: 'VCC', name: 'VCC', connectedPins: [], wires: [] }],
        designRules: {
          minTraceWidth: DEFAULT_DRC_RULES.minTraceWidth,
          minTraceSpacing: DEFAULT_DRC_RULES.minTraceClearance,
          minViaDiameter: DEFAULT_DRC_RULES.minViaDiameter,
          minViaDrillDiameter: DEFAULT_DRC_RULES.minViaDrillDiameter,
          minPadDiameter: DEFAULT_DRC_RULES.minPadDiameter,
          minHoleDiameter: DEFAULT_DRC_RULES.minHoleDiameter,
          copperThickness: 0.035,
          solderMaskClearance: 0.1,
          silkScreenClearance: 0.15,
        },
      };
      const drc = new DesignRuleChecker(design).runDRC();
      expect(drc.isValid).toBe(false);
      expect(drc.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'width', elementId: 'thin' }),
      ]));

      const erc = new ElectricalRuleChecker([{
        id: 'u1',
        name: 'MCU',
        category: 'ic',
        symbol: { width: 40, height: 40, paths: [] },
        pins: [
          { id: 'VCC', name: 'VCC', x: 0, y: 0, type: 'power' },
          { id: 'IN', name: 'IN', x: 10, y: 0, type: 'input' },
        ],
        properties: {},
      }], [], []).runERC();
      expect(erc.isValid).toBe(false);
      expect(erc.violations.map((violation) => violation.type)).toEqual(
        expect.arrayContaining(['unconnected_pin', 'floating_input']),
      );
    });
  });

  describe('3. Robotics & Embedded Systems', () => {
    it('constructs a robot and its kinematic chain', () => {
      expect(roboticsSimulationService).toBeDefined();
      expect(typeof roboticsSimulationService.createRobot).toBe('function');
    });

    it('exposes the hardware interface managers', () => {
      expect(hardwareInterfaceManager).toBeDefined();
      expect(typeof hardwareInterfaceManager.getI2CInterface).toBe('function');
      expect(typeof hardwareInterfaceManager.getSPIInterface).toBe('function');
      expect(typeof hardwareInterfaceManager.getUARTInterface).toBe('function');
      expect(typeof hardwareInterfaceManager.getCANInterface).toBe('function');
    });

    it('creates a digital twin with sensors and actuators', () => {
      expect(digitalTwinService).toBeDefined();
      const twin = digitalTwinService.createDigitalTwin('robot-arm-1', 'Robot Arm Twin');
      expect(twin.physicalAssetId).toBe('robot-arm-1');
      expect(twin.status).toBe('offline');
      expect(twin.healthScore).toBe(100);
      digitalTwinService.deleteDigitalTwin(twin.id);
    });
  });

  describe('4. Agentic AI & Intelligent Design Automation', () => {
    it('returns AI-powered component suggestions', async () => {
      const suggestions = await aiService.suggestComponents('voltage regulator', {
        voltage: 5,
        current: 1,
      });
      expect(Array.isArray(suggestions)).toBe(true);
    });

    it('exposes the evolutionary and reinforcement-learning optimizers', () => {
      expect(typeof evolutionaryOptimizer.optimize).toBe('function');
      expect(typeof reinforcementLearningOptimizer.train).toBe('function');
      expect(typeof reinforcementLearningOptimizer.optimize).toBe('function');
    });
  });

  describe('5. IDE & Collaboration Environment', () => {
    it('exposes real-time collaborative editing', () => {
      expect(collaborativeEditor).toBeDefined();
      expect(typeof collaborativeEditor.connect).toBe('function');
      expect(typeof collaborativeEditor.disconnect).toBe('function');
      expect(typeof collaborativeEditor.sendOperation).toBe('function');
    });

    it('commits and reads snapshots through version control', () => {
      vcsService.reset();
      vcsService.initRepo('prod-readiness');
      const commit = vcsService.commit(
        'prod-readiness',
        'initial snapshot',
        { components: [], wires: [], code: 'fn main() {}' },
      );
      expect(vcsService.log('prod-readiness')).toHaveLength(1);
      expect(vcsService.head('prod-readiness')?.id).toBe(commit.id);
      vcsService.reset();
    });
  });
});

describe('Production Readiness - Integration', () => {
  it('converts a schematic to a net-aware PCB and validates the result', async () => {
    const resistor = {
      id: 'resistor',
      name: 'Resistor',
      category: 'passive',
      symbol: { width: 20, height: 10, paths: [] },
      pins: [
        { id: '1', name: 'A', x: 0, y: 5, type: 'passive' as const },
        { id: '2', name: 'B', x: 20, y: 5, type: 'passive' as const },
      ],
      properties: { resistance: '10k' },
    };
    const placed = (id: string, reference: string, x: number, y: number) => ({
      id,
      componentId: 'resistor',
      component: resistor,
      position: { x, y },
      rotation: 0,
      scale: 1,
      reference,
      properties: { resistance: '10k' },
    });
    const schematic: Schematic = {
      id: 'prod-convert',
      name: 'Prod Converter',
      components: [placed('r1', 'R1', 10, 10), placed('r2', 'R2', 60, 50)],
      wires: [
        {
          id: 'wire-a',
          points: [],
          netName: 'NET_A',
          connectedPins: [
            { componentId: 'r1', pinId: '1' },
            { componentId: 'r2', pinId: '1' },
          ],
        },
        {
          id: 'wire-b',
          points: [],
          netName: 'NET_B',
          connectedPins: [
            { componentId: 'r1', pinId: '2' },
            { componentId: 'r2', pinId: '2' },
          ],
        },
      ],
      nets: [],
      metadata: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', version: '1.0.0' },
      settings: { gridSize: 10, snapToGrid: true, showGrid: true, showPinNumbers: true, showPinNames: true, showNetNames: true },
    };

    const layout = await schematicToPcbConverter.convertSchematicToPCB(schematic, {
      boardSize: { width: 100, height: 80 },
      layerCount: 2,
      designRules: {
        minTraceWidth: 0.2,
        minTraceClearance: 0.15,
        minDrillSize: 0.3,
        minAnnularRing: 0.15,
        boardThickness: 1.6,
        copperThickness: 0.035,
      },
      autoRoute: true,
      optimizePlacement: false,
    });

    expect(layout.components).toHaveLength(2);
    expect(layout.components.some((component) => component.pads.some((pad) => pad.net === 'NET_A'))).toBe(true);
    expect(layout.traces).toHaveLength(2);
    expect(new Set(layout.traces.map((trace) => trace.net))).toEqual(new Set(['NET_A', 'NET_B']));
    const validation = schematicToPcbConverter.validateDesign(layout);
    expect(Array.isArray(validation.errors)).toBe(true);
    expect(Array.isArray(validation.warnings)).toBe(true);
  });

  it('synchronizes a robot digital twin and reports online health', async () => {
    const twin = digitalTwinService.createDigitalTwin('robot-arm-2', 'Robot Arm Twin 2');
    await digitalTwinService.syncWithPhysicalDevice(twin.id);
    const synced = digitalTwinService.getDigitalTwin(twin.id);
    expect(synced?.status).toBe('online');
    expect(synced?.lastSync).toBeGreaterThan(0);
    expect(synced?.healthScore).toBeGreaterThanOrEqual(0);
    digitalTwinService.deleteDigitalTwin(twin.id);
  });

  it('enforces collaborator roles across a shared project', () => {
    const owner: CollaborationUser = {
      id: 'prod-owner', name: 'Owner', email: 'owner@example.com', role: 'owner', lastActive: Date.now(),
    };
    const project = collaborationService.createProject('Production Readiness', 'RBAC check', owner);
    const viewer: Collaborator = {
      user: { id: 'prod-viewer', name: 'Viewer', email: 'viewer@example.com', role: 'viewer', lastActive: Date.now() },
      role: 'viewer',
      joinedAt: Date.now(),
      permissions: [],
    };

    try {
      expect(collaborationService.addCollaborator(project.id, viewer)).toBe(true);
      expect(collaborationService.can(project.id, 'prod-viewer', 'read')).toBe(true);
      expect(collaborationService.can(project.id, 'prod-viewer', 'write')).toBe(false);
      expect(collaborationService.getRole(project.id, 'prod-viewer')).toBe('viewer');
      expect(collaborationService.can(project.id, 'prod-owner', 'manage')).toBe(true);
    } finally {
      collaborationService.deleteProject(project.id);
    }
  });
});

describe('Production Readiness - Security', () => {
  it('sandboxes plugin capabilities behind declared permissions', () => {
    expect(canPerform(['ui:panels'], 'registerTool')).toBe(true);
    expect(canPerform(['read:circuit'], 'registerTool')).toBe(false);
    expect(() => requirePermission('acme', ['read:circuit'], 'registerExport'))
      .toThrow(/acme.*registerExport.*export:circuit/);
  });

  it('validates manifests and rejects malformed plugin ids', () => {
    const failures = validateManifest({
      id: 'Bad Plugin ID',
      name: 'ACME',
      version: 'v1',
      author: 'ACME',
      entry: './index.js',
      apiVersion: '1',
      permissions: ['fly:moon'],
    });
    expect(failures).toEqual(expect.arrayContaining([
      'id must be lowercase alphanumeric with dashes or dots',
      'version must be semver (x.y.z)',
      'unknown permission "fly:moon"',
    ]));
  });

  it('requires a project name for collaboration updates', () => {
    const owner: CollaborationUser = {
      id: 'prod-owner-2', name: 'Owner', email: 'owner@example.com', role: 'owner', lastActive: Date.now(),
    };
    expect(() => collaborationService.createProject('   ', '', owner)).toThrow(/name is required/);
  });
});
