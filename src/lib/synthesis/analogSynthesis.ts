import { Component } from '../../types';

export interface AnalogSpecification {
  type: 'opamp' | 'comparator' | 'adc' | 'dac' | 'filter' | 'oscillator' | 'regulator';
  performance: {
    gain?: number; // dB
    bandwidth?: number; // Hz
    slewRate?: number; // V/μs
    inputOffset?: number; // mV
    cmrr?: number; // dB
    psrr?: number; // dB
    noise?: number; // nV/√Hz
    distortion?: number; // %
    power?: number; // mW
  };
  constraints: {
    supplyVoltage: { min: number; max: number };
    temperature: { min: number; max: number };
    area?: number; // mm²
    cost?: number;
  };
}

export interface SynthesizedCircuit {
  id: string;
  name: string;
  specification: AnalogSpecification;
  topology: string; // e.g., 'two_stage_opamp', 'folded_cascode', etc.
  components: Component[];
  sizing: Record<string, number>; // Component sizing (W/L ratios, etc.)
  performance: Record<string, number>; // Achieved performance metrics
  layout?: {
    area: number;
    aspectRatio: number;
    pins: Array<{ name: string; position: { x: number; y: number } }>;
  };
}

export class AnalogSynthesizer {
  private topologies = new Map<string, any>();

  constructor() {
    this.initializeTopologies();
  }

  private initializeTopologies() {
    // Operational Amplifier Topologies
    this.topologies.set('two_stage_opamp', {
      name: 'Two-Stage Op-Amp',
      stages: 2,
      compensation: 'miller',
      components: ['M1', 'M2', 'M3', 'M4', 'M5', 'Cc'],
      sizing: {
        M1: { w: 100e-6, l: 1e-6 }, // Input differential pair
        M2: { w: 100e-6, l: 1e-6 },
        M3: { w: 200e-6, l: 1e-6 }, // Current source
        M4: { w: 50e-6, l: 1e-6 },  // Second stage
        M5: { w: 500e-6, l: 1e-6 }, // Output stage
        Cc: 5e-12 // Compensation capacitor
      }
    });

    this.topologies.set('folded_cascode_opamp', {
      name: 'Folded Cascode Op-Amp',
      stages: 2,
      compensation: 'miller',
      components: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'Cc'],
      sizing: {
        M1: { w: 50e-6, l: 1e-6 },  // Input pair
        M2: { w: 50e-6, l: 1e-6 },
        M3: { w: 100e-6, l: 1e-6 }, // Cascode
        M4: { w: 100e-6, l: 1e-6 },
        M5: { w: 100e-6, l: 1e-6 }, // Folded current
        M6: { w: 100e-6, l: 1e-6 },
        M7: { w: 50e-6, l: 1e-6 },  // Second stage
        M8: { w: 300e-6, l: 1e-6 }, // Output
        Cc: 2e-12
      }
    });

    // Comparator Topologies
    this.topologies.set('latched_comparator', {
      name: 'Latched Comparator',
      components: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'],
      sizing: {
        M1: { w: 20e-6, l: 0.5e-6 },  // Input pair
        M2: { w: 20e-6, l: 0.5e-6 },
        M3: { w: 10e-6, l: 0.5e-6 },  // Latch
        M4: { w: 10e-6, l: 0.5e-6 },
        M5: { w: 50e-6, l: 0.5e-6 },  // Current source
        M6: { w: 50e-6, l: 0.5e-6 }
      }
    });

    // Bandgap Reference
    this.topologies.set('bandgap_reference', {
      name: 'Bandgap Reference',
      components: ['Q1', 'Q2', 'R1', 'R2', 'M1', 'M2'],
      sizing: {
        Q1: { area: 10e-12 }, // BJT area
        Q2: { area: 10e-12 },
        R1: 10e3, // 10kΩ
        R2: 10e3,
        M1: { w: 50e-6, l: 2e-6 },
        M2: { w: 50e-6, l: 2e-6 }
      }
    });
  }

  synthesizeOpAmp(spec: AnalogSpecification): SynthesizedCircuit {
    if (spec.type !== 'opamp') {
      throw new Error('Specification must be for op-amp');
    }

    // Choose topology based on specifications
    let topology = 'two_stage_opamp';
    if (spec.performance?.bandwidth && spec.performance.bandwidth > 100e6) {
      topology = 'folded_cascode_opamp';
    }

    const topologyData = this.topologies.get(topology);
    const sizing = this.optimizeSizing(topologyData.sizing, spec);

    return {
      id: `opamp_${Date.now()}`,
      name: `Synthesized ${topologyData.name}`,
      specification: spec,
      topology,
      components: this.generateComponents(topologyData.components, sizing),
      sizing,
      performance: this.estimatePerformance(topology, sizing, spec.constraints.supplyVoltage.max)
    };
  }

  synthesizeComparator(spec: AnalogSpecification): SynthesizedCircuit {
    if (spec.type !== 'comparator') {
      throw new Error('Specification must be for comparator');
    }

    const topology = 'latched_comparator';
    const topologyData = this.topologies.get(topology);
    const sizing = this.optimizeComparatorSizing(topologyData.sizing, spec);

    return {
      id: `comparator_${Date.now()}`,
      name: `Synthesized ${topologyData.name}`,
      specification: spec,
      topology,
      components: this.generateComponents(topologyData.components, sizing),
      sizing,
      performance: this.estimateComparatorPerformance(sizing, spec.constraints.supplyVoltage.max)
    };
  }

  synthesizeBandgapReference(spec: AnalogSpecification): SynthesizedCircuit {
    if (spec.type !== 'regulator') {
      throw new Error('Specification must be for regulator');
    }

    const topology = 'bandgap_reference';
    const topologyData = this.topologies.get(topology);
    const sizing = topologyData.sizing; // Bandgap sizing is relatively fixed

    return {
      id: `bandgap_${Date.now()}`,
      name: `Synthesized ${topologyData.name}`,
      specification: spec,
      topology,
      components: this.generateBandgapComponents(topologyData.components, sizing),
      sizing,
      performance: this.estimateBandgapPerformance(sizing)
    };
  }

  private optimizeSizing(baseSizing: any, spec: AnalogSpecification): Record<string, number> {
    const optimized = { ...baseSizing };

    // Gain optimization
    if (spec.performance?.gain) {
      const targetGain = Math.pow(10, spec.performance.gain / 20); // Convert dB to linear
      // Adjust output stage size for gain
      if (optimized.M5) {
        optimized.M5.w *= Math.sqrt(targetGain / 1000); // Rough approximation
      }
    }

    // Bandwidth optimization
    if (spec.performance?.bandwidth) {
      // Reduce compensation capacitor for higher bandwidth
      if (optimized.Cc) {
        optimized.Cc *= 1000 / spec.performance.bandwidth; // Rough approximation
      }
    }

    // Slew rate optimization
    if (spec.performance?.slewRate) {
      // Increase compensation capacitor for better slew rate
      if (optimized.Cc) {
        optimized.Cc *= spec.performance.slewRate / 10; // Rough approximation
      }
    }

    return optimized;
  }

  private optimizeComparatorSizing(baseSizing: any, spec: AnalogSpecification): Record<string, number> {
    const optimized = { ...baseSizing };

    // Speed optimization (reduce device sizes for higher speed)
    if (spec.performance?.bandwidth && spec.performance.bandwidth > 100e6) {
      Object.keys(optimized).forEach(key => {
        if (optimized[key].w) {
          optimized[key].w *= 0.5; // Reduce width for speed
        }
      });
    }

    return optimized;
  }

  private generateComponents(componentIds: string[], sizing: Record<string, any>): Component[] {
    return componentIds.map(id => {
      const size = sizing[id];
      let category = 'mosfet';
      let name = 'NMOS';

      if (id.startsWith('M')) {
        category = 'mosfet';
        name = parseInt(id.substring(1)) % 2 === 0 ? 'NMOS' : 'PMOS';
      } else if (id.startsWith('C')) {
        category = 'capacitor';
        name = 'MIM Capacitor';
      } else if (id.startsWith('R')) {
        category = 'resistor';
        name = 'Poly Resistor';
      }

      return {
        id: `comp_${id}`,
        name,
        category,
        description: `${name} transistor`,
        symbol: this.generateSymbol(category),
        pins: this.generatePins(category),
        properties: {
          width: size.w || 0,
          length: size.l || 0,
          value: size
        }
      };
    });
  }

  private generateBandgapComponents(componentIds: string[], sizing: Record<string, any>): Component[] {
    return componentIds.map(id => {
      let category = 'mosfet';
      let name = 'NMOS';

      if (id.startsWith('Q')) {
        category = 'bjt';
        name = 'NPN BJT';
      } else if (id.startsWith('R')) {
        category = 'resistor';
        name = 'Poly Resistor';
      } else if (id.startsWith('M')) {
        category = 'mosfet';
        name = 'NMOS';
      }

      return {
        id: `comp_${id}`,
        name,
        category,
        description: `${name} component`,
        symbol: this.generateSymbol(category),
        pins: this.generatePins(category),
        properties: {
          value: sizing[id]
        }
      };
    });
  }

  private generateSymbol(category: string): any {
    // Simplified symbol generation
    return {
      width: 20,
      height: 20,
      paths: [],
      circles: [],
      rectangles: [],
      text: []
    };
  }

  private generatePins(category: string): any[] {
    switch (category) {
      case 'mosfet':
        return [
          { id: 'gate', name: 'G', x: 0, y: 10, type: 'input' },
          { id: 'drain', name: 'D', x: 20, y: 0, type: 'io' },
          { id: 'source', name: 'S', x: 20, y: 20, type: 'io' },
          { id: 'bulk', name: 'B', x: 0, y: 20, type: 'io' }
        ];
      case 'bjt':
        return [
          { id: 'base', name: 'B', x: 0, y: 10, type: 'input' },
          { id: 'collector', name: 'C', x: 20, y: 0, type: 'io' },
          { id: 'emitter', name: 'E', x: 20, y: 20, type: 'io' }
        ];
      case 'resistor':
        return [
          { id: 'p1', name: '1', x: 0, y: 10, type: 'passive' },
          { id: 'p2', name: '2', x: 20, y: 10, type: 'passive' }
        ];
      case 'capacitor':
        return [
          { id: 'p1', name: '1', x: 0, y: 10, type: 'passive' },
          { id: 'p2', name: '2', x: 20, y: 10, type: 'passive' }
        ];
      default:
        return [];
    }
  }

  private estimatePerformance(topology: string, sizing: Record<string, any>, vdd: number): Record<string, number> {
    // Simplified performance estimation
    const performance: Record<string, number> = {};

    switch (topology) {
      case 'two_stage_opamp':
        performance.gain = 60; // dB
        performance.bandwidth = 10e6; // 10 MHz
        performance.slewRate = 10; // V/μs
        performance.inputOffset = 1; // mV
        performance.cmrr = 80; // dB
        performance.psrr = 70; // dB
        performance.noise = 10; // nV/√Hz
        performance.power = vdd * 0.5; // mW
        break;

      case 'folded_cascode_opamp':
        performance.gain = 70; // dB
        performance.bandwidth = 100e6; // 100 MHz
        performance.slewRate = 50; // V/μs
        performance.inputOffset = 2; // mV
        performance.cmrr = 85; // dB
        performance.psrr = 75; // dB
        performance.noise = 8; // nV/√Hz
        performance.power = vdd * 1.0; // mW
        break;
    }

    return performance;
  }

  private estimateComparatorPerformance(sizing: Record<string, any>, vdd: number): Record<string, number> {
    return {
      bandwidth: 200e6, // 200 MHz
      slewRate: 100, // V/μs
      inputOffset: 5, // mV
      hysteresis: 10, // mV
      propagationDelay: 2, // ns
      power: vdd * 0.3 // mW
    };
  }

  private estimateBandgapPerformance(sizing: Record<string, any>): Record<string, number> {
    return {
      outputVoltage: 1.25, // V
      temperatureCoefficient: 20, // ppm/°C
      lineRegulation: 0.1, // %/V
      loadRegulation: 0.5, // %/mA
      power: 0.1 // mW
    };
  }

  getAvailableTopologies(): string[] {
    return Array.from(this.topologies.keys());
  }

  getTopologyInfo(topology: string): any {
    return this.topologies.get(topology);
  }
}

export const analogSynthesizer = new AnalogSynthesizer();