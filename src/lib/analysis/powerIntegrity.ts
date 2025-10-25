import { Component, Net } from '../../types';

export interface PowerRail {
  id: string;
  name: string;
  voltage: number; // Volts
  currentCapacity: number; // Amps
  resistance: number; // Ohms
  inductance: number; // Henry
  capacitance: number; // Farad
}

export interface PowerLoad {
  componentId: string;
  current: number; // Amps
  power: number; // Watts
  efficiency: number; // 0-1
  location: { x: number; y: number };
}

export interface PowerDistributionNetwork {
  rails: PowerRail[];
  loads: PowerLoad[];
  connections: Array<{
    fromRail: string;
    toRail: string;
    resistance: number;
    inductance: number;
  }>;
}

export interface PowerIntegrityIssue {
  type: 'voltage_drop' | 'current_overload' | 'impedance_mismatch' | 'ground_bounce' | 'electromagnetic_interference';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  location: { x: number; y: number };
  affectedComponents: string[];
  metrics: {
    voltageDrop?: number;
    current?: number;
    impedance?: number;
    noise?: number;
  };
  suggestion: string;
}

export interface PowerAnalysisResult {
  id: string;
  timestamp: number;
  pdn: PowerDistributionNetwork;
  issues: PowerIntegrityIssue[];
  summary: {
    totalPowerConsumption: number;
    maxVoltageDrop: number;
    minVoltageMargin: number;
    powerEfficiency: number;
    thermalDissipation: number;
  };
  waveforms: Array<{
    railId: string;
    time: number[];
    voltage: number[];
    current: number[];
  }>;
}

export class PowerIntegrityAnalyzer {
  private pdn: PowerDistributionNetwork = {
    rails: [],
    loads: [],
    connections: []
  };

  analyzePowerIntegrity(components: Component[], nets: Net[]): PowerAnalysisResult {
    this.buildPDN(components, nets);
    const issues = this.identifyIssues();
    const summary = this.calculateSummary();

    return {
      id: `power_${Date.now()}`,
      timestamp: Date.now(),
      pdn: this.pdn,
      issues,
      summary,
      waveforms: this.generateWaveforms()
    };
  }

  private buildPDN(components: Component[], nets: Net[]): void {
    // Identify power rails from nets
    const powerNets = nets.filter(net =>
      net.name.toLowerCase().includes('vcc') ||
      net.name.toLowerCase().includes('vdd') ||
      net.name.toLowerCase().includes('power') ||
      net.name.toLowerCase().includes('5v') ||
      net.name.toLowerCase().includes('3v3') ||
      net.name.toLowerCase().includes('12v')
    );

    // Create power rails
    this.pdn.rails = powerNets.map(net => {
      const voltage = this.inferVoltageFromNetName(net.name);
      return {
        id: net.id,
        name: net.name,
        voltage,
        currentCapacity: 1.0, // Default 1A
        resistance: 0.1, // 0.1Ω
        inductance: 1e-9, // 1nH
        capacitance: 1e-6 // 1μF
      };
    });

    // Add ground rail
    const groundNets = nets.filter(net =>
      net.name.toLowerCase().includes('gnd') ||
      net.name.toLowerCase().includes('ground')
    );

    if (groundNets.length > 0) {
      this.pdn.rails.push({
        id: 'ground',
        name: 'GND',
        voltage: 0,
        currentCapacity: 10.0, // High capacity
        resistance: 0.01, // Low resistance
        inductance: 1e-10, // Very low inductance
        capacitance: 1e-3 // High capacitance
      });
    }

    // Create loads from components
    this.pdn.loads = components.map(comp => ({
      componentId: comp.id,
      current: this.estimateComponentCurrent(comp),
      power: this.estimateComponentPower(comp),
      efficiency: 0.8, // Default 80% efficiency
      location: { x: 0, y: 0 } // Would be set from actual component position
    }));

    // Create connections between rails
    this.pdn.connections = this.pdn.rails.flatMap(rail =>
      this.pdn.rails
        .filter(other => other.id !== rail.id)
        .map(other => ({
          fromRail: rail.id,
          toRail: other.id,
          resistance: 0.05, // 50mΩ typical connection
          inductance: 1e-9 // 1nH
        }))
    );
  }

  private inferVoltageFromNetName(netName: string): number {
    const name = netName.toLowerCase();
    if (name.includes('12v')) return 12.0;
    if (name.includes('5v')) return 5.0;
    if (name.includes('3v3') || name.includes('3.3v')) return 3.3;
    if (name.includes('1v8') || name.includes('1.8v')) return 1.8;
    if (name.includes('1v2') || name.includes('1.2v')) return 1.2;
    return 3.3; // Default
  }

  private estimateComponentCurrent(component: Component): number {
    const category = component.category.toLowerCase();
    const name = component.name.toLowerCase();

    // Rough estimates based on component type
    if (category.includes('led')) return 0.02; // 20mA
    if (category.includes('motor')) return 0.5; // 500mA
    if (category.includes('ic') || category.includes('chip')) {
      if (name.includes('esp32') || name.includes('esp8266')) return 0.2; // 200mA
      if (name.includes('arduino')) return 0.05; // 50mA
      return 0.01; // 10mA default for ICs
    }
    if (category.includes('resistor')) return 0.001; // 1mA
    if (category.includes('capacitor')) return 0.0001; // 0.1mA

    return 0.01; // 10mA default
  }

  private estimateComponentPower(component: Component): number {
    const current = this.estimateComponentCurrent(component);
    const voltage = 3.3; // Assume 3.3V default
    return current * voltage;
  }

  private identifyIssues(): PowerIntegrityIssue[] {
    const issues: PowerIntegrityIssue[] = [];

    // Check voltage drops
    issues.push(...this.checkVoltageDrops());

    // Check current overloads
    issues.push(...this.checkCurrentOverloads());

    // Check impedance issues
    issues.push(...this.checkImpedanceIssues());

    // Check EMI potential
    issues.push(...this.checkEMIIssues());

    return issues;
  }

  private checkVoltageDrops(): PowerIntegrityIssue[] {
    const issues: PowerIntegrityIssue[] = [];

    this.pdn.rails.forEach(rail => {
      if (rail.voltage === 0) return; // Skip ground

      const totalCurrent = this.pdn.loads
        .filter(load => this.isComponentOnRail(load.componentId, rail.id))
        .reduce((sum, load) => sum + load.current, 0);

      const voltageDrop = totalCurrent * rail.resistance;

      if (voltageDrop > rail.voltage * 0.05) { // More than 5% drop
        issues.push({
          type: 'voltage_drop',
          severity: voltageDrop > rail.voltage * 0.1 ? 'high' : 'medium',
          description: `Voltage drop of ${voltageDrop.toFixed(3)}V (${(voltageDrop / rail.voltage * 100).toFixed(1)}%) on ${rail.name}`,
          location: { x: 0, y: 0 },
          affectedComponents: this.getComponentsOnRail(rail.id),
          metrics: { voltageDrop },
          suggestion: 'Increase trace width, add decoupling capacitors, or use thicker copper layers'
        });
      }
    });

    return issues;
  }

  private checkCurrentOverloads(): PowerIntegrityIssue[] {
    const issues: PowerIntegrityIssue[] = [];

    this.pdn.rails.forEach(rail => {
      const totalCurrent = this.pdn.loads
        .filter(load => this.isComponentOnRail(load.componentId, rail.id))
        .reduce((sum, load) => sum + load.current, 0);

      if (totalCurrent > rail.currentCapacity) {
        issues.push({
          type: 'current_overload',
          severity: totalCurrent > rail.currentCapacity * 1.5 ? 'critical' : 'high',
          description: `Current overload: ${totalCurrent.toFixed(3)}A exceeds capacity ${rail.currentCapacity}A on ${rail.name}`,
          location: { x: 0, y: 0 },
          affectedComponents: this.getComponentsOnRail(rail.id),
          metrics: { current: totalCurrent },
          suggestion: 'Increase trace width, add parallel power traces, or use higher current capacity rails'
        });
      }
    });

    return issues;
  }

  private checkImpedanceIssues(): PowerIntegrityIssue[] {
    const issues: PowerIntegrityIssue[] = [];

    this.pdn.rails.forEach(rail => {
      // Calculate target impedance for power integrity
      const targetImpedance = rail.voltage / (rail.currentCapacity * 10); // 10% ripple

      if (rail.resistance > targetImpedance) {
        issues.push({
          type: 'impedance_mismatch',
          severity: rail.resistance > targetImpedance * 2 ? 'high' : 'medium',
          description: `Power rail impedance ${rail.resistance.toFixed(3)}Ω exceeds target ${targetImpedance.toFixed(3)}Ω`,
          location: { x: 0, y: 0 },
          affectedComponents: this.getComponentsOnRail(rail.id),
          metrics: { impedance: rail.resistance },
          suggestion: 'Add decoupling capacitors, reduce trace length, or increase trace width'
        });
      }
    });

    return issues;
  }

  private checkEMIIssues(): PowerIntegrityIssue[] {
    const issues: PowerIntegrityIssue[] = [];

    // Check for high-frequency switching components
    const switchingComponents = this.pdn.loads.filter(load =>
      load.componentId.toLowerCase().includes('switch') ||
      load.componentId.toLowerCase().includes('dc-dc') ||
      load.componentId.toLowerCase().includes('buck') ||
      load.componentId.toLowerCase().includes('boost')
    );

    if (switchingComponents.length > 0) {
      switchingComponents.forEach(load => {
        issues.push({
          type: 'electromagnetic_interference',
          severity: 'medium',
          description: `Switching component ${load.componentId} may cause EMI`,
          location: load.location,
          affectedComponents: [load.componentId],
          metrics: { current: load.current },
          suggestion: 'Add EMI filters, use shielded traces, or add ground planes'
        });
      });
    }

    return issues;
  }

  private isComponentOnRail(componentId: string, railId: string): boolean {
    // Simplified - in real implementation, this would check net connections
    return Math.random() > 0.5; // Random for demo
  }

  private getComponentsOnRail(railId: string): string[] {
    return this.pdn.loads
      .filter(load => this.isComponentOnRail(load.componentId, railId))
      .map(load => load.componentId);
  }

  private calculateSummary() {
    const totalPower = this.pdn.loads.reduce((sum, load) => sum + load.power, 0);
    const totalCurrent = this.pdn.loads.reduce((sum, load) => sum + load.current, 0);

    // Calculate max voltage drop
    let maxVoltageDrop = 0;
    this.pdn.rails.forEach(rail => {
      if (rail.voltage > 0) {
        const railCurrent = this.pdn.loads
          .filter(load => this.isComponentOnRail(load.componentId, rail.id))
          .reduce((sum, load) => sum + load.current, 0);
        const drop = railCurrent * rail.resistance;
        maxVoltageDrop = Math.max(maxVoltageDrop, drop);
      }
    });

    return {
      totalPowerConsumption: totalPower,
      maxVoltageDrop,
      minVoltageMargin: Math.min(...this.pdn.rails.map(r => r.voltage > 0 ? r.voltage - maxVoltageDrop : Infinity)),
      powerEfficiency: 0.85, // Estimated
      thermalDissipation: totalPower * 0.15 // Assume 15% loss as heat
    };
  }

  private generateWaveforms() {
    return this.pdn.rails.map(rail => ({
      railId: rail.id,
      time: Array.from({ length: 1000 }, (_, i) => i * 1e-6), // 1μs intervals
      voltage: Array.from({ length: 1000 }, () => rail.voltage + (Math.random() - 0.5) * 0.1), // ±50mV noise
      current: Array.from({ length: 1000 }, () => Math.random() * rail.currentCapacity * 0.8)
    }));
  }

  addPowerRail(rail: PowerRail): void {
    this.pdn.rails.push(rail);
  }

  addPowerLoad(load: PowerLoad): void {
    this.pdn.loads.push(load);
  }

  getPDN(): PowerDistributionNetwork {
    return { ...this.pdn };
  }

  clear(): void {
    this.pdn = {
      rails: [],
      loads: [],
      connections: []
    };
  }
}

export const powerIntegrityAnalyzer = new PowerIntegrityAnalyzer();