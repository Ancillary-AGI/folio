import { describe, it, expect } from 'vitest';
import { schematicToPcbConverter } from './schematicToPcbConverter';

describe('SchematicToPcbConverter', () => {
  describe('convertSchematicToPCB', () => {
    it('should convert a basic schematic to PCB layout', async () => {
      const mockCircuit = {
        id: 'circuit-1',
        name: 'Test Circuit',
        components: [
          {
            id: 'comp-1',
            name: 'Resistor',
            category: 'passive',
            type: 'resistor',
            symbol: {
              width: 20,
              height: 10,
              paths: [],
              pins: [
                { id: '1', name: 'A', x: 0, y: 5, type: 'passive' as const },
                { id: '2', name: 'B', x: 20, y: 5, type: 'passive' as const }
              ]
            },
            pins: [
              { id: '1', name: 'A', x: 0, y: 5, type: 'passive' as const },
              { id: '2', name: 'B', x: 20, y: 5, type: 'passive' as const }
            ],
            properties: { resistance: '10k' },
          }
        ],
        wires: [
          {
            id: 'wire-1',
            points: [
              { x: 20, y: 5 },
              { x: 40, y: 5 }
            ],
            net: 'GND'
          }
        ]
      };

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
      expect(layout.layers).toHaveLength(4); // 2 signal + power + ground + silk + solder mask
      expect(layout.components).toHaveLength(1);
      expect(layout.traces).toHaveLength(1);
    });

    it('should create correct layer structure', async () => {
      const mockCircuit = {
        id: 'circuit-2',
        name: 'Layer Test',
        components: [],
        wires: []
      };

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
      expect(layout.layers[0].name).toBe('Signal Layer 1');
      expect(layout.layers[1].type).toBe('power');
      expect(layout.layers[2].type).toBe('ground');
    });
  });

  describe('validateDesign', () => {
    it('should validate a correct design', async () => {
      const mockCircuit = {
        id: 'circuit-3',
        name: 'Valid Circuit',
        components: [],
        wires: []
      };

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
      const mockCircuit = {
        id: 'circuit-4',
        name: 'Invalid Circuit',
        components: [],
        wires: []
      };

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
      expect(validation.errors).toContain('Trace invalid-trace width 0.1mm below minimum 0.5mm');
    });
  });

  describe('exportToGerber', () => {
    it('should generate Gerber format output', async () => {
      const mockCircuit = {
        id: 'circuit-5',
        name: 'Gerber Test',
        components: [],
        wires: []
      };

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
    });
  });

  describe('getPCBLayout', () => {
    it('should retrieve stored PCB layout', async () => {
      const mockCircuit = {
        id: 'circuit-6',
        name: 'Retrieval Test',
        components: [],
        wires: []
      };

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