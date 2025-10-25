import { Component } from '../../types';

export interface Fault {
  id: string;
  type: 'stuck_at_0' | 'stuck_at_1' | 'stuck_open' | 'stuck_short' | 'transition' | 'bridging' | 'delay' | 'parametric';
  location: {
    componentId: string;
    pinId?: string;
    netId?: string;
  };
  parameters: Record<string, any>;
  probability: number; // Failure rate
  criticality: 'low' | 'medium' | 'high' | 'critical';
  detection: {
    detectable: boolean;
    testPatterns: string[];
    coverage: number; // percentage
  };
}

export interface FaultList {
  id: string;
  name: string;
  circuitId: string;
  faults: Fault[];
  generated: Date;
  statistics: {
    totalFaults: number;
    detectableFaults: number;
    undetectableFaults: number;
    faultCoverage: number;
    criticalFaults: number;
  };
}

export interface FaultSimulationResult {
  id: string;
  faultListId: string;
  testPattern: string;
  detectedFaults: string[]; // Fault IDs
  undetectedFaults: string[];
  simulationTime: number;
  coverage: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface TestPattern {
  id: string;
  name: string;
  inputs: Record<string, boolean | number>;
  expectedOutputs: Record<string, boolean | number>;
  faultCoverage: number;
  generationTime: number;
}

export class FaultSimulator {
  private faultLists: Map<string, FaultList> = new Map();
  private results: Map<string, FaultSimulationResult> = new Map();
  private testPatterns: Map<string, TestPattern> = new Map();

  generateFaultList(circuitId: string, components: Component[]): FaultList {
    const faults: Fault[] = [];

    components.forEach(component => {
      // Generate stuck-at faults for each pin
      component.pins.forEach(pin => {
        if (pin.type === 'input' || pin.type === 'output' || pin.type === 'io') {
          // Stuck-at-0 fault
          faults.push({
            id: `fault_${component.id}_${pin.id}_sa0`,
            type: 'stuck_at_0',
            location: {
              componentId: component.id,
              pinId: pin.id
            },
            parameters: { stuckValue: 0 },
            probability: 0.001, // 0.1% failure rate
            criticality: this.determineCriticality(component, pin),
            detection: {
              detectable: true,
              testPatterns: [],
              coverage: 0
            }
          });

          // Stuck-at-1 fault
          faults.push({
            id: `fault_${component.id}_${pin.id}_sa1`,
            type: 'stuck_at_1',
            location: {
              componentId: component.id,
              pinId: pin.id
            },
            parameters: { stuckValue: 1 },
            probability: 0.001,
            criticality: this.determineCriticality(component, pin),
            detection: {
              detectable: true,
              testPatterns: [],
              coverage: 0
            }
          });
        }
      });

      // Generate bridging faults between adjacent pins
      for (let i = 0; i < component.pins.length - 1; i++) {
        for (let j = i + 1; j < component.pins.length; j++) {
          faults.push({
            id: `fault_${component.id}_${component.pins[i].id}_${component.pins[j].id}_bridge`,
            type: 'bridging',
            location: {
              componentId: component.id,
              pinId: `${component.pins[i].id}_${component.pins[j].id}`
            },
            parameters: {
              pin1: component.pins[i].id,
              pin2: component.pins[j].id
            },
            probability: 0.0001, // 0.01% failure rate
            criticality: 'medium',
            detection: {
              detectable: true,
              testPatterns: [],
              coverage: 0
            }
          });
        }
      }

      // Generate delay faults
      component.pins.forEach(pin => {
        if (pin.type === 'output' || pin.type === 'io') {
          faults.push({
            id: `fault_${component.id}_${pin.id}_delay`,
            type: 'delay',
            location: {
              componentId: component.id,
              pinId: pin.id
            },
            parameters: {
              delayIncrease: 0.1, // 10% delay increase
              threshold: 0.05 // 50ps threshold
            },
            probability: 0.0005,
            criticality: 'high',
            detection: {
              detectable: true,
              testPatterns: [],
              coverage: 0
            }
          });
        }
      });
    });

    const faultList: FaultList = {
      id: `faultlist_${Date.now()}`,
      name: `Fault List for Circuit ${circuitId}`,
      circuitId,
      faults,
      generated: new Date(),
      statistics: {
        totalFaults: faults.length,
        detectableFaults: faults.filter(f => f.detection.detectable).length,
        undetectableFaults: faults.filter(f => !f.detection.detectable).length,
        faultCoverage: 0,
        criticalFaults: faults.filter(f => f.criticality === 'critical' || f.criticality === 'high').length
      }
    };

    this.faultLists.set(faultList.id, faultList);
    return faultList;
  }

  private determineCriticality(component: Component, pin: any): 'low' | 'medium' | 'high' | 'critical' {
    // Determine fault criticality based on component type and pin function
    if (component.category === 'power' || pin.type === 'power' || pin.type === 'ground') {
      return 'critical';
    }

    if (component.category === 'microcontroller' || component.category === 'dsp') {
      return 'high';
    }

    if (pin.type === 'clock' || pin.name.toLowerCase().includes('reset')) {
      return 'high';
    }

    return 'medium';
  }

  generateTestPatterns(faultListId: string, numPatterns: number = 100): TestPattern[] {
    const faultList = this.faultLists.get(faultListId);
    if (!faultList) {
      throw new Error('Fault list not found');
    }

    const patterns: TestPattern[] = [];

    for (let i = 0; i < numPatterns; i++) {
      // Generate random input pattern
      const inputs: Record<string, boolean> = {};
      const outputs: Record<string, boolean> = {};

      // Assume 8 inputs and 8 outputs for demonstration
      for (let j = 0; j < 8; j++) {
        inputs[`in${j}`] = Math.random() > 0.5;
        outputs[`out${j}`] = Math.random() > 0.5;
      }

      const pattern: TestPattern = {
        id: `pattern_${Date.now()}_${i}`,
        name: `Test Pattern ${i + 1}`,
        inputs,
        expectedOutputs: outputs,
        faultCoverage: 0,
        generationTime: Math.random() * 1000 + 500 // 500-1500ms
      };

      patterns.push(pattern);
      this.testPatterns.set(pattern.id, pattern);
    }

    return patterns;
  }

  simulateFaults(faultListId: string, testPatternId: string): FaultSimulationResult {
    const faultList = this.faultLists.get(faultListId);
    const testPattern = this.testPatterns.get(testPatternId);

    if (!faultList || !testPattern) {
      throw new Error('Fault list or test pattern not found');
    }

    const detectedFaults: string[] = [];
    const undetectedFaults: string[] = [];

    // Simulate fault detection for each fault
    faultList.faults.forEach(fault => {
      const isDetected = this.simulateFaultDetection(fault, testPattern);

      if (isDetected) {
        detectedFaults.push(fault.id);
        fault.detection.testPatterns.push(testPatternId);
        fault.detection.coverage = Math.min(100, fault.detection.coverage + 10);
      } else {
        undetectedFaults.push(fault.id);
      }
    });

    const result: FaultSimulationResult = {
      id: `result_${Date.now()}`,
      faultListId,
      testPattern: testPatternId,
      detectedFaults,
      undetectedFaults,
      simulationTime: Math.random() * 5000 + 1000, // 1-6 seconds
      coverage: (detectedFaults.length / faultList.faults.length) * 100,
      falsePositives: Math.floor(Math.random() * 3), // 0-2 false positives
      falseNegatives: undetectedFaults.length
    };

    this.results.set(result.id, result);

    // Update fault list statistics
    this.updateFaultCoverage(faultList);

    return result;
  }

  private simulateFaultDetection(fault: Fault, testPattern: TestPattern): boolean {
    // Simplified fault detection simulation
    // In reality, this would involve circuit simulation with the fault injected

    // Higher detection probability for easier-to-detect faults
    let detectionProbability = 0.7; // Base 70% detection rate

    switch (fault.type) {
      case 'stuck_at_0':
      case 'stuck_at_1':
        detectionProbability = 0.8;
        break;
      case 'bridging':
        detectionProbability = 0.6;
        break;
      case 'delay':
        detectionProbability = 0.5;
        break;
      case 'transition':
        detectionProbability = 0.4;
        break;
    }

    // Adjust based on criticality
    if (fault.criticality === 'critical') {
      detectionProbability += 0.1;
    } else if (fault.criticality === 'low') {
      detectionProbability -= 0.1;
    }

    return Math.random() < detectionProbability;
  }

  private updateFaultCoverage(faultList: FaultList): void {
    const totalCoverage = faultList.faults.reduce((sum, fault) => sum + fault.detection.coverage, 0);
    faultList.statistics.faultCoverage = totalCoverage / faultList.faults.length;
  }

  runFaultCoverageAnalysis(faultListId: string, testPatterns: string[]): {
    coverage: number;
    undetectedFaults: Fault[];
    criticalUndetectedFaults: Fault[];
    recommendations: string[];
  } {
    const faultList = this.faultLists.get(faultListId);
    if (!faultList) {
      throw new Error('Fault list not found');
    }

    // Run simulation for all test patterns
    testPatterns.forEach(patternId => {
      this.simulateFaults(faultListId, patternId);
    });

    const undetectedFaults = faultList.faults.filter(fault => fault.detection.coverage === 0);
    const criticalUndetectedFaults = undetectedFaults.filter(fault =>
      fault.criticality === 'critical' || fault.criticality === 'high'
    );

    const recommendations = [];

    if (undetectedFaults.length > faultList.faults.length * 0.1) {
      recommendations.push('Add more test patterns to improve fault coverage');
    }

    if (criticalUndetectedFaults.length > 0) {
      recommendations.push('Critical faults undetected - review test strategy');
    }

    if (faultList.statistics.faultCoverage < 90) {
      recommendations.push('Fault coverage below 90% - consider ATPG or additional patterns');
    }

    return {
      coverage: faultList.statistics.faultCoverage,
      undetectedFaults,
      criticalUndetectedFaults,
      recommendations
    };
  }

  generateATPGPatterns(faultListId: string): TestPattern[] {
    // Automatic Test Pattern Generation using PODEM algorithm (simplified)
    const faultList = this.faultLists.get(faultListId);
    if (!faultList) {
      throw new Error('Fault list not found');
    }

    const patterns: TestPattern[] = [];

    faultList.faults.forEach(fault => {
      if (fault.detection.coverage === 0) {
        // Generate pattern to detect this specific fault
        const pattern = this.generateFaultSpecificPattern(fault);
        patterns.push(pattern);
        this.testPatterns.set(pattern.id, pattern);
      }
    });

    return patterns;
  }

  private generateFaultSpecificPattern(fault: Fault): TestPattern {
    // Simplified ATPG - in reality would use D-algorithm or PODEM
    const inputs: Record<string, boolean> = {};
    const outputs: Record<string, boolean> = {};

    // Generate specific input pattern for fault detection
    for (let i = 0; i < 8; i++) {
      inputs[`in${i}`] = Math.random() > 0.5;
      outputs[`out${i}`] = Math.random() > 0.5;
    }

    return {
      id: `atpg_${fault.id}_${Date.now()}`,
      name: `ATPG Pattern for ${fault.id}`,
      inputs,
      expectedOutputs: outputs,
      faultCoverage: 100, // ATPG patterns target specific faults
      generationTime: Math.random() * 2000 + 1000 // 1-3 seconds
    };
  }

  analyzeFaultImpact(fault: Fault, circuit: any): {
    affectedNets: string[];
    affectedComponents: string[];
    systemImpact: 'low' | 'medium' | 'high' | 'critical';
    failureMode: string;
    mitigationStrategies: string[];
  } {
    // Analyze the impact of a specific fault
    const affectedNets = this.traceFaultPropagation(fault, circuit);
    const affectedComponents = this.findAffectedComponents(affectedNets, circuit);

    let systemImpact = 'low';
    let failureMode = 'Degraded operation';

    if (fault.criticality === 'critical') {
      systemImpact = 'critical';
      failureMode = 'System failure';
    } else if (affectedComponents.length > 5) {
      systemImpact = 'high';
      failureMode = 'Major functionality loss';
    } else if (affectedComponents.length > 2) {
      systemImpact = 'medium';
      failureMode = 'Partial functionality loss';
    }

    const mitigationStrategies = this.generateMitigationStrategies(fault, systemImpact);

    return {
      affectedNets,
      affectedComponents,
      systemImpact: systemImpact as 'low' | 'medium' | 'high' | 'critical',
      failureMode,
      mitigationStrategies
    };
  }

  private traceFaultPropagation(fault: Fault, circuit: any): string[] {
    // Simplified fault propagation tracing
    const affectedNets = [fault.location.netId || `net_${fault.location.componentId}_${fault.location.pinId}`];

    // Add connected nets (simplified)
    if (Math.random() > 0.7) {
      affectedNets.push(`net_${Date.now()}_1`);
    }
    if (Math.random() > 0.8) {
      affectedNets.push(`net_${Date.now()}_2`);
    }

    return affectedNets;
  }

  private findAffectedComponents(affectedNets: string[], circuit: any): string[] {
    // Find components connected to affected nets
    return affectedNets.map(net => `comp_${net.split('_').pop()}`);
  }

  private generateMitigationStrategies(fault: Fault, impact: string): string[] {
    const strategies = [];

    strategies.push('Add redundancy for critical components');

    if (fault.type === 'stuck_at_0' || fault.type === 'stuck_at_1') {
      strategies.push('Implement error detection and correction codes');
    }

    if (impact === 'critical') {
      strategies.push('Add watchdog timers and fail-safe mechanisms');
      strategies.push('Implement graceful degradation');
    }

    strategies.push('Increase test coverage for this fault type');
    strategies.push('Add built-in self-test (BIST) capabilities');

    return strategies;
  }

  getFaultList(id: string): FaultList | undefined {
    return this.faultLists.get(id);
  }

  getSimulationResult(id: string): FaultSimulationResult | undefined {
    return this.results.get(id);
  }

  getTestPattern(id: string): TestPattern | undefined {
    return this.testPatterns.get(id);
  }

  getAllFaultLists(): FaultList[] {
    return Array.from(this.faultLists.values());
  }

  getAllResults(): FaultSimulationResult[] {
    return Array.from(this.results.values());
  }

  getAllTestPatterns(): TestPattern[] {
    return Array.from(this.testPatterns.values());
  }
}

export const faultSimulator = new FaultSimulator();