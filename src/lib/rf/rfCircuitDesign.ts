
export interface RFCircuitElement {
  id: string;
  type: 'resistor' | 'capacitor' | 'inductor' | 'transmission_line' | 'amplifier' | 'mixer' | 'filter' | 'oscillator';
  value: number; // Resistance (Ω), capacitance (F), inductance (H), etc.
  frequency: number; // Center frequency for frequency-dependent elements
  qualityFactor?: number; // Q factor
  parameters: Record<string, number>; // Additional parameters
}

export interface ScatteringParameters {
  frequency: number;
  s11: Complex; // Reflection coefficient
  s12: Complex; // Reverse transmission
  s21: Complex; // Forward transmission
  s22: Complex; // Output reflection
}

export interface Complex {
  real: number;
  imag: number;
}

export interface RFCircuit {
  id: string;
  name: string;
  elements: RFCircuitElement[];
  connections: Array<{
    from: string;
    to: string;
    type: 'series' | 'parallel' | 'ground';
  }>;
  ports: Array<{
    id: string;
    impedance: number; // ohms
    type: 'input' | 'output' | 'bidirectional';
  }>;
}

export interface RFPerformanceMetrics {
  gain: number; // dB
  noiseFigure: number; // dB
  inputReturnLoss: number; // dB
  outputReturnLoss: number; // dB
  isolation: number; // dB
  bandwidth: number; // Hz
  centerFrequency: number; // Hz
  stabilityFactor: number;
  thirdOrderIntercept: number; // dBm
}

export class RFCircuitDesigner {
  private circuits: Map<string, RFCircuit> = new Map();

  designLowPassFilter(cutoffFrequency: number, order: number, impedance: number = 50): RFCircuit {
    const circuit: RFCircuit = {
      id: `lpf_${Date.now()}`,
      name: `Low Pass Filter ${cutoffFrequency / 1e6}MHz`,
      elements: [],
      connections: [],
      ports: [
        { id: 'input', impedance, type: 'input' },
        { id: 'output', impedance, type: 'output' }
      ]
    };

    // Butterworth filter design
    const components = this.calculateButterworthComponents(cutoffFrequency, order, impedance);

    // Add series inductors and shunt capacitors alternately
    for (let i = 0; i < order; i++) {
      if (i % 2 === 0) {
        // Series inductor
        const inductor: RFCircuitElement = {
          id: `L${i + 1}`,
          type: 'inductor',
          value: components.inductors[i],
          frequency: cutoffFrequency,
          qualityFactor: 100,
          parameters: {}
        };
        circuit.elements.push(inductor);
      } else {
        // Shunt capacitor
        const capacitor: RFCircuitElement = {
          id: `C${i + 1}`,
          type: 'capacitor',
          value: components.capacitors[i],
          frequency: cutoffFrequency,
          qualityFactor: 200,
          parameters: {}
        };
        circuit.elements.push(capacitor);
      }
    }

    // Create connections
    this.createFilterConnections(circuit);

    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designHighPassFilter(cutoffFrequency: number, order: number, impedance: number = 50): RFCircuit {
    const circuit: RFCircuit = {
      id: `hpf_${Date.now()}`,
      name: `High Pass Filter ${cutoffFrequency / 1e6}MHz`,
      elements: [],
      connections: [],
      ports: [
        { id: 'input', impedance, type: 'input' },
        { id: 'output', impedance, type: 'output' }
      ]
    };

    // Transform low-pass to high-pass
    const lpComponents = this.calculateButterworthComponents(cutoffFrequency, order, impedance);

    for (let i = 0; i < order; i++) {
      if (i % 2 === 0) {
        // Series capacitor (from inductor)
        const capacitor: RFCircuitElement = {
          id: `C${i + 1}`,
          type: 'capacitor',
          value: 1 / (lpComponents.inductors[i] * (2 * Math.PI * cutoffFrequency) ** 2),
          frequency: cutoffFrequency,
          qualityFactor: 200,
          parameters: {}
        };
        circuit.elements.push(capacitor);
      } else {
        // Shunt inductor (from capacitor)
        const inductor: RFCircuitElement = {
          id: `L${i + 1}`,
          type: 'inductor',
          value: 1 / (lpComponents.capacitors[i] * (2 * Math.PI * cutoffFrequency) ** 2),
          frequency: cutoffFrequency,
          qualityFactor: 100,
          parameters: {}
        };
        circuit.elements.push(inductor);
      }
    }

    this.createFilterConnections(circuit);
    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designBandPassFilter(centerFrequency: number, bandwidth: number, order: number, impedance: number = 50): RFCircuit {
    const circuit: RFCircuit = {
      id: `bpf_${Date.now()}`,
      name: `Band Pass Filter ${centerFrequency / 1e6}MHz`,
      elements: [],
      connections: [],
      ports: [
        { id: 'input', impedance, type: 'input' },
        { id: 'output', impedance, type: 'output' }
      ]
    };

    // Use coupled resonator approach
    const resonators = this.calculateBandpassComponents(centerFrequency, bandwidth, order);

    resonators.forEach((resonator, index) => {
      // Series resonator
      const seriesL: RFCircuitElement = {
        id: `Ls${index + 1}`,
        type: 'inductor',
        value: resonator.L,
        frequency: centerFrequency,
        qualityFactor: 150,
        parameters: {}
      };

      const seriesC: RFCircuitElement = {
        id: `Cs${index + 1}`,
        type: 'capacitor',
        value: resonator.C,
        frequency: centerFrequency,
        qualityFactor: 200,
        parameters: {}
      };

      circuit.elements.push(seriesL, seriesC);

      // Coupling capacitors
      if (index < resonators.length - 1) {
        const couplingC: RFCircuitElement = {
          id: `Cc${index + 1}`,
          type: 'capacitor',
          value: resonator.Cc || resonator.C * 0.1,
          frequency: centerFrequency,
          qualityFactor: 200,
          parameters: {}
        };
        circuit.elements.push(couplingC);
      }
    });

    this.createBandpassConnections(circuit);
    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designAmplifier(gain: number, frequency: number, noiseFigure: number = 3): RFCircuit {
    const circuit: RFCircuit = {
      id: `amp_${Date.now()}`,
      name: `RF Amplifier ${frequency / 1e6}MHz`,
      elements: [],
      connections: [],
      ports: [
        { id: 'input', impedance: 50, type: 'input' },
        { id: 'output', impedance: 50, type: 'output' },
        { id: 'vcc', impedance: 0, type: 'bidirectional' },
        { id: 'gnd', impedance: 0, type: 'bidirectional' }
      ]
    };

    // Transistor amplifier (simplified model)
    const transistor: RFCircuitElement = {
      id: 'Q1',
      type: 'amplifier',
      value: gain, // Gain in dB
      frequency,
      qualityFactor: 10, // Power gain
      parameters: {
        noiseFigure,
        inputReturnLoss: 15, // dB
        outputReturnLoss: 15, // dB
        stabilityFactor: 1.2,
        thirdOrderIntercept: 25 // dBm
      }
    };

    // Bias network
    const biasResistor: RFCircuitElement = {
      id: 'R_bias',
      type: 'resistor',
      value: 1000, // 1kΩ
      frequency,
      parameters: {}
    };

    const biasCapacitor: RFCircuitElement = {
      id: 'C_bias',
      type: 'capacitor',
      value: 100e-9, // 100nF
      frequency,
      parameters: {}
    };

    // Matching networks
    const inputMatch: RFCircuitElement = {
      id: 'input_match',
      type: 'transmission_line',
      value: 50, // 50Ω line
      frequency,
      parameters: {
        length: 0.25, // λ/4
        impedance: 25 // 25Ω for matching
      }
    };

    const outputMatch: RFCircuitElement = {
      id: 'output_match',
      type: 'transmission_line',
      value: 50,
      frequency,
      parameters: {
        length: 0.25,
        impedance: 75 // 75Ω for matching
      }
    };

    circuit.elements.push(transistor, biasResistor, biasCapacitor, inputMatch, outputMatch);
    this.createAmplifierConnections(circuit);

    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designMixer(loFrequency: number, rfFrequency: number, ifFrequency: number): RFCircuit {
    const circuit: RFCircuit = {
      id: `mixer_${Date.now()}`,
      name: `RF Mixer ${rfFrequency / 1e6}MHz`,
      elements: [],
      connections: [],
      ports: [
        { id: 'rf', impedance: 50, type: 'input' },
        { id: 'lo', impedance: 50, type: 'input' },
        { id: 'if', impedance: 50, type: 'output' }
      ]
    };

    // Diode ring mixer (simplified)
    const diode1: RFCircuitElement = {
      id: 'D1',
      type: 'mixer',
      value: 0.3, // Forward voltage
      frequency: rfFrequency,
      parameters: {
        conversionLoss: 6, // dB
        isolation: 25, // dB
        loPower: 10 // dBm
      }
    };

    const diode2: RFCircuitElement = {
      id: 'D2',
      type: 'mixer',
      value: 0.3,
      frequency: rfFrequency,
      parameters: {
        conversionLoss: 6,
        isolation: 25,
        loPower: 10
      }
    };

    // Balun transformers
    const rfBalun: RFCircuitElement = {
      id: 'rf_balun',
      type: 'transmission_line',
      value: 50,
      frequency: rfFrequency,
      parameters: {
        turnsRatio: 1,
        impedance: 50
      }
    };

    const loBalun: RFCircuitElement = {
      id: 'lo_balun',
      type: 'transmission_line',
      value: 50,
      frequency: loFrequency,
      parameters: {
        turnsRatio: 1,
        impedance: 50
      }
    };

    // IF filter
    const ifFilter: RFCircuitElement = {
      id: 'if_filter',
      type: 'filter',
      value: ifFrequency,
      frequency: ifFrequency,
      parameters: {
        bandwidth: 1e6, // 1MHz
        rejection: 40 // dB
      }
    };

    circuit.elements.push(diode1, diode2, rfBalun, loBalun, ifFilter);
    this.createMixerConnections(circuit);

    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designOscillator(frequency: number, outputPower: number = 10): RFCircuit {
    const circuit: RFCircuit = {
      id: `osc_${Date.now()}`,
      name: `RF Oscillator ${frequency / 1e6}MHz`,
      elements: [],
      connections: [],
      ports: [
        { id: 'output', impedance: 50, type: 'output' },
        { id: 'vcc', impedance: 0, type: 'bidirectional' },
        { id: 'gnd', impedance: 0, type: 'bidirectional' }
      ]
    };

    // Oscillator transistor
    const oscillator: RFCircuitElement = {
      id: 'Q1',
      type: 'oscillator',
      value: outputPower, // Output power in dBm
      frequency,
      parameters: {
        phaseNoise: -100, // dBc/Hz
        tuningRange: frequency * 0.1, // 10% tuning range
        harmonicSuppression: 30 // dB
      }
    };

    // Resonator
    const resonator: RFCircuitElement = {
      id: 'resonator',
      type: 'transmission_line',
      value: 50,
      frequency,
      parameters: {
        length: 0.25, // λ/4 resonator
        qFactor: 100
      }
    };

    // Varactor for tuning
    const varactor: RFCircuitElement = {
      id: 'C_tune',
      type: 'capacitor',
      value: 1e-12, // 1pF
      frequency,
      parameters: {
        tuningVoltage: 20, // V
        capacitanceRange: 0.5e-12 // 0.5pF
      }
    };

    // Buffer amplifier
    const buffer: RFCircuitElement = {
      id: 'buffer',
      type: 'amplifier',
      value: 10, // 10dB gain
      frequency,
      parameters: {
        isolation: 20 // dB
      }
    };

    circuit.elements.push(oscillator, resonator, varactor, buffer);
    this.createOscillatorConnections(circuit);

    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  private calculateButterworthComponents(fc: number, n: number, Z0: number) {
    const inductors: number[] = [];
    const capacitors: number[] = [];

    // Butterworth normalized component values
    const g = [1, 1.4142, 1.8478, 1.9318, 2.0]; // For n=5, extend as needed

    for (let k = 1; k <= n; k++) {
      if (k % 2 === 1) {
        // Series inductor
        const L = (Z0 / (2 * Math.PI * fc)) * g[k - 1];
        inductors.push(L);
      } else {
        // Shunt capacitor
        const C = (1 / (2 * Math.PI * fc * Z0)) * g[k - 1];
        capacitors.push(C);
      }
    }

    return { inductors, capacitors };
  }

  private calculateBandpassComponents(fc: number, bw: number, n: number) {
    const resonators = [];
    const w0 = 2 * Math.PI * fc;
    const delta = bw / fc; // Fractional bandwidth

    for (let k = 1; k <= n; k++) {
      const L = 1 / (w0 * w0 * 1e-12); // 1pF equivalent
      const C = 1e-12; // 1pF
      const Cc = C * delta / 2; // Coupling capacitor

      resonators.push({ L, C, Cc });
    }

    return resonators;
  }

  private createFilterConnections(circuit: RFCircuit): void {
    // Connect elements in series from input to output
    circuit.connections.push(
      { from: 'input', to: circuit.elements[0].id, type: 'series' }
    );

    for (let i = 0; i < circuit.elements.length - 1; i++) {
      circuit.connections.push({
        from: circuit.elements[i].id,
        to: circuit.elements[i + 1].id,
        type: 'series'
      });
    }

    circuit.connections.push({
      from: circuit.elements[circuit.elements.length - 1].id,
      to: 'output',
      type: 'series'
    });

    // Add ground connections for shunt elements
    circuit.elements.forEach((element, index) => {
      if (element.type === 'capacitor' && index % 2 === 1) {
        circuit.connections.push({
          from: element.id,
          to: 'gnd',
          type: 'ground'
        });
      }
    });
  }

  private createBandpassConnections(circuit: RFCircuit): void {
    // Simplified bandpass connections
    circuit.connections.push(
      { from: 'input', to: 'Ls1', type: 'series' },
      { from: 'Ls1', to: 'Cs1', type: 'parallel' },
      { from: 'Cs1', to: 'Cc1', type: 'series' },
      { from: 'Cc1', to: 'Ls2', type: 'series' },
      { from: 'Ls2', to: 'Cs2', type: 'parallel' },
      { from: 'Cs2', to: 'output', type: 'series' }
    );
  }

  private createAmplifierConnections(circuit: RFCircuit): void {
    circuit.connections.push(
      { from: 'input', to: 'input_match', type: 'series' },
      { from: 'input_match', to: 'Q1', type: 'series' },
      { from: 'Q1', to: 'output_match', type: 'series' },
      { from: 'output_match', to: 'output', type: 'series' },
      { from: 'vcc', to: 'R_bias', type: 'series' },
      { from: 'R_bias', to: 'Q1', type: 'series' },
      { from: 'Q1', to: 'gnd', type: 'ground' },
      { from: 'C_bias', to: 'gnd', type: 'ground' }
    );
  }

  private createMixerConnections(circuit: RFCircuit): void {
    circuit.connections.push(
      { from: 'rf', to: 'rf_balun', type: 'series' },
      { from: 'lo', to: 'lo_balun', type: 'series' },
      { from: 'rf_balun', to: 'D1', type: 'series' },
      { from: 'lo_balun', to: 'D1', type: 'series' },
      { from: 'D1', to: 'D2', type: 'series' },
      { from: 'D2', to: 'if_filter', type: 'series' },
      { from: 'if_filter', to: 'if', type: 'series' }
    );
  }

  private createOscillatorConnections(circuit: RFCircuit): void {
    circuit.connections.push(
      { from: 'Q1', to: 'resonator', type: 'series' },
      { from: 'resonator', to: 'Q1', type: 'series' }, // Feedback
      { from: 'Q1', to: 'buffer', type: 'series' },
      { from: 'buffer', to: 'output', type: 'series' },
      { from: 'C_tune', to: 'resonator', type: 'parallel' },
      { from: 'vcc', to: 'Q1', type: 'series' },
      { from: 'Q1', to: 'gnd', type: 'ground' }
    );
  }

  calculateSParameters(circuit: RFCircuit, frequency: number): ScatteringParameters {
    // Simplified S-parameter calculation
    const s11 = { real: -0.1, imag: -0.05 }; // Input reflection
    const s12 = { real: 0.01, imag: 0.005 }; // Reverse transmission
    const s21 = { real: 0.9, imag: 0.1 }; // Forward transmission
    const s22 = { real: -0.1, imag: -0.05 }; // Output reflection

    return {
      frequency,
      s11,
      s12,
      s21,
      s22
    };
  }

  calculatePerformanceMetrics(circuit: RFCircuit): RFPerformanceMetrics {
    // Simplified performance calculation
    const metrics: RFPerformanceMetrics = {
      gain: 10, // dB
      noiseFigure: 3, // dB
      inputReturnLoss: 15, // dB
      outputReturnLoss: 15, // dB
      isolation: 25, // dB
      bandwidth: 100e6, // Hz
      centerFrequency: 1e9, // Hz
      stabilityFactor: 1.2,
      thirdOrderIntercept: 25 // dBm
    };

    // Adjust based on circuit type
    switch (circuit.elements[0]?.type) {
      case 'amplifier':
        metrics.gain = circuit.elements[0].value;
        break;
      case 'filter':
        metrics.bandwidth = circuit.elements[0].parameters?.bandwidth || 100e6;
        break;
      case 'mixer':
        metrics.gain = -6; // Conversion loss
        break;
    }

    return metrics;
  }

  getCircuit(id: string): RFCircuit | undefined {
    return this.circuits.get(id);
  }

  getAllCircuits(): RFCircuit[] {
    return Array.from(this.circuits.values());
  }
}

export const rfCircuitDesigner = new RFCircuitDesigner();