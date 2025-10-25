import { Point, Wire, Net } from '../../types';

export interface TransmissionLine {
  id: string;
  netId: string;
  length: number; // meters
  width: number; // meters
  thickness: number; // meters
  dielectricHeight: number; // meters
  dielectricConstant: number;
  lossTangent: number;
  characteristicImpedance: number; // ohms
  propagationDelay: number; // seconds
  attenuation: number; // dB/m
}

export interface SignalIntegrityIssue {
  type: 'reflection' | 'crosstalk' | 'impedance_mismatch' | 'signal_loss' | 'ringing' | 'overshoot';
  severity: 'low' | 'medium' | 'high' | 'critical';
  location: Point;
  frequency?: number;
  description: string;
  suggestion: string;
  affectedNets: string[];
  metrics: {
    impedance?: number;
    reflectionCoefficient?: number;
    crosstalkRatio?: number;
    riseTime?: number;
    fallTime?: number;
  };
}

export interface SParameter {
  frequency: number;
  s11: number; // Reflection coefficient
  s21: number; // Transmission coefficient
  s12: number; // Reverse transmission
  s22: number; // Output reflection
}

export interface EyeDiagram {
  data: Array<{ time: number; voltage: number }>;
  eyeHeight: number;
  eyeWidth: number;
  jitter: number;
  bitErrorRate: number;
}

export class SignalIntegrityAnalyzer {
  private transmissionLines: Map<string, TransmissionLine> = new Map();
  private substrateProperties = {
    dielectricConstant: 4.5, // FR-4
    lossTangent: 0.02,
    copperThickness: 35e-6, // 35μm
    dielectricHeight: 0.2e-3 // 0.2mm
  };

  analyzeNet(net: Net, wires: Wire[]): SignalIntegrityIssue[] {
    const issues: SignalIntegrityIssue[] = [];

    // Calculate transmission line properties
    const tline = this.calculateTransmissionLine(net, wires);
    this.transmissionLines.set(net.id, tline);

    // Check impedance matching
    issues.push(...this.checkImpedanceMatching(tline, net));

    // Check signal loss
    issues.push(...this.checkSignalLoss(tline, net));

    // Check crosstalk
    issues.push(...this.checkCrosstalk(net, wires));

    // Check reflections
    issues.push(...this.checkReflections(tline, net));

    return issues;
  }

  private calculateTransmissionLine(net: Net, wires: Wire[]): TransmissionLine {
    // Simplified transmission line calculation for microstrip
    const width = 0.2e-3; // 0.2mm trace width (typical)
    const length = wires.reduce((total, wire) => {
      return total + this.calculateWireLength(wire);
    }, 0);

    // Microstrip impedance calculation (simplified)
    const ε_r = this.substrateProperties.dielectricConstant;
    const h = this.substrateProperties.dielectricHeight;
    const t = this.substrateProperties.copperThickness;
    const w = width;

    // Effective dielectric constant
    const ε_eff = (ε_r + 1) / 2 + (ε_r - 1) / 2 * (1 + 12 * h / w) ** -0.5;

    // Characteristic impedance (simplified formula)
    const Z0 = 60 / Math.sqrt(ε_eff) * Math.log(8 * h / w + w / (4 * h));

    // Propagation constant
    const β = 2 * Math.PI * 1e9 / (3e8 / Math.sqrt(ε_eff)); // At 1GHz
    const α = 0.5 * β * this.substrateProperties.lossTangent; // Loss

    return {
      id: `tline_${net.id}`,
      netId: net.id,
      length,
      width,
      thickness: t,
      dielectricHeight: h,
      dielectricConstant: ε_r,
      lossTangent: this.substrateProperties.lossTangent,
      characteristicImpedance: Z0,
      propagationDelay: length * Math.sqrt(ε_eff) / 3e8,
      attenuation: 20 * Math.log10(Math.exp(α * length)) // dB
    };
  }

  private calculateWireLength(wire: Wire): number {
    let length = 0;
    for (let i = 1; i < wire.points.length; i++) {
      const dx = wire.points[i].x - wire.points[i - 1].x;
      const dy = wire.points[i].y - wire.points[i - 1].y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length * 1e-3; // Convert to meters
  }

  private checkImpedanceMatching(tline: TransmissionLine, net: Net): SignalIntegrityIssue[] {
    const issues: SignalIntegrityIssue[] = [];

    // Check if impedance is within acceptable range (typically 50-75 ohms for digital)
    if (tline.characteristicImpedance < 45 || tline.characteristicImpedance > 80) {
      issues.push({
        type: 'impedance_mismatch',
        severity: 'high',
        location: { x: 0, y: 0 }, // Would need actual location
        description: `Characteristic impedance ${tline.characteristicImpedance.toFixed(1)}Ω is outside typical range (45-80Ω)`,
        suggestion: 'Adjust trace width or dielectric properties to achieve target impedance',
        affectedNets: [net.id],
        metrics: {
          impedance: tline.characteristicImpedance
        }
      });
    }

    return issues;
  }

  private checkSignalLoss(tline: TransmissionLine, net: Net): SignalIntegrityIssue[] {
    const issues: SignalIntegrityIssue[] = [];

    // Check attenuation
    if (tline.attenuation > 1.0) { // More than 1dB loss
      issues.push({
        type: 'signal_loss',
        severity: tline.attenuation > 3.0 ? 'high' : 'medium',
        location: { x: 0, y: 0 },
        description: `Signal attenuation of ${tline.attenuation.toFixed(2)}dB exceeds recommended limit`,
        suggestion: 'Use wider traces, shorter lengths, or lower loss materials',
        affectedNets: [net.id],
        metrics: {}
      });
    }

    return issues;
  }

  private checkCrosstalk(net: Net, allWires: Wire[]): SignalIntegrityIssue[] {
    const issues: SignalIntegrityIssue[] = [];

    // Find parallel wires within crosstalk distance
    const netWires = allWires.filter(wire => wire.netName === net.name);

    allWires.forEach(wire => {
      if (wire.netName !== net.name) {
        netWires.forEach(netWire => {
          const crosstalk = this.calculateCrosstalk(netWire, wire);
          if (crosstalk > 0.1) { // 10% crosstalk threshold
            issues.push({
              type: 'crosstalk',
              severity: crosstalk > 0.2 ? 'high' : 'medium',
              location: { x: 0, y: 0 },
              description: `High crosstalk ${crosstalk.toFixed(3)} between nets ${net.name} and ${wire.netName}`,
              suggestion: 'Increase spacing between traces or add ground planes',
              affectedNets: [net.id, wire.netName || 'unknown'],
              metrics: {
                crosstalkRatio: crosstalk
              }
            });
          }
        });
      }
    });

    return issues;
  }

  private calculateCrosstalk(wire1: Wire, wire2: Wire): number {
    // Simplified crosstalk calculation
    // In reality, this would involve complex electromagnetic field calculations
    const minDistance = this.calculateMinDistance(wire1, wire2);
    const length = Math.min(this.calculateWireLength(wire1), this.calculateWireLength(wire2));

    // Simplified formula: crosstalk ≈ (length / distance) * coupling_factor
    const couplingFactor = 0.01; // Typical microstrip coupling
    return (length / Math.max(minDistance, 0.001)) * couplingFactor;
  }

  private calculateMinDistance(wire1: Wire, wire2: Wire): number {
    let minDistance = Infinity;

    wire1.points.forEach(p1 => {
      wire2.points.forEach(p2 => {
        const distance = Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
        minDistance = Math.min(minDistance, distance);
      });
    });

    return minDistance * 1e-3; // Convert to meters
  }

  private checkReflections(tline: TransmissionLine, net: Net): SignalIntegrityIssue[] {
    const issues: SignalIntegrityIssue[] = [];

    // Check for impedance discontinuities
    // This is simplified - real SI analysis would check for vias, connectors, etc.

    // Calculate reflection coefficient for a typical 50Ω system
    const Z_system = 50; // Typical system impedance
    const Γ = (tline.characteristicImpedance - Z_system) / (tline.characteristicImpedance + Z_system);

    if (Math.abs(Γ) > 0.1) { // |Γ| > 0.1 indicates significant reflection
      issues.push({
        type: 'reflection',
        severity: Math.abs(Γ) > 0.2 ? 'high' : 'medium',
        location: { x: 0, y: 0 },
        description: `High reflection coefficient |Γ| = ${Math.abs(Γ).toFixed(3)} due to impedance mismatch`,
        suggestion: 'Add termination resistors or match impedances',
        affectedNets: [net.id],
        metrics: {
          reflectionCoefficient: Γ
        }
      });
    }

    return issues;
  }

  calculateSParameters(net: Net, frequencyRange: { start: number; end: number; points: number }): SParameter[] {
    const sParams: SParameter[] = [];
    const tline = this.transmissionLines.get(net.id);

    if (!tline) return sParams;

    const freqStep = (frequencyRange.end - frequencyRange.start) / (frequencyRange.points - 1);

    for (let i = 0; i < frequencyRange.points; i++) {
      const frequency = frequencyRange.start + i * freqStep;

      // Simplified S-parameter calculation
      const β = 2 * Math.PI * frequency / (3e8 / Math.sqrt(tline.dielectricConstant));
      const θ = β * tline.length;

      // For a lossless line (simplified)
      const s11 = 0; // No reflection at input (ideal case)
      const s21 = Math.cos(θ); // Transmission
      const s12 = Math.cos(θ); // Reverse transmission (symmetric)
      const s22 = 0; // No reflection at output (ideal case)

      sParams.push({
        frequency,
        s11,
        s21,
        s12,
        s22
      });
    }

    return sParams;
  }

  generateEyeDiagram(net: Net, bitRate: number, samples: number): EyeDiagram {
    // Simplified eye diagram generation
    const data: Array<{ time: number; voltage: number }> = [];
    const bitPeriod = 1 / bitRate;
    const samplePeriod = bitPeriod / samples;

    for (let i = 0; i < samples * 10; i++) { // 10 bits
      const time = i * samplePeriod;
      const bitValue = Math.random() > 0.5 ? 1 : 0;

      // Add rise/fall time effects and jitter
      const jitter = (Math.random() - 0.5) * bitPeriod * 0.1;
      const actualTime = time + jitter;

      let voltage = bitValue * 3.3; // 3.3V logic

      // Add signal integrity effects
      const tline = this.transmissionLines.get(net.id);
      if (tline) {
        // Add attenuation
        voltage *= Math.exp(-tline.attenuation / 20); // Convert dB to linear

        // Add reflections (simplified)
        const reflectionCoeff = 0.1; // 10% reflection
        voltage += reflectionCoeff * Math.sin(2 * Math.PI * actualTime / bitPeriod);
      }

      // Add noise
      voltage += (Math.random() - 0.5) * 0.1;

      data.push({ time: actualTime, voltage });
    }

    // Calculate eye diagram metrics
    const eyeHeight = this.calculateEyeHeight(data, bitPeriod);
    const eyeWidth = this.calculateEyeWidth(data, bitPeriod);
    const jitter = this.calculateJitter(data, bitPeriod);
    const ber = this.estimateBER(data, bitPeriod);

    return {
      data,
      eyeHeight,
      eyeWidth,
      jitter,
      bitErrorRate: ber
    };
  }

  private calculateEyeHeight(data: Array<{ time: number; voltage: number }>, bitPeriod: number): number {
    // Simplified eye height calculation
    const voltages = data.map(d => d.voltage);
    return Math.max(...voltages) - Math.min(...voltages);
  }

  private calculateEyeWidth(data: Array<{ time: number; voltage: number }>, bitPeriod: number): number {
    // Simplified eye width calculation
    return bitPeriod * 0.8; // Assume 80% of bit period is open
  }

  private calculateJitter(data: Array<{ time: number; voltage: number }>, bitPeriod: number): number {
    // Simplified jitter calculation
    const transitions: number[] = [];

    for (let i = 1; i < data.length; i++) {
      const prevBit = Math.round(data[i - 1].voltage / 3.3);
      const currBit = Math.round(data[i].voltage / 3.3);
      if (prevBit !== currBit) {
        transitions.push(data[i].time);
      }
    }

    if (transitions.length < 2) return 0;

    const expectedTransitions = transitions.map((_, i) => i * bitPeriod);
    const jitterValues = transitions.map((t, i) => Math.abs(t - expectedTransitions[i]));

    return jitterValues.reduce((a, b) => a + b, 0) / jitterValues.length;
  }

  private estimateBER(data: Array<{ time: number; voltage: number }>, bitPeriod: number): number {
    // Simplified BER estimation
    // In reality, this would require statistical analysis
    const eyeHeight = this.calculateEyeHeight(data, bitPeriod);
    const noise = 0.1; // Estimated noise

    // BER ≈ erfc(eye_height / (2 * sqrt(2) * noise))
    const snr = eyeHeight / (2 * Math.sqrt(2) * noise);
    return 0.5 * (1 - Math.erf(snr / Math.sqrt(2)));
  }

  getTransmissionLine(netId: string): TransmissionLine | undefined {
    return this.transmissionLines.get(netId);
  }

  getAllTransmissionLines(): TransmissionLine[] {
    return Array.from(this.transmissionLines.values());
  }

  updateSubstrateProperties(properties: Partial<typeof this.substrateProperties>): void {
    Object.assign(this.substrateProperties, properties);
  }
}

export const signalIntegrityAnalyzer = new SignalIntegrityAnalyzer();