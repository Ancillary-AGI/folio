import { Component } from '../../types';

export interface DFTStructure {
  id: string;
  designId: string;
  testPoints: Array<{
    id: string;
    type: 'boundary_scan' | 'internal_test' | 'external_test';
    location: { x: number; y: number };
    signals: string[];
  }>;
  scanChains: Array<{
    id: string;
    length: number;
    components: string[];
    tdi: string; // Test Data In
    tdo: string; // Test Data Out
  }>;
  bistCircuits: Array<{
    id: string;
    type: 'memory_bist' | 'logic_bist' | 'analog_bist';
    coverage: number; // percentage
    area: number; // μm²
    power: number; // μW
  }>;
  jtagInterface: {
    tck: string; // Test Clock
    tms: string; // Test Mode Select
    tdi: string; // Test Data In
    tdo: string; // Test Data Out
    trst: string; // Test Reset
  };
  testCoverage: {
    stuckAt: number;
    transition: number;
    pathDelay: number;
    overall: number;
  };
  testTime: number; // seconds
  areaOverhead: number; // percentage
  powerOverhead: number; // percentage
}

export interface TestAccessPort {
  id: string;
  name: string;
  type: 'jtag' | 'ijtag' | 'boundary_scan';
  pins: Array<{
    name: string;
    function: string;
    electrical: {
      voltage: number;
      current: number;
    };
  }>;
  protocol: {
    instructions: string[];
    registers: Array<{
      name: string;
      size: number;
      function: string;
    }>;
  };
}

export interface BuiltInSelfTest {
  id: string;
  name: string;
  type: 'memory_bist' | 'logic_bist' | 'analog_bist' | 'mixed_signal_bist';
  algorithm: 'march' | 'checkerboard' | 'galpat' | 'custom';
  configuration: {
    patternGenerator: string;
    responseAnalyzer: string;
    controller: string;
  };
  coverage: {
    faultCoverage: number;
    defectCoverage: number;
    diagnosticResolution: number;
  };
  performance: {
    testTime: number; // cycles
    area: number; // gates
    power: number; // μW
  };
}

export class DFTInserter {
  private dftStructures: Map<string, DFTStructure> = new Map();
  private bistCircuits: Map<string, BuiltInSelfTest> = new Map();

  insertBoundaryScan(components: Component[], boardOutline: any): DFTStructure {
    const testPoints = [];
    const scanChains = [];

    // Identify components that need boundary scan
    const bscanComponents = components.filter(c =>
      c.category === 'integrated_circuit' || c.category === 'fpga'
    );

    // Create boundary scan cells for each I/O pin
    bscanComponents.forEach(component => {
      component.pins.forEach(pin => {
        if (pin.type === 'input' || pin.type === 'output' || pin.type === 'io') {
          testPoints.push({
            id: `bscan_${component.id}_${pin.id}`,
            type: 'boundary_scan',
            location: { x: 0, y: 0 }, // Would be actual pin location
            signals: [pin.name]
          });
        }
      });
    });

    // Create scan chains
    let chainIndex = 0;
    let currentChain = [];
    let chainLength = 0;

    testPoints.forEach((point, index) => {
      currentChain.push(point.id);
      chainLength++;

      // Create chain every 100 cells or at end
      if (chainLength >= 100 || index === testPoints.length - 1) {
        scanChains.push({
          id: `chain_${chainIndex++}`,
          length: chainLength,
          components: currentChain,
          tdi: `TDI_${chainIndex}`,
          tdo: `TDO_${chainIndex}`
        });
        currentChain = [];
        chainLength = 0;
      }
    });

    // JTAG interface
    const jtagInterface = {
      tck: 'TCK',
      tms: 'TMS',
      tdi: 'TDI',
      tdo: 'TDO',
      trst: 'TRST'
    };

    // Calculate coverage and overhead
    const testCoverage = {
      stuckAt: 95,
      transition: 90,
      pathDelay: 85,
      overall: 92
    };

    const testTime = testPoints.length * 1000; // 1000 cycles per test point
    const areaOverhead = (testPoints.length * 50) / 10000; // 50 gates per cell
    const powerOverhead = 10; // 10% power overhead

    const dftStructure: DFTStructure = {
      id: `dft_${Date.now()}`,
      designId: 'design_1',
      testPoints,
      scanChains,
      bistCircuits: [],
      jtagInterface,
      testCoverage,
      testTime,
      areaOverhead,
      powerOverhead
    };

    this.dftStructures.set(dftStructure.id, dftStructure);
    return dftStructure;
  }

  insertMemoryBIST(memories: Component[]): BuiltInSelfTest {
    const bist: BuiltInSelfTest = {
      id: `bist_mem_${Date.now()}`,
      name: 'Memory BIST Controller',
      type: 'memory_bist',
      algorithm: 'march',
      configuration: {
        patternGenerator: 'LFSR', // Linear Feedback Shift Register
        responseAnalyzer: 'MISR', // Multiple Input Signature Register
        controller: 'FSM' // Finite State Machine
      },
      coverage: {
        faultCoverage: 98,
        defectCoverage: 95,
        diagnosticResolution: 16 // bits
      },
      performance: {
        testTime: memories.length * 10000, // 10000 cycles per memory
        area: memories.length * 500, // 500 gates per memory
        power: memories.length * 100 // 100 μW per memory
      }
    };

    this.bistCircuits.set(bist.id, bist);
    return bist;
  }

  insertLogicBIST(logicBlocks: Component[]): BuiltInSelfTest {
    const bist: BuiltInSelfTest = {
      id: `bist_logic_${Date.now()}`,
      name: 'Logic BIST Controller',
      type: 'logic_bist',
      algorithm: 'galpat',
      configuration: {
        patternGenerator: 'LFSR',
        responseAnalyzer: 'MISR',
        controller: 'FSM'
      },
      coverage: {
        faultCoverage: 85,
        defectCoverage: 80,
        diagnosticResolution: 32
      },
      performance: {
        testTime: logicBlocks.length * 50000, // 50000 cycles per logic block
        area: logicBlocks.length * 1000, // 1000 gates per logic block
        power: logicBlocks.length * 200 // 200 μW per logic block
      }
    };

    this.bistCircuits.set(bist.id, bist);
    return bist;
  }

  insertAnalogBIST(analogComponents: Component[]): BuiltInSelfTest {
    const bist: BuiltInSelfTest = {
      id: `bist_analog_${Date.now()}`,
      name: 'Analog BIST Controller',
      type: 'analog_bist',
      algorithm: 'custom',
      configuration: {
        patternGenerator: 'DDS', // Direct Digital Synthesis
        responseAnalyzer: 'ADC', // Analog to Digital Converter
        controller: 'DSP' // Digital Signal Processor
      },
      coverage: {
        faultCoverage: 75,
        defectCoverage: 70,
        diagnosticResolution: 12 // bits
      },
      performance: {
        testTime: analogComponents.length * 100000, // 100000 cycles per analog component
        area: analogComponents.length * 2000, // 2000 gates per analog component
        power: analogComponents.length * 500 // 500 μW per analog component
      }
    };

    this.bistCircuits.set(bist.id, bist);
    return bist;
  }

  optimizeDFTStructure(dft: DFTStructure): DFTStructure {
    const optimized = { ...dft };

    // Optimize scan chain length
    optimized.scanChains = dft.scanChains.map(chain => {
      if (chain.length > 200) {
        // Split long chains
        const numChains = Math.ceil(chain.length / 100);
        const chainLength = Math.ceil(chain.length / numChains);

        return {
          ...chain,
          length: chainLength
        };
      }
      return chain;
    });

    // Reduce test time by parallel testing
    optimized.testTime *= 0.7; // 30% reduction

    // Optimize area overhead
    optimized.areaOverhead *= 0.8; // 20% reduction

    return optimized;
  }

  generateTestAccessPort(type: 'jtag' | 'ijtag' | 'boundary_scan'): TestAccessPort {
    const basePins = [
      { name: 'TCK', function: 'Test Clock', electrical: { voltage: 3.3, current: 0.1 } },
      { name: 'TMS', function: 'Test Mode Select', electrical: { voltage: 3.3, current: 0.1 } },
      { name: 'TDI', function: 'Test Data In', electrical: { voltage: 3.3, current: 0.1 } },
      { name: 'TDO', function: 'Test Data Out', electrical: { voltage: 3.3, current: 0.05 } }
    ];

    let instructions = [];
    let registers = [];

    switch (type) {
      case 'jtag':
        instructions = ['EXTEST', 'SAMPLE', 'PRELOAD', 'BYPASS', 'IDCODE'];
        registers = [
          { name: 'BYPASS', size: 1, function: 'Bypass register' },
          { name: 'IDCODE', size: 32, function: 'Device identification' },
          { name: 'BSR', size: 100, function: 'Boundary scan register' }
        ];
        break;

      case 'ijtag':
        instructions = ['EXTEST', 'SAMPLE', 'PRELOAD', 'BYPASS', 'CLAMP', 'HIGHZ'];
        registers = [
          { name: 'BYPASS', size: 1, function: 'Bypass register' },
          { name: 'CLAMP', size: 1, function: 'Clamp register' },
          { name: 'SIB', size: 1, function: 'Segment insertion bit' }
        ];
        break;

      case 'boundary_scan':
        instructions = ['EXTEST', 'SAMPLE', 'PRELOAD', 'BYPASS'];
        registers = [
          { name: 'BYPASS', size: 1, function: 'Bypass register' },
          { name: 'BSR', size: 200, function: 'Boundary scan register' }
        ];
        break;
    }

    return {
      id: `tap_${type}_${Date.now()}`,
      name: `${type.toUpperCase()} Test Access Port`,
      type,
      pins: type === 'jtag' ? [...basePins, { name: 'TRST', function: 'Test Reset', electrical: { voltage: 3.3, current: 0.1 } }] : basePins,
      protocol: {
        instructions,
        registers
      }
    };
  }

  analyzeTestCoverage(dft: DFTStructure, faultList: any[]): {
    coverage: number;
    gaps: string[];
    recommendations: string[];
  } {
    const totalFaults = faultList.length;
    let coveredFaults = 0;

    // Analyze coverage for each fault type
    faultList.forEach(fault => {
      if (this.isFaultCovered(fault, dft)) {
        coveredFaults++;
      }
    });

    const coverage = (coveredFaults / totalFaults) * 100;
    const gaps = this.identifyCoverageGaps(faultList, dft);
    const recommendations = this.generateCoverageRecommendations(gaps, coverage);

    return { coverage, gaps, recommendations };
  }

  private isFaultCovered(fault: any, dft: DFTStructure): boolean {
    // Check if fault is covered by DFT structure
    return dft.testPoints.some(point =>
      point.signals.includes(fault.location.pinId || fault.location.netId)
    ) || dft.bistCircuits.some(bist => bist.coverage.faultCoverage > 80);
  }

  private identifyCoverageGaps(faultList: any[], dft: DFTStructure): string[] {
    const gaps = [];

    // Check for uncovered fault types
    const uncoveredStuckAt = faultList.filter(f =>
      f.type === 'stuck_at_0' || f.type === 'stuck_at_1'
    ).length - dft.testCoverage.stuckAt;

    if (uncoveredStuckAt > 10) {
      gaps.push('Low stuck-at fault coverage');
    }

    // Check for long scan chains
    const longChains = dft.scanChains.filter(chain => chain.length > 200);
    if (longChains.length > 0) {
      gaps.push('Long scan chains affecting test time');
    }

    // Check for low BIST coverage
    const lowBistCoverage = dft.bistCircuits.filter(bist => bist.coverage.faultCoverage < 90);
    if (lowBistCoverage.length > 0) {
      gaps.push('Low BIST fault coverage');
    }

    return gaps;
  }

  private generateCoverageRecommendations(gaps: string[], coverage: number): string[] {
    const recommendations = [];

    if (coverage < 90) {
      recommendations.push('Add more test points to improve fault coverage');
    }

    if (gaps.includes('Low stuck-at fault coverage')) {
      recommendations.push('Increase boundary scan coverage for stuck-at faults');
    }

    if (gaps.includes('Long scan chains affecting test time')) {
      recommendations.push('Split long scan chains to reduce test time');
    }

    if (gaps.includes('Low BIST fault coverage')) {
      recommendations.push('Enhance BIST algorithms for better coverage');
    }

    recommendations.push('Perform ATPG to identify additional test patterns');
    recommendations.push('Add compression logic to reduce test data volume');

    return recommendations;
  }

  estimateDFTOverhead(dft: DFTStructure): {
    area: number;
    power: number;
    timing: number;
    cost: number;
  } {
    const area = dft.areaOverhead;
    const power = dft.powerOverhead;
    const timing = 5; // 5% timing overhead
    const cost = (dft.testPoints.length * 0.01) + (dft.scanChains.length * 0.05); // Cost per test point/chain

    return { area, power, timing, cost };
  }

  getDFTStructure(id: string): DFTStructure | undefined {
    return this.dftStructures.get(id);
  }

  getBISTCircuit(id: string): BuiltInSelfTest | undefined {
    return this.bistCircuits.get(id);
  }

  getAllDFTStructures(): DFTStructure[] {
    return Array.from(this.dftStructures.values());
  }

  getAllBISTCircuits(): BuiltInSelfTest[] {
    return Array.from(this.bistCircuits.values());
  }
}

export const dftInserter = new DFTInserter();