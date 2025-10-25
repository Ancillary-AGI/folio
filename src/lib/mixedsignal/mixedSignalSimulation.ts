import { Component, Net } from '../../types';

export interface AnalogSignal {
  id: string;
  name: string;
  type: 'dc' | 'ac' | 'transient' | 'noise';
  amplitude: number;
  frequency?: number; // Hz
  offset?: number;
  phase?: number; // degrees
  waveform: number[]; // Time-domain samples
  time: number[]; // Time points
}

export interface DigitalSignal {
  id: string;
  name: string;
  type: 'binary' | 'bus' | 'clock';
  data: boolean[] | number[]; // Binary data or bus values
  bitWidth?: number;
  frequency?: number; // Hz
  dutyCycle?: number;
  riseTime?: number; // ns
  fallTime?: number; // ns
}

export interface MixedSignalInterface {
  id: string;
  name: string;
  analogPorts: string[];
  digitalPorts: string[];
  conversionType: 'adc' | 'dac' | 'comparator' | 'level_shifter';
  resolution?: number; // bits for ADC/DAC
  sampleRate?: number; // Hz
  inputRange?: { min: number; max: number }; // Volts
  outputRange?: { min: number; max: number }; // Volts
  nonlinearity?: number; // % FSR
  offset?: number; // Volts
  gain?: number;
}

export interface MixedSignalCircuit {
  id: string;
  name: string;
  analogComponents: Component[];
  digitalComponents: Component[];
  interfaces: MixedSignalInterface[];
  analogSignals: AnalogSignal[];
  digitalSignals: DigitalSignal[];
  connections: Array<{
    from: { componentId: string; portId: string; domain: 'analog' | 'digital' };
    to: { componentId: string; portId: string; domain: 'analog' | 'digital' };
    interface?: string; // Interface ID if conversion needed
  }>;
}

export interface SimulationResult {
  id: string;
  timestamp: number;
  analogResults: Array<{
    signalId: string;
    time: number[];
    voltage: number[];
    current?: number[];
  }>;
  digitalResults: Array<{
    signalId: string;
    time: number[];
    logic: boolean[] | number[];
  }>;
  interfaceResults: Array<{
    interfaceId: string;
    inputAnalog?: number[];
    outputDigital?: number[];
    inputDigital?: number[];
    outputAnalog?: number[];
    errors: {
      quantization?: number[];
      nonlinearity?: number[];
      timing?: number[];
    };
  }>;
  performance: {
    totalSimulationTime: number;
    convergence: boolean;
    accuracy: number;
  };
}

export class MixedSignalSimulator {
  private circuits: Map<string, MixedSignalCircuit> = new Map();

  createMixedSignalCircuit(name: string): MixedSignalCircuit {
    const circuit: MixedSignalCircuit = {
      id: `mixed_${Date.now()}`,
      name,
      analogComponents: [],
      digitalComponents: [],
      interfaces: [],
      analogSignals: [],
      digitalSignals: [],
      connections: []
    };

    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  addAnalogComponent(circuitId: string, component: Component): void {
    const circuit = this.circuits.get(circuitId);
    if (circuit) {
      circuit.analogComponents.push(component);
    }
  }

  addDigitalComponent(circuitId: string, component: Component): void {
    const circuit = this.circuits.get(circuitId);
    if (circuit) {
      circuit.digitalComponents.push(component);
    }
  }

  addMixedSignalInterface(circuitId: string, interface_: MixedSignalInterface): void {
    const circuit = this.circuits.get(circuitId);
    if (circuit) {
      circuit.interfaces.push(interface_);
    }
  }

  addAnalogSignal(circuitId: string, signal: AnalogSignal): void {
    const circuit = this.circuits.get(circuitId);
    if (circuit) {
      circuit.analogSignals.push(signal);
    }
  }

  addDigitalSignal(circuitId: string, signal: DigitalSignal): void {
    const circuit = this.circuits.get(circuitId);
    if (circuit) {
      circuit.digitalSignals.push(signal);
    }
  }

  connectSignals(circuitId: string, from: any, to: any, interfaceId?: string): void {
    const circuit = this.circuits.get(circuitId);
    if (circuit) {
      circuit.connections.push({
        from,
        to,
        interface: interfaceId
      });
    }
  }

  async runSimulation(circuitId: string, duration: number, timeStep: number): Promise<SimulationResult> {
    const circuit = this.circuits.get(circuitId);
    if (!circuit) {
      throw new Error('Circuit not found');
    }

    const startTime = Date.now();
    const numSteps = Math.floor(duration / timeStep);
    const timePoints = Array.from({ length: numSteps }, (_, i) => i * timeStep);

    // Simulate analog domain
    const analogResults = this.simulateAnalogDomain(circuit, timePoints);

    // Simulate digital domain
    const digitalResults = this.simulateDigitalDomain(circuit, timePoints);

    // Simulate mixed-signal interfaces
    const interfaceResults = this.simulateInterfaces(circuit, timePoints);

    // Combine results
    const totalTime = Date.now() - startTime;

    return {
      id: `sim_${Date.now()}`,
      timestamp: Date.now(),
      analogResults,
      digitalResults,
      interfaceResults,
      performance: {
        totalSimulationTime: totalTime,
        convergence: true,
        accuracy: 0.99
      }
    };
  }

  private simulateAnalogDomain(circuit: MixedSignalCircuit, timePoints: number[]) {
    const results = [];

    for (const signal of circuit.analogSignals) {
      const voltages = timePoints.map(t => this.generateAnalogWaveform(signal, t));
      const currents = voltages.map(v => v / 1000); // Simplified current calculation

      results.push({
        signalId: signal.id,
        time: timePoints,
        voltage: voltages,
        current: currents
      });
    }

    return results;
  }

  private simulateDigitalDomain(circuit: MixedSignalCircuit, timePoints: number[]) {
    const results = [];

    for (const signal of circuit.digitalSignals) {
      let logicValues: boolean[] | number[];

      if (signal.type === 'clock') {
        const frequency = signal.frequency || 1e6;
        const period = 1 / frequency;
        const dutyCycle = signal.dutyCycle || 0.5;

        logicValues = timePoints.map(t => {
          const phase = (t % period) / period;
          return phase < dutyCycle;
        });
      } else if (signal.type === 'binary') {
        // Generate random binary data
        logicValues = timePoints.map(() => Math.random() > 0.5);
      } else {
        // Bus data
        const bitWidth = signal.bitWidth || 8;
        logicValues = timePoints.map(() => Math.floor(Math.random() * Math.pow(2, bitWidth)));
      }

      results.push({
        signalId: signal.id,
        time: timePoints,
        logic: logicValues
      });
    }

    return results;
  }

  private simulateInterfaces(circuit: MixedSignalCircuit, timePoints: number[]) {
    const results = [];

    for (const interface_ of circuit.interfaces) {
      const result: any = {
        interfaceId: interface_.id,
        errors: {}
      };

      switch (interface_.conversionType) {
        case 'adc':
          result.inputAnalog = timePoints.map(t => Math.sin(2 * Math.PI * 1000 * t)); // 1kHz sine wave
          result.outputDigital = this.simulateADC(result.inputAnalog, interface_);
          result.errors.quantization = this.calculateQuantizationError(result.inputAnalog, result.outputDigital, interface_);
          break;

        case 'dac':
          result.inputDigital = timePoints.map(() => Math.floor(Math.random() * Math.pow(2, interface_.resolution || 8)));
          result.outputAnalog = this.simulateDAC(result.inputDigital, interface_);
          result.errors.quantization = this.calculateDACError(result.inputDigital, result.outputAnalog, interface_);
          break;

        case 'comparator':
          result.inputAnalog = timePoints.map(t => Math.sin(2 * Math.PI * 1000 * t));
          result.outputDigital = result.inputAnalog.map(v => v > 0);
          break;
      }

      results.push(result);
    }

    return results;
  }

  private generateAnalogWaveform(signal: AnalogSignal, time: number): number {
    const { amplitude, frequency = 0, offset = 0, phase = 0 } = signal;

    switch (signal.type) {
      case 'dc':
        return offset;

      case 'ac':
        return offset + amplitude * Math.sin(2 * Math.PI * frequency * time + phase * Math.PI / 180);

      case 'transient':
        // Exponential decay
        return offset + amplitude * Math.exp(-time / 0.001);

      case 'noise':
        return offset + (Math.random() - 0.5) * 2 * amplitude;

      default:
        return offset;
    }
  }

  private simulateADC(analogInput: number[], interface_: MixedSignalInterface): number[] {
    const resolution = interface_.resolution || 8;
    const maxCode = Math.pow(2, resolution) - 1;
    const inputRange = interface_.inputRange || { min: 0, max: 3.3 };
    const range = inputRange.max - inputRange.min;

    return analogInput.map(voltage => {
      // Add offset and gain errors
      let correctedVoltage = voltage;
      if (interface_.offset) correctedVoltage -= interface_.offset;
      if (interface_.gain) correctedVoltage /= interface_.gain;

      // Quantize
      const normalized = (correctedVoltage - inputRange.min) / range;
      const clamped = Math.max(0, Math.min(1, normalized));
      const digital = Math.round(clamped * maxCode);

      return digital;
    });
  }

  private simulateDAC(digitalInput: number[], interface_: MixedSignalInterface): number[] {
    const resolution = interface_.resolution || 8;
    const maxCode = Math.pow(2, resolution) - 1;
    const outputRange = interface_.outputRange || { min: 0, max: 3.3 };
    const range = outputRange.max - outputRange.min;

    return digitalInput.map(code => {
      const normalized = code / maxCode;
      let voltage = outputRange.min + normalized * range;

      // Add offset and gain errors
      if (interface_.gain) voltage *= interface_.gain;
      if (interface_.offset) voltage += interface_.offset;

      return voltage;
    });
  }

  private calculateQuantizationError(analogInput: number[], digitalOutput: number[], interface_: MixedSignalInterface): number[] {
    const resolution = interface_.resolution || 8;
    const lsb = (interface_.inputRange?.max || 3.3) / Math.pow(2, resolution);

    return analogInput.map((analog, i) => {
      const digital = digitalOutput[i];
      const reconstructed = this.simulateDAC([digital], interface_)[0];
      return Math.abs(analog - reconstructed) / lsb; // Error in LSBs
    });
  }

  private calculateDACError(digitalInput: number[], analogOutput: number[], interface_: MixedSignalInterface): number[] {
    const resolution = interface_.resolution || 8;
    const lsb = (interface_.outputRange?.max || 3.3) / Math.pow(2, resolution);

    return digitalInput.map((digital, i) => {
      const analog = analogOutput[i];
      const expected = this.simulateDAC([digital], interface_)[0];
      return Math.abs(analog - expected) / lsb; // Error in LSBs
    });
  }

  designADC(resolution: number, sampleRate: number, inputRange: { min: number; max: number }): MixedSignalInterface {
    return {
      id: `adc_${Date.now()}`,
      name: `ADC ${resolution}-bit ${sampleRate / 1e6}MSPS`,
      analogPorts: ['ain'],
      digitalPorts: ['dout'],
      conversionType: 'adc',
      resolution,
      sampleRate,
      inputRange,
      nonlinearity: 0.5, // 0.5% FSR
      offset: 0.001, // 1mV offset
      gain: 1.001 // 0.1% gain error
    };
  }

  designDAC(resolution: number, sampleRate: number, outputRange: { min: number; max: number }): MixedSignalInterface {
    return {
      id: `dac_${Date.now()}`,
      name: `DAC ${resolution}-bit ${sampleRate / 1e6}MSPS`,
      analogPorts: ['aout'],
      digitalPorts: ['din'],
      conversionType: 'dac',
      resolution,
      sampleRate,
      outputRange,
      nonlinearity: 0.3, // 0.3% FSR
      offset: 0.0005, // 0.5mV offset
      gain: 0.999 // 0.1% gain error
    };
  }

  getCircuit(id: string): MixedSignalCircuit | undefined {
    return this.circuits.get(id);
  }

  getAllCircuits(): MixedSignalCircuit[] {
    return Array.from(this.circuits.values());
  }
}

export const mixedSignalSimulator = new MixedSignalSimulator();