import { Component, Net, Wire } from '../../types';

export interface ElectromagneticField {
  frequency: number;
  magnitude: number;
  phase: number;
  polarization: 'horizontal' | 'vertical' | 'circular';
  position: { x: number; y: number; z: number };
}

export interface EMCStandard {
  name: string;
  standard: 'FCC' | 'CISPR' | 'EN' | 'IEC';
  class: 'A' | 'B' | 'residential' | 'industrial';
  frequencyRange: { min: number; max: number };
  limits: Array<{ frequency: number; limit: number; unit: 'dBuV/m' | 'dBuA/m' }>;
}

export interface EMCViolation {
  type: 'radiated_emissions' | 'conducted_emissions' | 'immunity' | 'harmonics' | 'flicker';
  severity: 'low' | 'medium' | 'high' | 'critical';
  frequency: number;
  measured: number;
  limit: number;
  margin: number; // dB
  standard: string;
  description: string;
  mitigation: string;
  location?: { x: number; y: number };
}

export interface EMCResult {
  id: string;
  timestamp: number;
  standard: EMCStandard;
  violations: EMCViolation[];
  summary: {
    totalViolations: number;
    worstMargin: number;
    complianceStatus: 'pass' | 'fail' | 'marginal';
    frequencyRange: { min: number; max: number };
  };
  emissions: ElectromagneticField[];
  recommendations: string[];
}

export class ElectromagneticCompatibilityAnalyzer {
  private standards: Map<string, EMCStandard> = new Map();

  constructor() {
    this.initializeStandards();
  }

  private initializeStandards(): void {
    // FCC Part 15 Class B
    this.standards.set('FCC_Class_B', {
      name: 'FCC Part 15 Class B',
      standard: 'FCC',
      class: 'B',
      frequencyRange: { min: 30e6, max: 1e9 }, // 30MHz to 1GHz
      limits: [
        { frequency: 30e6, limit: 40, unit: 'dBuV/m' },
        { frequency: 88e6, limit: 43.5, unit: 'dBuV/m' },
        { frequency: 216e6, limit: 46, unit: 'dBuV/m' },
        { frequency: 960e6, limit: 54, unit: 'dBuV/m' }
      ]
    });

    // CISPR 22 Class B
    this.standards.set('CISPR_22_Class_B', {
      name: 'CISPR 22 Class B',
      standard: 'CISPR',
      class: 'B',
      frequencyRange: { min: 30e6, max: 1e9 },
      limits: [
        { frequency: 30e6, limit: 30, unit: 'dBuV/m' },
        { frequency: 230e6, limit: 37, unit: 'dBuV/m' },
        { frequency: 1e9, limit: 47, unit: 'dBuV/m' }
      ]
    });

    // EN 55022 Class B
    this.standards.set('EN_55022_Class_B', {
      name: 'EN 55022 Class B',
      standard: 'EN',
      class: 'B',
      frequencyRange: { min: 30e6, max: 1e9 },
      limits: [
        { frequency: 30e6, limit: 30, unit: 'dBuV/m' },
        { frequency: 230e6, limit: 37, unit: 'dBuV/m' },
        { frequency: 1e9, limit: 47, unit: 'dBuV/m' }
      ]
    });
  }

  analyzeEMC(components: Component[], nets: Net[], wires: Wire[], standardName: string): EMCResult {
    const standard = this.standards.get(standardName);
    if (!standard) {
      throw new Error(`EMC standard '${standardName}' not found`);
    }

    const emissions = this.calculateEmissions(components, nets, wires);
    const violations = this.checkCompliance(emissions, standard);
    const summary = this.generateSummary(violations, standard);
    const recommendations = this.generateRecommendations(violations);

    return {
      id: `emc_${Date.now()}`,
      timestamp: Date.now(),
      standard,
      violations,
      summary,
      emissions,
      recommendations
    };
  }

  private calculateEmissions(components: Component[], nets: Net[], wires: Wire[]): ElectromagneticField[] {
    const emissions: ElectromagneticField[] = [];

    // Analyze each component for potential emissions
    components.forEach(component => {
      const componentEmissions = this.analyzeComponentEmissions(component);
      emissions.push(...componentEmissions);
    });

    // Analyze nets and wires for conducted and radiated emissions
    nets.forEach(net => {
      const netWires = wires.filter(wire => wire.netName === net.name);
      const netEmissions = this.analyzeNetEmissions(net, netWires);
      emissions.push(...netEmissions);
    });

    return emissions;
  }

  private analyzeComponentEmissions(component: Component): ElectromagneticField[] {
    const emissions: ElectromagneticField[] = [];
    const category = component.category.toLowerCase();
    const name = component.name.toLowerCase();

    // Different components have different emission characteristics
    if (category.includes('ic') || category.includes('chip')) {
      // Digital IC emissions
      if (name.includes('esp32') || name.includes('esp8266')) {
        // WiFi-enabled chips have specific emissions
        emissions.push(
          {
            frequency: 2.4e9, // 2.4 GHz WiFi
            magnitude: 20, // dBuV/m
            phase: 0,
            polarization: 'vertical',
            position: { x: 0, y: 0, z: 0 }
          },
          {
            frequency: 5e9, // 5 GHz WiFi
            magnitude: 15,
            phase: 90,
            polarization: 'horizontal',
            position: { x: 0, y: 0, z: 0 }
          }
        );
      } else {
        // General digital IC
        emissions.push({
          frequency: 100e6, // 100 MHz clock
          magnitude: 25,
          phase: 45,
          polarization: 'circular',
          position: { x: 0, y: 0, z: 0 }
        });
      }
    }

    if (category.includes('switch') || category.includes('dc-dc')) {
      // Switching regulator emissions
      for (let i = 1; i <= 10; i++) {
        emissions.push({
          frequency: i * 100e3, // Harmonics of switching frequency
          magnitude: 30 - i * 2, // Decreasing with harmonic order
          phase: i * 36, // 36° phase increment
          polarization: i % 2 === 0 ? 'horizontal' : 'vertical',
          position: { x: 0, y: 0, z: 0 }
        });
      }
    }

    if (category.includes('motor')) {
      // Motor emissions
      emissions.push({
        frequency: 50, // Line frequency
        magnitude: 35,
        phase: 0,
        polarization: 'vertical',
        position: { x: 0, y: 0, z: 0 }
      });
    }

    return emissions;
  }

  private analyzeNetEmissions(net: Net, wires: Wire[]): ElectromagneticField[] {
    const emissions: ElectromagneticField[] = [];

    // Calculate net length and geometry
    let totalLength = 0;
    wires.forEach(wire => {
      for (let i = 1; i < wire.points.length; i++) {
        const dx = wire.points[i].x - wire.points[i - 1].x;
        const dy = wire.points[i].y - wire.points[i - 1].y;
        totalLength += Math.sqrt(dx * dx + dy * dy);
      }
    });

    // Estimate emissions based on net length and type
    const netName = net.name.toLowerCase();
    if (netName.includes('power') || netName.includes('vcc') || netName.includes('gnd')) {
      // Power net emissions
      emissions.push({
        frequency: 50, // Power line frequency
        magnitude: Math.log10(totalLength) * 10 + 20, // Higher emissions for longer nets
        phase: 0,
        polarization: 'vertical',
        position: { x: 0, y: 0, z: 0 }
      });
    } else {
      // Signal net emissions
      const estimatedFrequency = this.estimateNetFrequency(net, wires);
      if (estimatedFrequency > 0) {
        emissions.push({
          frequency: estimatedFrequency,
          magnitude: Math.log10(totalLength) * 5 + 15,
          phase: 45,
          polarization: 'horizontal',
          position: { x: 0, y: 0, z: 0 }
        });
      }
    }

    return emissions;
  }

  private estimateNetFrequency(net: Net, wires: Wire[]): number {
    // Estimate signal frequency based on connected components
    // This is a simplified estimation
    const netName = net.name.toLowerCase();

    if (netName.includes('clock') || netName.includes('osc')) return 100e6; // 100 MHz
    if (netName.includes('spi') || netName.includes('i2c')) return 10e6; // 10 MHz
    if (netName.includes('uart') || netName.includes('serial')) return 115200; // Baud rate

    return 1e6; // Default 1 MHz
  }

  private checkCompliance(emissions: ElectromagneticField[], standard: EMCStandard): EMCViolation[] {
    const violations: EMCViolation[] = [];

    emissions.forEach(emission => {
      if (emission.frequency >= standard.frequencyRange.min &&
          emission.frequency <= standard.frequencyRange.max) {

        // Interpolate limit at emission frequency
        const limit = this.interpolateLimit(emission.frequency, standard.limits);

        if (emission.magnitude > limit) {
          const margin = emission.magnitude - limit;

          violations.push({
            type: 'radiated_emissions',
            severity: this.calculateSeverity(margin),
            frequency: emission.frequency,
            measured: emission.magnitude,
            limit,
            margin,
            standard: standard.name,
            description: `Radiated emission exceeds limit at ${emission.frequency / 1e6} MHz`,
            mitigation: this.getMitigationStrategy(emission.frequency, margin),
            location: { x: emission.position.x, y: emission.position.y }
          });
        }
      }
    });

    return violations;
  }

  private interpolateLimit(frequency: number, limits: Array<{ frequency: number; limit: number }>): number {
    if (limits.length === 0) return 0;

    // Find the two closest frequency points
    const sortedLimits = limits.sort((a, b) => a.frequency - b.frequency);

    for (let i = 0; i < sortedLimits.length - 1; i++) {
      if (frequency >= sortedLimits[i].frequency && frequency <= sortedLimits[i + 1].frequency) {
        // Linear interpolation
        const f1 = sortedLimits[i].frequency;
        const f2 = sortedLimits[i + 1].frequency;
        const l1 = sortedLimits[i].limit;
        const l2 = sortedLimits[i + 1].limit;

        return l1 + (l2 - l1) * (frequency - f1) / (f2 - f1);
      }
    }

    // Extrapolate if outside range
    if (frequency < sortedLimits[0].frequency) return sortedLimits[0].limit;
    return sortedLimits[sortedLimits.length - 1].limit;
  }

  private calculateSeverity(margin: number): 'low' | 'medium' | 'high' | 'critical' {
    if (margin > 20) return 'critical';
    if (margin > 10) return 'high';
    if (margin > 3) return 'medium';
    return 'low';
  }

  private getMitigationStrategy(frequency: number, margin: number): string {
    if (frequency > 1e9) {
      return 'Add EMI shielding, use ferrite beads, implement spread spectrum techniques';
    } else if (frequency > 100e6) {
      return 'Add bypass capacitors, improve ground plane, use differential signaling';
    } else {
      return 'Add decoupling capacitors, improve power distribution, use twisted pair cables';
    }
  }

  private generateSummary(violations: EMCViolation[], standard: EMCStandard) {
    const totalViolations = violations.length;
    const worstMargin = violations.length > 0 ?
      Math.max(...violations.map(v => v.margin)) : 0;

    let complianceStatus: 'pass' | 'fail' | 'marginal';
    if (totalViolations === 0) {
      complianceStatus = 'pass';
    } else if (worstMargin > 10) {
      complianceStatus = 'fail';
    } else {
      complianceStatus = 'marginal';
    }

    return {
      totalViolations,
      worstMargin,
      complianceStatus,
      frequencyRange: standard.frequencyRange
    };
  }

  private generateRecommendations(violations: EMCViolation[]): string[] {
    const recommendations: string[] = [];

    if (violations.some(v => v.type === 'radiated_emissions')) {
      recommendations.push('Implement proper EMI shielding for high-frequency components');
      recommendations.push('Add ground planes and power planes to reduce emissions');
      recommendations.push('Use bypass and decoupling capacitors near power pins');
    }

    if (violations.some(v => v.frequency > 1e9)) {
      recommendations.push('Consider spread spectrum techniques for high-frequency emissions');
      recommendations.push('Use ferrite beads and EMI filters on signal lines');
    }

    if (violations.some(v => v.margin > 10)) {
      recommendations.push('Critical emissions detected - redesign may be necessary');
      recommendations.push('Consult with EMC expert for compliance certification');
    }

    recommendations.push('Perform radiated emissions testing in certified EMC chamber');
    recommendations.push('Document all mitigation techniques and test results');

    return recommendations;
  }

  addCustomStandard(standard: EMCStandard): void {
    this.standards.set(standard.name, standard);
  }

  getAvailableStandards(): string[] {
    return Array.from(this.standards.keys());
  }

  getStandard(name: string): EMCStandard | undefined {
    return this.standards.get(name);
  }
}

export const emcAnalyzer = new ElectromagneticCompatibilityAnalyzer();