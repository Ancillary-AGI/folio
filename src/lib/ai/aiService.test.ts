import { describe, it, expect, beforeEach } from 'vitest';
import { AIService } from './aiService';
import type { Component } from '../../types';

const makeComponent = (
  id: string,
  name: string,
  category: string,
  pins: Component['pins'],
  properties: Component['properties'],
): Component => ({
  id,
  name,
  category,
  symbol: { width: 20, height: 10, paths: [] },
  pins,
  properties,
  availability: 'available',
});

describe('AIService', () => {
  let service: AIService;
  let mockComponents: Component[];

  beforeEach(() => {
    service = new AIService();
    mockComponents = [
      makeComponent('comp1', 'Resistor', 'passive', [
        { id: '1', name: 'A', x: 0, y: 5, type: 'passive' },
        { id: '2', name: 'B', x: 20, y: 5, type: 'passive' },
      ], { resistance: '10k' }),
      makeComponent('comp2', 'LED', 'semiconductor', [
        { id: '1', name: 'Anode', x: 0, y: 5, type: 'input' },
        { id: '2', name: 'Cathode', x: 20, y: 5, type: 'output' },
      ], { color: 'red' }),
    ];
  });

  describe('Component Recommendations', () => {
    it('should recommend components based on query', async () => {
      const recommendations = await service.recommendComponents('resistor 10k');
      
      expect(recommendations).toBeDefined();
      expect(Array.isArray(recommendations)).toBe(true);
      if (recommendations.length > 0) {
        expect(recommendations[0]).toHaveProperty('component');
        expect(recommendations[0]).toHaveProperty('confidence');
      }
    });

    it('should return empty array for invalid query', async () => {
      const recommendations = await service.recommendComponents('');
      expect(Array.isArray(recommendations)).toBe(true);
    });
  });

  describe('Design Optimization', () => {
    it('should optimize design based on objectives', async () => {
      const request = {
        components: mockComponents,
        constraints: { maxPower: 5.0 },
        objectives: ['power', 'cost'],
        currentDesign: { powerConsumption: 2.0, cost: 10.0 }
      };

      const result = await service.optimizeDesign(request);
      
      expect(result).toBeDefined();
      expect(result).toHaveProperty('optimizedDesign');
      expect(result).toHaveProperty('improvements');
      expect(result).toHaveProperty('confidence');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should handle empty components array', async () => {
      const request = {
        components: [],
        constraints: {},
        objectives: ['power']
      };

      const result = await service.optimizeDesign(request);
      expect(result).toBeDefined();
      expect(result.optimizedDesign).toBeDefined();
    });

    it('bases the thermal estimate on declared dissipation', async () => {
      const hot = makeComponent('r1', 'Power resistor', 'passive', [], { power: 10 });
      const result = await service.optimizeDesign({
        components: [hot], constraints: {}, objectives: [],
        currentDesign: { powerConsumption: 10 },
      });
      expect(result.optimizedDesign.thermalOptimized).toBe(true);
      expect(result.reasoning).toContain('thermal');
    });

    it('does not report improvements without a baseline design', async () => {
      const result = await service.optimizeDesign({
        components: mockComponents, constraints: {}, objectives: ['power', 'cost'],
      });
      expect(result.improvements).toEqual([]);
      expect(result.reasoning).not.toContain('Improvements');
    });
  });

  describe('Circuit Analysis', () => {
    it('should analyze circuit and return issues', async () => {
      const analysis = await service.analyzeCircuit(mockComponents, [], []);

      expect(analysis).toBeDefined();
      expect(analysis).toHaveProperty('issues');
      expect(analysis).toHaveProperty('recommendations');
      expect(Array.isArray(analysis.issues)).toBe(true);
      expect(Array.isArray(analysis.recommendations)).toBe(true);
    });

    it('should detect floating inputs', async () => {
      const components: Component[] = [makeComponent('ic1', 'Microcontroller', 'ic', [
        { id: '1', name: 'VCC', x: 0, y: 5, type: 'input', electricalType: 'power' },
        { id: '2', name: 'GND', x: 0, y: 15, type: 'input', electricalType: 'ground' },
      ], {})];

      const analysis = await service.analyzeCircuit(components, [], []);

      expect(analysis.issues.length).toBeGreaterThan(0);
    });

    it('does not print Infinity for an empty canvas', async () => {
      const analysis = await service.analyzeCircuit([], [], []);
      expect(analysis.analysis).not.toMatch(/Infinity|NaN/);
    });

    it('estimates power as I·V, not by adding amperes to watts', async () => {      const components: Component[] = [
        makeComponent('load', 'Load', 'passive', [], { current: 0.5, voltage: 5 }),
      ];
      const analysis = await service.analyzeCircuit(components, [], []);
      expect(analysis.analysis).toContain('Estimated Power Consumption: 2.5W');
    });

    it('flags a net tying a power pin to a ground pin', async () => {
      const components: Component[] = [makeComponent('ic1', 'Regulator', 'ic', [
        { id: 'vin', name: 'VIN', x: 0, y: 0, type: 'power' },
        { id: 'gnd', name: 'GND', x: 0, y: 10, type: 'ground' },
      ], {})];
      const nets = [{
        id: 'net-short', name: 'VCC', wires: [],
        connectedPins: [
          { componentId: 'ic1', pinId: 'vin' },
          { componentId: 'ic1', pinId: 'gnd' },
        ],
      }];
      const analysis = await service.analyzeCircuit(components, [], nets);
      expect(analysis.issues.some(issue => issue.severity === 'error' && issue.message.includes('short circuit'))).toBe(true);
    });

    it('does not flag a multi-pin ground net as a short', async () => {
      const components: Component[] = [
        makeComponent('ic1', 'MCU', 'ic', [
          { id: 'gnd', name: 'GND', x: 0, y: 0, type: 'ground' },
        ], {}),
        makeComponent('c1', 'Capacitor', 'passive', [
          { id: 'gnd', name: 'GND', x: 0, y: 0, type: 'ground' },
        ], {}),
        makeComponent('c2', 'Capacitor', 'passive', [
          { id: 'gnd', name: 'GND', x: 0, y: 0, type: 'ground' },
        ], {}),
      ];
      const nets = [{
        id: 'net-gnd', name: 'GND', wires: [],
        connectedPins: [
          { componentId: 'ic1', pinId: 'gnd' },
          { componentId: 'c1', pinId: 'gnd' },
          { componentId: 'c2', pinId: 'gnd' },
        ],
      }];
      const analysis = await service.analyzeCircuit(components, [], nets);
      expect(analysis.issues.some(issue => issue.message.includes('short circuit'))).toBe(false);
    });
  });

  describe('Predictive Maintenance', () => {
    it('predicts from the generic baseline and lists what it could not evaluate', async () => {
      const predictions = await service.predictMaintenance(mockComponents);

      expect(predictions).toHaveLength(2);
      const prediction = predictions[0];
      // Nothing here declares temperature, voltage or current, so no stress
      // multiplier may be applied and every axis shows up as a gap.
      expect(prediction.confidence).toBe(0.2);
      expect(prediction.inputsMissing).toHaveLength(3);
      expect(prediction.timeToFailure).toBe(100000);
      expect(prediction.basis).toContain('generic');
      expect(prediction.basis).toContain('8,760');
      expect(prediction.failureProbability).toBeCloseTo(1 - Math.exp(-8760 / 100000), 6);
    });

    it('applies stress only where both the applied value and the rating exist', async () => {
      const capacitor = makeComponent('comp3', 'Cap', 'capacitor', [
        { id: '1', name: 'A', x: 0, y: 5, type: 'passive' },
        { id: '2', name: 'B', x: 20, y: 5, type: 'passive' },
      ], { voltage: '25V', current: '1A' });

      const [prediction] = await service.predictMaintenance([capacitor], {
        temperature: 80,
        voltage: 24,
        current: 0.9,
      });

      // x2.0 thermal, voltage inside 110% of rating, x1.6 for 0.9 A on a 1 A part.
      expect(prediction.timeToFailure).toBeCloseTo(100000 / 3.2, 6);
      expect(prediction.confidence).toBe(0.8);
      expect(prediction.inputsMissing).toEqual([]);
      expect(prediction.basis).toContain('x3.20');
    });

    it('names a missing rating instead of assuming one', async () => {
      const [prediction] = await service.predictMaintenance([mockComponents[1]], { voltage: 12 });

      expect(prediction.inputsMissing.join(' ')).toMatch(/declares no voltage rating/);
      expect(prediction.confidence).toBe(0.2);
    });

    it('uses a declared mission window for the probability', async () => {
      const [prediction] = await service.predictMaintenance([mockComponents[0]], { missionHours: 87600 });

      expect(prediction.basis).toContain('87,600 h mission');
      expect(prediction.failureProbability).toBeCloseTo(1 - Math.exp(-87600 / 100000), 6);
    });
  });

  describe('Smart Suggestions', () => {
    it('should generate smart suggestions', async () => {
      const suggestions = await service.getSmartSuggestions({
        components: mockComponents,
        wires: []
      });

      expect(Array.isArray(suggestions)).toBe(true);
      if (suggestions.length > 0) {
        expect(suggestions[0]).toHaveProperty('type');
        expect(suggestions[0]).toHaveProperty('confidence');
        expect(suggestions[0]).toHaveProperty('suggestion');
      }
    });
  });
});










