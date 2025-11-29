import { describe, it, expect, beforeEach } from 'vitest';
import { AIService } from './aiService';
import type { Component } from '../../types';

describe('AIService', () => {
  let service: AIService;
  let mockComponents: Component[];

  beforeEach(() => {
    service = new AIService();
    mockComponents = [
      {
        id: 'comp1',
        name: 'Resistor',
        category: 'passive',
        symbol: { width: 20, height: 10, paths: [] },
        pins: [
          { id: '1', name: 'A', x: 0, y: 5, type: 'passive' },
          { id: '2', name: 'B', x: 20, y: 5, type: 'passive' }
        ],
        properties: { resistance: '10k' }
      },
      {
        id: 'comp2',
        name: 'LED',
        category: 'semiconductor',
        symbol: { width: 20, height: 10, paths: [] },
        pins: [
          { id: '1', name: 'Anode', x: 0, y: 5, type: 'input', electricalType: 'digital' },
          { id: '2', name: 'Cathode', x: 20, y: 5, type: 'output', electricalType: 'digital' }
        ],
        properties: { color: 'red' }
      }
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
      const components: Component[] = [
        {
          id: 'ic1',
          name: 'Microcontroller',
          category: 'ic',
          symbol: { width: 40, height: 20, paths: [] },
          pins: [
            { id: '1', name: 'VCC', x: 0, y: 5, type: 'input', electricalType: 'power' },
            { id: '2', name: 'GND', x: 0, y: 15, type: 'input', electricalType: 'ground' }
          ],
          properties: {}
        }
      ];

      const analysis = await service.analyzeCircuit(components, [], []);

      expect(analysis.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Predictive Maintenance', () => {
    it('should predict maintenance for component', async () => {
      const prediction = await service.predictMaintenance('comp1');
      
      expect(prediction).toBeDefined();
      expect(prediction).toHaveProperty('componentId');
      expect(prediction).toHaveProperty('failureProbability');
      expect(prediction).toHaveProperty('timeToFailure');
      expect(prediction.failureProbability).toBeGreaterThanOrEqual(0);
      expect(prediction.failureProbability).toBeLessThanOrEqual(1);
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










