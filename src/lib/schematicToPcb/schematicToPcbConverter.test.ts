import { describe, it, expect } from 'vitest';
import { schematicToPcbConverter } from './schematicToPcbConverter';
import type { Schematic } from '../../types';

const makeSchematic = (
  id: string,
  name: string,
  components: Schematic['components'] = [],
  wires: Schematic['wires'] = [],
): Schematic => ({
  id,
  name,
  components,
  wires,
  nets: [],
  metadata: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z', version: '1.0.0' },
  settings: { gridSize: 10, snapToGrid: true, showGrid: true, showPinNumbers: true, showPinNames: true, showNetNames: true },
});

describe('SchematicToPcbConverter', () => {
  describe('convertSchematicToPCB', () => {
    it('should convert a basic schematic to PCB layout', async () => {
      const pins = [
        { id: '1', name: 'A', x: 0, y: 5, type: 'passive' as const },
        { id: '2', name: 'B', x: 20, y: 5, type: 'passive' as const },
      ];
      const mockCircuit = makeSchematic('circuit-1', 'Test Circuit', [{
        id: 'comp-1',
        componentId: 'resistor',
        component: {
          id: 'resistor',
          name: 'Resistor',
          category: 'passive',
          symbol: { width: 20, height: 10, paths: [] },
          pins,
          properties: { resistance: '10k' },
        },
        position: { x: 10, y: 10 },
        rotation: 0,
        scale: 1,
        reference: 'R1',
        properties: { resistance: '10k' },
      }], [{
        id: 'wire-1',
        points: [{ x: 20, y: 5 }, { x: 40, y: 5 }],
        netName: 'GND',
        connectedPins: [{ componentId: 'comp-1', pinId: '2' }],
      }]);

      const options = {
        boardSize: { width: 100, height: 80 },
        layerCount: 2,
        designRules: {
          minTraceWidth: 0.2,
          minTraceClearance: 0.15,
          minDrillSize: 0.3,
          minAnnularRing: 0.15,
          boardThickness: 1.6,
          copperThickness: 0.035
        },
        autoRoute: false,
        optimizePlacement: false
      };

      const layout = await schematicToPcbConverter.convertSchematicToPCB(mockCircuit, options);

      expect(layout).toBeDefined();
      expect(layout.id).toContain('circuit-1');
      expect(layout.name).toBe('Test Circuit PCB');
      expect(layout.width).toBe(100);
      expect(layout.height).toBe(80);
      expect(layout.layers).toHaveLength(6); // 2 copper + top/bottom solder mask and silkscreen
      expect(layout.components).toHaveLength(1);
      expect(layout.traces).toHaveLength(1);
    });

    it('should create correct layer structure', async () => {
      const mockCircuit = makeSchematic('circuit-2', 'Layer Test');

      const options = {
        boardSize: { width: 50, height: 50 },
        layerCount: 4,
        designRules: {
          minTraceWidth: 0.2,
          minTraceClearance: 0.15,
          minDrillSize: 0.3,
          minAnnularRing: 0.15,
          boardThickness: 1.6,
          copperThickness: 0.035
        },
        autoRoute: false,
        optimizePlacement: false
      };

      const layout = await schematicToPcbConverter.convertSchematicToPCB(mockCircuit, options);

      expect(layout.layers).toHaveLength(8); // 4 signal + power + ground + silk + solder mask x2
      expect(layout.layers[0].type).toBe('signal');
      expect(layout.layers[0].name).toBe('Top Signal Layer');
      expect(layout.layers[1].type).toBe('power');
      expect(layout.layers[2].type).toBe('ground');
    });
  });

  describe('validateDesign', () => {
    it('should validate a correct design', async () => {
      const mockCircuit = makeSchematic('circuit-3', 'Valid Circuit');

      const options = {
        boardSize: { width: 50, height: 50 },
        layerCount: 2,
        designRules: {
          minTraceWidth: 0.2,
          minTraceClearance: 0.15,
          minDrillSize: 0.3,
          minAnnularRing: 0.15,
          boardThickness: 1.6,
          copperThickness: 0.035
        },
        autoRoute: false,
        optimizePlacement: false
      };

      const layout = await schematicToPcbConverter.convertSchematicToPCB(mockCircuit, options);
      const validation = schematicToPcbConverter.validateDesign(layout);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect trace width violations', async () => {
      const mockCircuit = makeSchematic('circuit-4', 'Invalid Circuit');

      const options = {
        boardSize: { width: 50, height: 50 },
        layerCount: 2,
        designRules: {
          minTraceWidth: 0.5,
          minTraceClearance: 0.15,
          minDrillSize: 0.3,
          minAnnularRing: 0.15,
          boardThickness: 1.6,
          copperThickness: 0.035
        },
        autoRoute: false,
        optimizePlacement: false
      };

      const layout = await schematicToPcbConverter.convertSchematicToPCB(mockCircuit, options);

      // Manually add a trace with invalid width
      layout.traces.push({
        id: 'invalid-trace',
        net: 'test',
        layer: 'signal-1',
        width: 0.1, // Below minimum
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 10 }
        ],
        clearance: 0.2
      });

      const validation = schematicToPcbConverter.validateDesign(layout);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Trace "invalid-trace" width 0.1mm is below minimum 0.5mm');
    });

    it('warns about pads that the schematic never connected', async () => {
      const mockCircuit = makeSchematic('circuit-nets', 'Nets');

      const layout = await schematicToPcbConverter.convertSchematicToPCB(mockCircuit, {
        boardSize: { width: 50, height: 50 },
        layerCount: 2,
        designRules: {
          minTraceWidth: 0.2,
          minTraceClearance: 0.15,
          minDrillSize: 0.3,
          minAnnularRing: 0.15,
          boardThickness: 1.6,
          copperThickness: 0.035
        },
        autoRoute: false,
        optimizePlacement: false
      });

      layout.components.push({
        id: 'pcb-r1',
        componentId: 'r1',
        footprint: 'RES-0805',
        position: { x: 10, y: 10, z: 0 },
        rotation: 0,
        side: 'top',
        pads: [{ id: '1', shape: 'circle', position: { x: 0, y: 0 }, size: { width: 0.8, height: 0.8 } }]
      });

      const validation = schematicToPcbConverter.validateDesign(layout);
      expect(validation.warnings).toContain('Pad 1 of component pcb-r1 is not connected to any net');
    });
  });

  describe('net-aware routing', () => {
    const resistor = {
      id: 'resistor',
      name: 'Resistor',
      category: 'passive',
      symbol: { width: 20, height: 10, paths: [] },
      pins: [
        { id: '1', name: 'A', x: 0, y: 0, type: 'passive' as const },
        { id: '2', name: 'B', x: 20, y: 0, type: 'passive' as const },
      ],
      properties: {},
    };

    const placed = (id: string, reference: string, x: number, y: number) => ({
      id,
      componentId: 'resistor',
      component: resistor,
      position: { x, y },
      rotation: 0,
      scale: 1,
      reference,
      properties: {},
    });

    const options = {
      boardSize: { width: 100, height: 80 },
      layerCount: 2,
      designRules: {
        minTraceWidth: 0.2,
        minTraceClearance: 0.2,
        minDrillSize: 0.3,
        minAnnularRing: 0.15,
        boardThickness: 1.6,
        copperThickness: 0.035
      },
      autoRoute: true,
      optimizePlacement: false
    };

    it('assigns wire nets to generated pads', async () => {
      const circuit = makeSchematic('circuit-padnets', 'Pad nets', [placed('r1', 'R1', 10, 10)], [{
        id: 'w1',
        points: [{ x: 10, y: 10 }, { x: 20, y: 10 }],
        netName: 'GND',
        connectedPins: [{ componentId: 'r1', pinId: '2' }],
      }]);

      const layout = await schematicToPcbConverter.convertSchematicToPCB(circuit, options);
      const pads = layout.components[0].pads;

      expect(pads.find(pad => pad.id === '2')?.net).toBe('GND');
      expect(pads.find(pad => pad.id === '1')?.net).toBeUndefined();
    });

    it('keys pads by real pin ids such as p1/p2, not by pad index', async () => {
      const libraryResistor = {
        ...resistor,
        pins: [
          { id: 'p1', name: '1', x: 0, y: 0, type: 'passive' as const },
          { id: 'p2', name: '2', x: 20, y: 0, type: 'passive' as const },
        ],
      };
      const circuit = makeSchematic('circuit-pin-ids', 'Pin ids', [{
        id: 'r1',
        componentId: 'resistor',
        component: libraryResistor,
        position: { x: 10, y: 10 },
        rotation: 0,
        scale: 1,
        reference: 'R1',
        properties: {},
      }], [{
        id: 'w1',
        points: [],
        netName: 'GND',
        connectedPins: [{ componentId: 'r1', pinId: 'p2' }],
      }]);

      const layout = await schematicToPcbConverter.convertSchematicToPCB(circuit, options);
      const pads = layout.components[0].pads;

      expect(pads.map(pad => pad.id)).toEqual(['p1', 'p2']);
      expect(pads.find(pad => pad.id === 'p2')?.net).toBe('GND');
      expect(pads.find(pad => pad.id === 'p1')?.net).toBeUndefined();
    });

    it('emits one pad per pin for multi-pin parts', async () => {
      const icPins = Array.from({ length: 8 }, (_, index) => ({
        id: `p${index + 1}`,
        name: `${index + 1}`,
        x: 0,
        y: index * 10,
        type: 'passive' as const,
      }));
      const ic = {
        id: 'opamp',
        name: 'Op-Amp',
        category: 'ic',
        symbol: { width: 40, height: 80, paths: [] },
        pins: icPins,
        properties: {},
      };
      const circuit = makeSchematic('circuit-ic', 'IC', [{
        id: 'u1',
        componentId: 'opamp',
        component: ic,
        position: { x: 20, y: 20 },
        rotation: 0,
        scale: 1,
        reference: 'U1',
        properties: {},
      }]);

      const layout = await schematicToPcbConverter.convertSchematicToPCB(circuit, options);
      const component = layout.components[0];

      expect(component.footprint).toBe('soic_8');
      expect(component.pads.map(pad => pad.id)).toEqual(icPins.map(pin => pin.id));
    });

    it('never drops pins when no library footprint covers the pin count', async () => {
      const pins = Array.from({ length: 14 }, (_, index) => ({
        id: `p${index + 1}`,
        name: `${index + 1}`,
        x: 0,
        y: index * 10,
        type: 'passive' as const,
      }));
      const circuit = makeSchematic('circuit-dip14', 'DIP14', [{
        id: 'u2',
        componentId: 'logic',
        component: {
          id: 'logic',
          name: 'Quad gate',
          category: 'ic',
          symbol: { width: 40, height: 140, paths: [] },
          pins,
          properties: {},
        },
        position: { x: 20, y: 20 },
        rotation: 0,
        scale: 1,
        reference: 'U2',
        properties: {},
      }]);

      const layout = await schematicToPcbConverter.convertSchematicToPCB(circuit, options);

      expect(layout.components[0].footprint).toBe('GENERIC');
      expect(layout.components[0].pads).toHaveLength(14);
      expect(layout.components[0].pads.map(pad => pad.id)).toEqual(pins.map(pin => pin.id));
    });

    it('reduces wirelength during placement without leaving the board', async () => {
      const circuit = makeSchematic(
        'circuit-place',
        'Placement',
        [placed('r1', 'R1', 10, 10), placed('r2', 'R2', 50, 10), placed('r3', 'R3', 10, 50)],
        [
          { id: 'w1', points: [], netName: 'NET_A', connectedPins: [
            { componentId: 'r1', pinId: '1' },
            { componentId: 'r3', pinId: '1' },
          ] },
          { id: 'w2', points: [], netName: 'NET_B', connectedPins: [
            { componentId: 'r1', pinId: '2' },
            { componentId: 'r3', pinId: '2' },
          ] },
          { id: 'w3', points: [], netName: 'NET_C', connectedPins: [
            { componentId: 'r2', pinId: '1' },
            { componentId: 'r3', pinId: '1' },
          ] },
        ],
      );

      type Layout = Awaited<ReturnType<typeof schematicToPcbConverter.convertSchematicToPCB>>;
      const wirelength = (layout: Layout) => {
        const boxes = new Map<string, { minX: number; minY: number; maxX: number; maxY: number }>();
        for (const component of layout.components) {
          for (const pad of component.pads) {
            if (!pad.net) continue;
            const x = component.position.x + pad.position.x;
            const y = component.position.y + pad.position.y;
            const box = boxes.get(pad.net);
            if (box) {
              box.minX = Math.min(box.minX, x);
              box.minY = Math.min(box.minY, y);
              box.maxX = Math.max(box.maxX, x);
              box.maxY = Math.max(box.maxY, y);
            } else {
              boxes.set(pad.net, { minX: x, minY: y, maxX: x, maxY: y });
            }
          }
        }
        return [...boxes.values()].reduce(
          (sum, box) => sum + (box.maxX - box.minX) + (box.maxY - box.minY), 0,
        );
      };

      const baseline = await schematicToPcbConverter.convertSchematicToPCB(circuit, {
        ...options, autoRoute: false, optimizePlacement: false,
      });
      const optimized = await schematicToPcbConverter.convertSchematicToPCB(circuit, {
        ...options, autoRoute: false, optimizePlacement: true,
      });

      expect(wirelength(optimized)).toBeLessThanOrEqual(wirelength(baseline) + 1e-9);
      for (const component of optimized.components) {
        expect(component.position.x).toBeGreaterThanOrEqual(0);
        expect(component.position.x).toBeLessThanOrEqual(100);
        expect(component.position.y).toBeGreaterThanOrEqual(0);
        expect(component.position.y).toBeLessThanOrEqual(80);
        expect(component.rotation).toBe(0);
      }
    });

    it('routes every connected net through the shared autorouter', async () => {
      const circuit = makeSchematic(
        'circuit-route',
        'Route',
        [placed('r1', 'R1', 10, 10), placed('r2', 'R2', 60, 50)],
        [
          { id: 'w1', points: [], netName: 'NET_A', connectedPins: [
            { componentId: 'r1', pinId: '1' },
            { componentId: 'r2', pinId: '1' },
          ] },
          { id: 'w2', points: [], netName: 'NET_B', connectedPins: [
            { componentId: 'r1', pinId: '2' },
            { componentId: 'r2', pinId: '2' },
          ] },
        ],
      );

      const layout = await schematicToPcbConverter.convertSchematicToPCB(circuit, options);

      expect(layout.traces).toHaveLength(2);
      expect(new Set(layout.traces.map(trace => trace.net))).toEqual(new Set(['NET_A', 'NET_B']));
      const copperIds = new Set(layout.layers.map(layer => layer.id));
      for (const trace of layout.traces) {
        expect(copperIds.has(trace.layer)).toBe(true);
        expect(trace.points.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('exportToGerber', () => {
    it('should generate Gerber format output', async () => {
      const mockCircuit = makeSchematic('circuit-5', 'Gerber Test');

      const options = {
        boardSize: { width: 50, height: 50 },
        layerCount: 2,
        designRules: {
          minTraceWidth: 0.2,
          minTraceClearance: 0.15,
          minDrillSize: 0.3,
          minAnnularRing: 0.15,
          boardThickness: 1.6,
          copperThickness: 0.035
        },
        autoRoute: false,
        optimizePlacement: false
      };

      const layout = await schematicToPcbConverter.convertSchematicToPCB(mockCircuit, options);
      const gerber = schematicToPcbConverter.exportToGerber(layout);

      expect(gerber).toContain('%FSLAX46Y46*%');
      expect(gerber).toContain('%MOMM*%');
      expect(gerber).toContain('%LPD*%');
      expect(gerber).toContain('M02*');
      // An empty board defines no apertures, so nothing references an undefined one.
      expect(gerber).not.toContain('%ADD');

      const routed = await schematicToPcbConverter.convertSchematicToPCB(
        makeSchematic('circuit-gerber-cu', 'Gerber copper', [{
          id: 'comp-1',
          componentId: 'resistor',
          component: {
            id: 'resistor',
            name: 'Resistor',
            category: 'passive',
            symbol: { width: 20, height: 10, paths: [] },
            pins: [
              { id: 'p1', name: '1', x: 0, y: 0, type: 'passive' as const },
              { id: 'p2', name: '2', x: 20, y: 0, type: 'passive' as const },
            ],
            properties: {},
          },
          position: { x: 10, y: 10 },
          rotation: 0,
          scale: 1,
          reference: 'R1',
          properties: {},
        }], []),
        { ...options, autoRoute: false },
      );
      const copper = schematicToPcbConverter.exportToGerber(routed);
      expect(copper).toMatch(/%ADD\d+[RC],[\d.]+X[\d.]+\*%/);
      const aperture = copper.match(/D(\d+)\*/)![1];
      expect(copper).toContain(`%ADD${aperture}`);
      expect(copper).toContain('D03*');
    });
  });

  describe('getPCBLayout', () => {
    it('should retrieve stored PCB layout', async () => {
      const mockCircuit = makeSchematic('circuit-6', 'Retrieval Test');

      const options = {
        boardSize: { width: 30, height: 30 },
        layerCount: 2,
        designRules: {
          minTraceWidth: 0.2,
          minTraceClearance: 0.15,
          minDrillSize: 0.3,
          minAnnularRing: 0.15,
          boardThickness: 1.6,
          copperThickness: 0.035
        },
        autoRoute: false,
        optimizePlacement: false
      };

      const layout = await schematicToPcbConverter.convertSchematicToPCB(mockCircuit, options);
      const retrieved = schematicToPcbConverter.getPCBLayout(layout.id);

      expect(retrieved).toEqual(layout);
    });

    it('should return undefined for non-existent layout', () => {
      const retrieved = schematicToPcbConverter.getPCBLayout('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });
});