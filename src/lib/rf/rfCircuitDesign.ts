export interface RFCircuitElement {
  id: string;
  type:
    | 'resistor'
    | 'capacitor'
    | 'inductor'
    | 'transmission_line'
    | 'amplifier'
    | 'mixer'
    | 'filter'
    | 'oscillator';
  value: number; // Resistance (Ω), capacitance (F), inductance (H), characteristic impedance (Ω)…
  frequency: number; // Design frequency of the element
  qualityFactor?: number; // Unloaded Q; loss is included when specified
  parameters: Record<string, number>;
  /**
   * Ladder position. Series elements carry the signal between nodes; shunt
   * elements return the current node to ground.
   */
  role?: 'series' | 'shunt';
}

export interface Complex {
  real: number;
  imag: number;
}

export interface ScatteringParameters {
  frequency: number;
  s11: Complex; // Input reflection
  s12: Complex; // Reverse transmission
  s21: Complex; // Forward transmission
  s22: Complex; // Output reflection
}

export interface RFDesignSpec {
  kind: 'lowpass' | 'highpass' | 'bandpass' | 'amplifier' | 'mixer' | 'oscillator';
  centerFrequency: number;
  bandwidth?: number;
  order?: number;
  impedance: number;
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
  design?: RFDesignSpec;
}

export interface RFPerformanceMetrics {
  gain: number; // dB
  noiseFigure: number; // dB (NaN when the model does not define it)
  inputReturnLoss: number; // dB
  outputReturnLoss: number; // dB
  isolation: number; // dB
  bandwidth: number; // Hz (Infinity for a high-pass passband)
  centerFrequency: number; // Hz
  stabilityFactor: number; // Rollett K; NaN when undefined
  thirdOrderIntercept: number; // dBm; NaN when not characterized
}

export interface AmplifierTemplateOptions {
  inputReturnLossDb?: number;
  outputReturnLossDb?: number;
  isolationDb?: number;
  bandwidthHz?: number;
  outputThirdOrderInterceptDbm?: number;
}

export interface MixerTemplateOptions {
  conversionLossDb?: number;
  isolationDb?: number;
  noiseFigureDb?: number;
  inputReturnLossDb?: number;
  outputReturnLossDb?: number;
  ifBandwidthHz?: number;
  inputThirdOrderInterceptDbm?: number;
}

interface ComplexNumber {
  re: number;
  im: number;
}

interface ABCD {
  a: ComplexNumber;
  b: ComplexNumber;
  c: ComplexNumber;
  d: ComplexNumber;
}

const SPEED_OF_LIGHT = 299792458;

// Butterworth g-values for the doubly-terminated low-pass prototype.
const BUTTERWORTH_G: ReadonlyArray<ReadonlyArray<number>> = [
  [],
  [2.0],
  [1.4142, 1.4142],
  [1.0, 2.0, 1.0],
  [0.7654, 1.8478, 1.8478, 0.7654],
  [0.618, 1.618, 2.0, 1.618, 0.618],
  [0.5176, 1.4142, 1.9319, 1.9319, 1.4142, 0.5176],
  [0.445, 1.247, 1.8019, 2.0, 1.8019, 1.247, 0.445],
  [0.3902, 1.1111, 1.6629, 1.9616, 1.9616, 1.6629, 1.1111, 0.3902],
];

const MAX_FILTER_ORDER = BUTTERWORTH_G.length - 1;

const c = (re = 0, im = 0): ComplexNumber => ({ re, im });
const cAdd = (x: ComplexNumber, y: ComplexNumber): ComplexNumber => ({
  re: x.re + y.re,
  im: x.im + y.im,
});
const cSub = (x: ComplexNumber, y: ComplexNumber): ComplexNumber => ({
  re: x.re - y.re,
  im: x.im - y.im,
});
const cMul = (x: ComplexNumber, y: ComplexNumber): ComplexNumber => ({
  re: x.re * y.re - x.im * y.im,
  im: x.re * y.im + x.im * y.re,
});
const cScale = (x: ComplexNumber, factor: number): ComplexNumber => ({
  re: x.re * factor,
  im: x.im * factor,
});
const cDiv = (x: ComplexNumber, y: ComplexNumber): ComplexNumber => {
  const denominator = y.re * y.re + y.im * y.im;
  if (denominator === 0) throw new Error('Complex division by zero.');
  return {
    re: (x.re * y.re + x.im * y.im) / denominator,
    im: (x.im * y.re - x.re * y.im) / denominator,
  };
};
const cAbs = (x: ComplexNumber): number => Math.hypot(x.re, x.im);
const cToPublic = (x: ComplexNumber): Complex => ({ real: x.re, imag: x.im });
const dB = (x: ComplexNumber): number => 20 * Math.log10(Math.max(cAbs(x), 1e-15));
const returnLossDb = (x: ComplexNumber): number => {
  const magnitude = cAbs(x);
  // Below -240 dB the match is numerically perfect; reporting a finite number
  // there would imply a precision the solver does not have.
  return magnitude < 1e-12 ? Number.POSITIVE_INFINITY : -20 * Math.log10(magnitude);
};
const identityABCD = (): ABCD => ({ a: c(1), b: c(0), c: c(0), d: c(1) });
const multiplyABCD = (x: ABCD, y: ABCD): ABCD => ({
  a: cAdd(cMul(x.a, y.a), cMul(x.b, y.c)),
  b: cAdd(cMul(x.a, y.b), cMul(x.b, y.d)),
  c: cAdd(cMul(x.c, y.a), cMul(x.d, y.c)),
  d: cAdd(cMul(x.c, y.b), cMul(x.d, y.d)),
});

export class RFCircuitDesigner {
  private circuits: Map<string, RFCircuit> = new Map();
  private sequence = 0;

  designLowPassFilter(cutoffFrequency: number, order: number, impedance = 50): RFCircuit {
    this.validateFrequency(cutoffFrequency, 'Cutoff frequency');
    this.validateOrder(order);
    this.validateImpedance(impedance);

    const gValues = BUTTERWORTH_G[order];
    const omega = 2 * Math.PI * cutoffFrequency;
    const elements: RFCircuitElement[] = gValues.map((g, index) => {
      const branch = index + 1;
      if (branch % 2 === 1) {
        return {
          id: `L${branch}`,
          type: 'inductor',
          value: (g * impedance) / omega,
          frequency: cutoffFrequency,
          parameters: { g },
          role: 'series',
        };
      }
      return {
        id: `C${branch}`,
        type: 'capacitor',
        value: g / (impedance * omega),
        frequency: cutoffFrequency,
        parameters: { g },
        role: 'shunt',
      };
    });

    const circuit: RFCircuit = {
      id: this.nextId('lpf'),
      name: `Low-pass filter ${this.formatHz(cutoffFrequency)}, n=${order}`,
      elements,
      connections: [],
      ports: [
        { id: 'input', impedance, type: 'input' },
        { id: 'output', impedance, type: 'output' },
      ],
      design: {
        kind: 'lowpass',
        centerFrequency: cutoffFrequency,
        bandwidth: cutoffFrequency,
        order,
        impedance,
      },
    };
    this.connectLadder(circuit);
    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designHighPassFilter(cutoffFrequency: number, order: number, impedance = 50): RFCircuit {
    this.validateFrequency(cutoffFrequency, 'Cutoff frequency');
    this.validateOrder(order);
    this.validateImpedance(impedance);

    const gValues = BUTTERWORTH_G[order];
    const omega = 2 * Math.PI * cutoffFrequency;
    const elements: RFCircuitElement[] = gValues.map((g, index) => {
      const branch = index + 1;
      if (branch % 2 === 1) {
        return {
          id: `C${branch}`,
          type: 'capacitor',
          value: 1 / (omega * impedance * g),
          frequency: cutoffFrequency,
          parameters: { g },
          role: 'series',
        };
      }
      return {
        id: `L${branch}`,
        type: 'inductor',
        value: impedance / (omega * g),
        frequency: cutoffFrequency,
        parameters: { g },
        role: 'shunt',
      };
    });

    const circuit: RFCircuit = {
      id: this.nextId('hpf'),
      name: `High-pass filter ${this.formatHz(cutoffFrequency)}, n=${order}`,
      elements,
      connections: [],
      ports: [
        { id: 'input', impedance, type: 'input' },
        { id: 'output', impedance, type: 'output' },
      ],
      design: {
        kind: 'highpass',
        centerFrequency: cutoffFrequency,
        bandwidth: Number.POSITIVE_INFINITY,
        order,
        impedance,
      },
    };
    this.connectLadder(circuit);
    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designBandPassFilter(centerFrequency: number, bandwidth: number, order: number, impedance = 50): RFCircuit {
    this.validateFrequency(centerFrequency, 'Center frequency');
    this.validateOrder(order);
    this.validateImpedance(impedance);
    const fractionalBandwidth = bandwidth / centerFrequency;
    if (!Number.isFinite(bandwidth) || bandwidth <= 0 || fractionalBandwidth >= 1) {
      throw new Error(
        `Bandwidth must be positive and smaller than the center frequency ` +
          `(got ${bandwidth} Hz for ${centerFrequency} Hz).`,
      );
    }

    const gValues = BUTTERWORTH_G[order];
    const omega0 = 2 * Math.PI * centerFrequency;
    const delta = fractionalBandwidth;
    const elements: RFCircuitElement[] = [];

    gValues.forEach((g, index) => {
      const branch = index + 1;
      if (branch % 2 === 1) {
        // Series resonator: L and C in series, transformed from the prototype.
        elements.push(
          {
            id: `Ls${branch}`,
            type: 'inductor',
            value: (g * impedance) / (delta * omega0),
            frequency: centerFrequency,
            parameters: { g },
            role: 'series',
          },
          {
            id: `Cs${branch}`,
            type: 'capacitor',
            value: delta / (omega0 * impedance * g),
            frequency: centerFrequency,
            parameters: { g },
            role: 'series',
          },
        );
      } else {
        // Shunt resonator: L and C in parallel to ground.
        elements.push(
          {
            id: `Cp${branch}`,
            type: 'capacitor',
            value: g / (delta * omega0 * impedance),
            frequency: centerFrequency,
            parameters: { g },
            role: 'shunt',
          },
          {
            id: `Lp${branch}`,
            type: 'inductor',
            value: (delta * impedance) / (omega0 * g),
            frequency: centerFrequency,
            parameters: { g },
            role: 'shunt',
          },
        );
      }
    });

    const circuit: RFCircuit = {
      id: this.nextId('bpf'),
      name: `Band-pass filter ${this.formatHz(centerFrequency)}, n=${order}`,
      elements,
      connections: [],
      ports: [
        { id: 'input', impedance, type: 'input' },
        { id: 'output', impedance, type: 'output' },
      ],
      design: {
        kind: 'bandpass',
        centerFrequency,
        bandwidth,
        order,
        impedance,
      },
    };
    this.connectLadder(circuit);
    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designAmplifier(
    gain: number,
    frequency: number,
    noiseFigure = 3,
    options: AmplifierTemplateOptions = {},
  ): RFCircuit {
    this.validateFrequency(frequency, 'Amplifier frequency');
    if (!Number.isFinite(gain)) throw new Error('Amplifier gain must be a finite number of dB.');
    if (!Number.isFinite(noiseFigure) || noiseFigure < 0) {
      throw new Error('Noise figure must be a non-negative number of dB.');
    }

    const inputReturnLoss = options.inputReturnLossDb ?? 15;
    const outputReturnLoss = options.outputReturnLossDb ?? 15;
    const isolation = options.isolationDb ?? 20;
    if (
      !Number.isFinite(inputReturnLoss) ||
      !Number.isFinite(outputReturnLoss) ||
      !Number.isFinite(isolation) ||
      inputReturnLoss < 0 ||
      outputReturnLoss < 0 ||
      isolation < 0
    ) {
      throw new Error('Return loss and isolation template values must be non-negative and finite.');
    }
    if (options.bandwidthHz !== undefined && (!Number.isFinite(options.bandwidthHz) || options.bandwidthHz <= 0)) {
      throw new Error('Amplifier bandwidth must be positive and finite when supplied.');
    }
    if (
      options.outputThirdOrderInterceptDbm !== undefined &&
      !Number.isFinite(options.outputThirdOrderInterceptDbm)
    ) {
      throw new Error('Output third-order intercept must be finite when supplied.');
    }

    const transistor: RFCircuitElement = {
      id: 'Q1',
      type: 'amplifier',
      value: gain,
      frequency,
      parameters: {
        noiseFigure,
        inputReturnLoss,
        outputReturnLoss,
        isolation,
        ...(options.outputThirdOrderInterceptDbm !== undefined
          ? { thirdOrderIntercept: options.outputThirdOrderInterceptDbm }
          : {}),
      },
    };

    // Template bias and matching artefacts. Their values are a starting point,
    // not a characterized RF design.
    const elements: RFCircuitElement[] = [
      transistor,
      { id: 'R_bias', type: 'resistor', value: 1000, frequency, parameters: {} },
      { id: 'C_bias', type: 'capacitor', value: 100e-9, frequency, parameters: {} },
      {
        id: 'input_match',
        type: 'transmission_line',
        value: 50,
        frequency,
        parameters: { length: 0.25, impedance: 50 },
      },
      {
        id: 'output_match',
        type: 'transmission_line',
        value: 50,
        frequency,
        parameters: { length: 0.25, impedance: 50 },
      },
    ];

    const circuit: RFCircuit = {
      id: this.nextId('amp'),
      name: `RF amplifier ${this.formatHz(frequency)}, ${gain.toFixed(1)} dB`,
      elements,
      connections: [
        { from: 'input', to: 'input_match', type: 'series' },
        { from: 'input_match', to: 'Q1', type: 'series' },
        { from: 'Q1', to: 'output_match', type: 'series' },
        { from: 'output_match', to: 'output', type: 'series' },
        { from: 'vcc', to: 'R_bias', type: 'series' },
        { from: 'R_bias', to: 'Q1', type: 'series' },
        { from: 'Q1', to: 'gnd', type: 'ground' },
        { from: 'C_bias', to: 'gnd', type: 'ground' },
      ],
      ports: [
        { id: 'input', impedance: 50, type: 'input' },
        { id: 'output', impedance: 50, type: 'output' },
        { id: 'vcc', impedance: 0, type: 'bidirectional' },
        { id: 'gnd', impedance: 0, type: 'bidirectional' },
      ],
      design: {
        kind: 'amplifier',
        centerFrequency: frequency,
        ...(options.bandwidthHz !== undefined ? { bandwidth: options.bandwidthHz } : {}),
        impedance: 50,
      },
    };

    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designMixer(
    loFrequency: number,
    rfFrequency: number,
    ifFrequency: number,
    options: MixerTemplateOptions = {},
  ): RFCircuit {
    this.validateFrequency(loFrequency, 'LO frequency');
    this.validateFrequency(rfFrequency, 'RF frequency');
    this.validateFrequency(ifFrequency, 'IF frequency');
    const predictedIf = Math.abs(rfFrequency - loFrequency);
    const tolerance = Math.max(1, ifFrequency * 1e-6);
    if (Math.abs(predictedIf - ifFrequency) > tolerance) {
      throw new Error(
        `Mixer frequencies are inconsistent: |RF − LO| = ${predictedIf} Hz, but IF = ${ifFrequency} Hz.`,
      );
    }

    const conversionLoss = options.conversionLossDb ?? 6;
    const isolation = options.isolationDb ?? 20;
    const noiseFigure = options.noiseFigureDb ?? conversionLoss + 1;
    const inputReturnLoss = options.inputReturnLossDb ?? 15;
    const outputReturnLoss = options.outputReturnLossDb ?? 15;
    if (
      options.inputThirdOrderInterceptDbm !== undefined &&
      !Number.isFinite(options.inputThirdOrderInterceptDbm)
    ) {
      throw new Error('Input third-order intercept must be finite when supplied.');
    }
    const ifBandwidth = options.ifBandwidthHz ?? 1e6;
    for (const [label, value] of [
      ['Conversion loss', conversionLoss],
      ['Isolation', isolation],
      ['Noise figure', noiseFigure],
      ['Input return loss', inputReturnLoss],
      ['Output return loss', outputReturnLoss],
      ['IF bandwidth', ifBandwidth],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
    }

    const elements: RFCircuitElement[] = [
      {
        id: 'D1',
        type: 'mixer',
        value: conversionLoss,
        frequency: rfFrequency,
        parameters: {
          conversionLoss,
          isolation,
          noiseFigure,
          inputReturnLoss,
          outputReturnLoss,
          ifBandwidth,
          loFrequency,
          rfFrequency,
          ifFrequency,
          ...(options.inputThirdOrderInterceptDbm !== undefined
            ? { thirdOrderIntercept: options.inputThirdOrderInterceptDbm }
            : {}),
        },
      },
      {
        id: 'D2',
        type: 'mixer',
        value: conversionLoss,
        frequency: rfFrequency,
        parameters: {
          conversionLoss,
          isolation,
          noiseFigure,
          inputReturnLoss,
          outputReturnLoss,
        },
      },
      {
        id: 'rf_balun',
        type: 'transmission_line',
        value: 50,
        frequency: rfFrequency,
        parameters: { turnsRatio: 1, impedance: 50 },
      },
      {
        id: 'lo_balun',
        type: 'transmission_line',
        value: 50,
        frequency: loFrequency,
        parameters: { turnsRatio: 1, impedance: 50 },
      },
      {
        id: 'if_filter',
        type: 'filter',
        value: ifFrequency,
        frequency: ifFrequency,
        parameters: { bandwidth: ifBandwidth, rejection: 40 },
      },
    ];

    const circuit: RFCircuit = {
      id: this.nextId('mixer'),
      name: `RF mixer ${this.formatHz(rfFrequency)} → ${this.formatHz(ifFrequency)}`,
      elements,
      connections: [
        { from: 'rf', to: 'rf_balun', type: 'series' },
        { from: 'lo', to: 'lo_balun', type: 'series' },
        { from: 'rf_balun', to: 'D1', type: 'series' },
        { from: 'lo_balun', to: 'D1', type: 'series' },
        { from: 'D1', to: 'D2', type: 'series' },
        { from: 'D2', to: 'if_filter', type: 'series' },
        { from: 'if_filter', to: 'if', type: 'series' },
      ],
      ports: [
        { id: 'rf', impedance: 50, type: 'input' },
        { id: 'lo', impedance: 50, type: 'input' },
        { id: 'if', impedance: 50, type: 'output' },
      ],
      design: {
        kind: 'mixer',
        centerFrequency: rfFrequency,
        bandwidth: ifBandwidth,
        impedance: 50,
      },
    };

    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  designOscillator(frequency: number, outputPower = 10): RFCircuit {
    this.validateFrequency(frequency, 'Oscillator frequency');
    if (!Number.isFinite(outputPower)) throw new Error('Oscillator output power must be finite dBm.');

    const wavelength = SPEED_OF_LIGHT / frequency;
    const circuit: RFCircuit = {
      id: this.nextId('osc'),
      name: `RF oscillator ${this.formatHz(frequency)}, ${outputPower.toFixed(1)} dBm`,
      elements: [
        {
          id: 'Q1',
          type: 'oscillator',
          value: outputPower,
          frequency,
          parameters: { phaseNoise: -100, tuningRange: frequency * 0.1, harmonicSuppression: 30 },
        },
        {
          id: 'resonator',
          type: 'transmission_line',
          value: 50,
          frequency,
          parameters: { lengthMeters: wavelength / 4, impedance: 50, qFactor: 100 },
        },
        {
          id: 'C_tune',
          type: 'capacitor',
          value: 1e-12,
          frequency,
          parameters: { tuningVoltage: 20, capacitanceRange: 0.5e-12 },
        },
        {
          id: 'buffer',
          type: 'amplifier',
          value: 10,
          frequency,
          parameters: { isolation: 20 },
        },
      ],
      connections: [
        { from: 'Q1', to: 'resonator', type: 'series' },
        { from: 'resonator', to: 'Q1', type: 'series' },
        { from: 'Q1', to: 'buffer', type: 'series' },
        { from: 'buffer', to: 'output', type: 'series' },
        { from: 'C_tune', to: 'resonator', type: 'parallel' },
        { from: 'vcc', to: 'Q1', type: 'series' },
        { from: 'Q1', to: 'gnd', type: 'ground' },
      ],
      ports: [
        { id: 'output', impedance: 50, type: 'output' },
        { id: 'vcc', impedance: 0, type: 'bidirectional' },
        { id: 'gnd', impedance: 0, type: 'bidirectional' },
      ],
      design: {
        kind: 'oscillator',
        centerFrequency: frequency,
        impedance: 50,
      },
    };

    this.circuits.set(circuit.id, circuit);
    return circuit;
  }

  /**
   * Evaluates the two-port at one frequency. Passive circuits are solved as an
   * ABCD cascade of their ladder elements; active templates use their stated
   * magnitude parameters. Throws when a circuit has no defined two-port model.
   */
  calculateSParameters(circuit: RFCircuit, frequency: number): ScatteringParameters {
    this.validateFrequency(frequency, 'Analysis frequency');
    const kind = circuit.design?.kind;
    if (kind === 'amplifier') return this.activeSParameters(circuit, frequency, 'amplifier');
    if (kind === 'mixer') return this.activeSParameters(circuit, frequency, 'mixer');
    if (kind === 'oscillator') {
      throw new Error('An oscillator is defined by output power and phase noise, not a two-port S-parameter model.');
    }

    const z0 = circuit.ports.find((port) => port.id === 'input')?.impedance ?? 50;
    if (!(z0 > 0)) throw new Error(`Reference impedance must be positive, got ${z0}.`);
    const zOut = circuit.ports.find((port) => port.id === 'output')?.impedance ?? z0;
    if (!(zOut > 0)) throw new Error(`Output reference impedance must be positive, got ${zOut}.`);
    // The ABCD-to-S conversion below carries a single z0; applying it to a
    // different output impedance would quietly misstate every parameter.
    if (Math.abs(zOut - z0) > 1e-9 * Math.max(1, z0)) {
      throw new Error(
        `S-parameters require equal port impedances; input is ${z0} Ω and output is ${zOut} Ω.`,
      );
    }
    const abcd = this.ladderToABCD(circuit, frequency);
    const denominator = cAdd(
      cAdd(abcd.a, cScale(abcd.b, 1 / z0)),
      cAdd(cScale(abcd.c, z0), abcd.d),
    );
    if (cAbs(denominator) < 1e-15) {
      throw new Error(`The two-port is singular at ${frequency} Hz.`);
    }

    const determinant = cSub(cMul(abcd.a, abcd.d), cMul(abcd.b, abcd.c));
    const s11 = cDiv(
      cSub(cAdd(abcd.a, cScale(abcd.b, 1 / z0)), cAdd(cScale(abcd.c, z0), abcd.d)),
      denominator,
    );
    const s12 = cDiv(cScale(determinant, 2), denominator);
    const s21 = cDiv(c(2), denominator);
    const s22 = cDiv(
      cAdd(cAdd(cScale(abcd.a, -1), cScale(abcd.b, 1 / z0)), cAdd(cScale(abcd.c, -z0), abcd.d)),
      denominator,
    );

    return {
      frequency,
      s11: cToPublic(s11),
      s12: cToPublic(s12),
      s21: cToPublic(s21),
      s22: cToPublic(s22),
    };
  }

  sweepSParameters(circuit: RFCircuit, startFrequency: number, stopFrequency: number, points = 101): ScatteringParameters[] {
    this.validateFrequency(startFrequency, 'Sweep start frequency');
    this.validateFrequency(stopFrequency, 'Sweep stop frequency');
    if (!(stopFrequency > startFrequency)) {
      throw new Error('Sweep stop frequency must be greater than the start frequency.');
    }
    if (!Number.isInteger(points) || points < 2) {
      throw new Error(`Sweep needs an integer number of points >= 2, got ${points}.`);
    }

    const ratio = stopFrequency / startFrequency;
    return Array.from({ length: points }, (_, index) => {
      const frequency = startFrequency * Math.pow(ratio, index / (points - 1));
      return this.calculateSParameters(circuit, frequency);
    });
  }

  calculatePerformanceMetrics(circuit: RFCircuit): RFPerformanceMetrics {
    const design = circuit.design;
    if (!design) throw new Error('The circuit has no design metadata, so its performance cannot be characterized.');

    if (design.kind === 'lowpass' || design.kind === 'highpass' || design.kind === 'bandpass') {
      const s = this.calculateSParameters(circuit, design.centerFrequency);
      const s11 = c(s.s11.real, s.s11.imag);
      const s12 = c(s.s12.real, s.s12.imag);
      const s21 = c(s.s21.real, s.s21.imag);
      const s22 = c(s.s22.real, s.s22.imag);
      const gain = dB(s21);
      return {
        gain,
        noiseFigure: Math.max(0, -gain),
        inputReturnLoss: returnLossDb(s11),
        outputReturnLoss: returnLossDb(s22),
        isolation: -dB(s12),
        bandwidth: design.bandwidth ?? Number.NaN,
        centerFrequency: design.centerFrequency,
        stabilityFactor: this.rollettStability(s),
        thirdOrderIntercept: Number.NaN,
      };
    }

    const elementType = design.kind === 'amplifier' ? 'amplifier' : design.kind === 'mixer' ? 'mixer' : 'oscillator';
    const active = circuit.elements.find((element) => element.type === elementType);
    if (!active) {
      throw new Error(`The ${design.kind} circuit does not contain a ${elementType} element.`);
    }
    const parameter = (name: string): number => {
      const value = active.parameters[name];
      return Number.isFinite(value) ? value : Number.NaN;
    };

    if (design.kind === 'oscillator') {
      return {
        gain: Number.NaN,
        noiseFigure: Number.NaN,
        inputReturnLoss: Number.NaN,
        outputReturnLoss: Number.NaN,
        isolation: Number.NaN,
        bandwidth: Number.NaN,
        centerFrequency: active.frequency,
        stabilityFactor: Number.NaN,
        thirdOrderIntercept: Number.NaN,
      };
    }

    const s = this.calculateSParameters(circuit, active.frequency);
    const gain = design.kind === 'mixer' ? -parameter('conversionLoss') : active.value;
    return {
      gain,
      noiseFigure: parameter('noiseFigure'),
      inputReturnLoss: parameter('inputReturnLoss'),
      outputReturnLoss: parameter('outputReturnLoss'),
      isolation: parameter('isolation'),
      bandwidth: design.bandwidth ?? Number.NaN,
      centerFrequency: active.frequency,
      stabilityFactor: this.rollettStability(s),
      thirdOrderIntercept: parameter('thirdOrderIntercept'),
    };
  }

  getCircuit(id: string): RFCircuit | undefined {
    return this.circuits.get(id);
  }

  getAllCircuits(): RFCircuit[] {
    return Array.from(this.circuits.values());
  }

  private activeSParameters(
    circuit: RFCircuit,
    frequency: number,
    kind: 'amplifier' | 'mixer',
  ): ScatteringParameters {
    const element = circuit.elements.find((candidate) => candidate.type === kind);
    if (!element) throw new Error(`The circuit does not contain a ${kind} element.`);
    const parameter = (name: string): number => {
      const value = element.parameters[name];
      if (!Number.isFinite(value)) {
        throw new Error(`The ${kind} is missing the "${name}" parameter needed for its two-port model.`);
      }
      return value;
    };

    const gainDb = kind === 'mixer' ? -parameter('conversionLoss') : element.value;
    if (!Number.isFinite(gainDb)) throw new Error(`The ${kind} gain is not a finite number.`);
    const isolation = parameter('isolation');
    const inputReturnLoss = parameter('inputReturnLoss');
    const outputReturnLoss = parameter('outputReturnLoss');

    // Magnitude-only template model: forward phase is not characterized and is
    // reported as zero rather than invented from an arbitrary delay.
    return {
      frequency,
      s11: cToPublic(c(Math.pow(10, -inputReturnLoss / 20))),
      s12: cToPublic(c(Math.pow(10, -isolation / 20))),
      s21: cToPublic(c(Math.pow(10, gainDb / 20))),
      s22: cToPublic(c(Math.pow(10, -outputReturnLoss / 20))),
    };
  }

  private ladderToABCD(circuit: RFCircuit, frequency: number): ABCD {
    const omega = 2 * Math.PI * frequency;
    let result = identityABCD();
    for (const element of circuit.elements) {
      result = multiplyABCD(result, this.elementABCD(element, frequency, omega));
    }
    return result;
  }

  private elementABCD(element: RFCircuitElement, frequency: number, omega: number): ABCD {
    if (element.type === 'transmission_line') {
      const characteristic = element.parameters.impedance ?? element.value;
      if (!(characteristic > 0)) {
        throw new Error(`Transmission line ${element.id} needs a positive characteristic impedance.`);
      }
      const theta = this.electricalLength(element, frequency);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      return {
        a: c(cos),
        b: c(0, characteristic * sin),
        c: c(0, sin / characteristic),
        d: c(cos),
      };
    }

    if (element.type === 'amplifier' || element.type === 'mixer' || element.type === 'filter' || element.type === 'oscillator') {
      throw new Error(`Active element ${element.id} cannot be part of a passive ladder.`);
    }
    if (!element.role) {
      throw new Error(`Ladder element ${element.id} needs a "series" or "shunt" role.`);
    }

    const impedance = this.elementImpedance(element, omega);
    if (element.role === 'series') {
      return { a: c(1), b: impedance, c: c(0), d: c(1) };
    }
    const admittance = cDiv(c(1), impedance);
    return { a: c(1), b: c(0), c: admittance, d: c(1) };
  }

  private elementImpedance(element: RFCircuitElement, omega: number): ComplexNumber {
    if (!Number.isFinite(element.value) || element.value < 0) {
      throw new Error(`Element ${element.id} has an invalid value ${element.value}.`);
    }
    const q = element.qualityFactor;

    switch (element.type) {
      case 'resistor':
        if (element.value <= 0) throw new Error(`Resistor ${element.id} must have a positive resistance.`);
        return c(element.value);
      case 'inductor': {
        if (element.value <= 0) throw new Error(`Inductor ${element.id} must have a positive inductance.`);
        const reactance = omega * element.value;
        const resistance = q !== undefined && q > 0 ? reactance / q : 0;
        return c(resistance, reactance);
      }
      case 'capacitor': {
        if (element.value <= 0) throw new Error(`Capacitor ${element.id} must have a positive capacitance.`);
        const reactance = -1 / (omega * element.value);
        const resistance = q !== undefined && q > 0 ? 1 / (omega * element.value * q) : 0;
        return c(resistance, reactance);
      }
      default:
        throw new Error(`Element ${element.id} of type "${element.type}" is not a passive ladder element.`);
    }
  }

  private electricalLength(element: RFCircuitElement, frequency: number): number {
    const meters = element.parameters.lengthMeters;
    if (meters !== undefined) {
      // Falling back to the quarter-wave default here would hide a bad length
      // and analyse a different line from the one the user placed.
      if (!Number.isFinite(meters) || meters < 0) {
        throw new Error(
          `Transmission line ${element.id} has an invalid physical length ${meters} m.`,
        );
      }
      return (2 * Math.PI * frequency * meters) / SPEED_OF_LIGHT;
    }
    const wavelengths = element.parameters.length ?? 0.25;
    if (!(wavelengths >= 0)) throw new Error(`Transmission line ${element.id} has a negative length.`);
    if (!(element.frequency > 0)) throw new Error(`Transmission line ${element.id} needs a positive design frequency.`);
    return 2 * Math.PI * wavelengths * (frequency / element.frequency);
  }

  private connectLadder(circuit: RFCircuit): void {
    const connections: RFCircuit['connections'] = [];
    let node = 'input';
    for (const element of circuit.elements) {
      if (!element.role) throw new Error(`Ladder element ${element.id} needs a role.`);
      connections.push({ from: node, to: element.id, type: 'series' });
      if (element.role === 'shunt') {
        connections.push({ from: element.id, to: 'gnd', type: 'ground' });
      } else {
        node = element.id;
      }
    }
    connections.push({ from: node, to: 'output', type: 'series' });
    circuit.connections = connections;
  }

  private rollettStability(s: ScatteringParameters): number {
    const s11 = c(s.s11.real, s.s11.imag);
    const s12 = c(s.s12.real, s.s12.imag);
    const s21 = c(s.s21.real, s.s21.imag);
    const s22 = c(s.s22.real, s.s22.imag);
    const determinant = cSub(cMul(s11, s22), cMul(s12, s21));
    const denominator = 2 * cAbs(cMul(s12, s21));
    if (denominator === 0) return Number.POSITIVE_INFINITY;
    const numerator =
      1 - cAbs(s11) ** 2 - cAbs(s22) ** 2 + cAbs(determinant) ** 2;
    return numerator / denominator;
  }

  private validateFrequency(frequency: number, label: string): void {
    if (!Number.isFinite(frequency) || frequency <= 0) {
      throw new Error(`${label} must be a positive finite number of hertz, got ${frequency}.`);
    }
  }

  private validateOrder(order: number): void {
    if (!Number.isInteger(order) || order < 1 || order > MAX_FILTER_ORDER) {
      throw new Error(`Filter order must be an integer from 1 to ${MAX_FILTER_ORDER}, got ${order}.`);
    }
  }

  private validateImpedance(impedance: number): void {
    if (!Number.isFinite(impedance) || impedance <= 0) {
      throw new Error(`Reference impedance must be a positive finite number of ohms, got ${impedance}.`);
    }
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  private formatHz(frequency: number): string {
    if (frequency >= 1e9) return `${(frequency / 1e9).toFixed(3)} GHz`;
    if (frequency >= 1e6) return `${(frequency / 1e6).toFixed(3)} MHz`;
    if (frequency >= 1e3) return `${(frequency / 1e3).toFixed(3)} kHz`;
    return `${frequency.toFixed(1)} Hz`;
  }
}

export const rfCircuitDesigner = new RFCircuitDesigner();
