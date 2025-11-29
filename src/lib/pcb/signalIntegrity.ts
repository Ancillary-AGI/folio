/**
 * Signal Integrity Analysis for PCB Design
 * Provides signal integrity simulation, impedance analysis, and timing analysis
 */

export interface SignalTrace {
  id: string;
  net: string;
  layer: string;
  width: number;
  thickness: number;
  length: number;
  points: Array<{ x: number; y: number }>;
  referencePlane?: string;
  dielectricConstant: number;
  dielectricThickness: number;
}

export interface SignalDriver {
  id: string;
  type: 'CMOS' | 'LVDS' | 'LVCMOS' | 'HSTL' | 'SSTL';
  voltage: number;
  riseTime: number; // ns
  fallTime: number; // ns
  outputImpedance: number; // Ω
  driveStrength: number; // mA
}

export interface SignalReceiver {
  id: string;
  type: 'CMOS' | 'LVDS' | 'LVCMOS' | 'HSTL' | 'SSTL';
  inputImpedance: number; // Ω
  inputCapacitance: number; // pF
  thresholdVoltage: number; // V
}

export interface SignalIntegrityAnalysis {
  traceId: string;
  characteristicImpedance: number; // Ω
  propagationDelay: number; // ns
  signalRiseTime: number; // ns
  overshoot: number; // V
  undershoot: number; // V
  ringing: {
    frequency: number; // MHz
    amplitude: number; // V
    damping: number;
  };
  crosstalk: {
    aggressor: string;
    victim: string;
    nearEnd: number; // V
    farEnd: number; // V
  }[];
  eyeDiagram: {
    eyeHeight: number; // V
    eyeWidth: number; // ns
    jitter: number; // ns
  };
  recommendations: string[];
}

export interface SignalIntegrityConfig {
  frequency: number; // MHz
  dataRate: number; // Mbps
  temperature: number; // °C
  boardMaterial: string;
  analysisType: 'dc' | 'ac' | 'transient' | 'eye';
}

export class SignalIntegrityAnalyzer {
  private materialProperties: Record<string, {
    dielectricConstant: number;
    lossTangent: number;
    conductivity: number; // S/m
  }> = {
    'FR4': {
      dielectricConstant: 4.5,
      lossTangent: 0.02,
      conductivity: 5.8e7
    },
    'Rogers4003': {
      dielectricConstant: 3.38,
      lossTangent: 0.0027,
      conductivity: 5.8e7
    }
  };

  async analyzeTrace(trace: {
    length: number;
    width: number;
    thickness: number;
    dielectricHeight: number;
    dielectricConstant: number;
    frequency: number;
  }): Promise<{
    impedance: number;
    propagationDelay: number;
    riseTime: number;
    reflectionCoefficient: number;
  }> {
    // Convert to internal format
    const internalTrace: SignalTrace = {
      id: 'temp',
      net: 'temp',
      layer: 'top',
      width: trace.width,
      thickness: trace.thickness,
      length: trace.length,
      points: [],
      dielectricConstant: trace.dielectricConstant,
      dielectricThickness: trace.dielectricHeight
    };

    const impedance = this.calculateCharacteristicImpedance(internalTrace);
    const propagationDelay = this.calculatePropagationDelay(internalTrace);

    // Simplified calculations
    const riseTime = 0.35 / (trace.frequency * 1e6) * 1e9; // ns
    const reflectionCoefficient = 0.1; // Simplified

    return {
      impedance,
      propagationDelay,
      riseTime,
      reflectionCoefficient
    };
  }

  async analyzeSignalIntegrity(
    trace: SignalTrace,
    driver: SignalDriver,
    receiver: SignalReceiver,
    config: SignalIntegrityConfig
  ): Promise<SignalIntegrityAnalysis> {
    // Calculate characteristic impedance
    const Z0 = this.calculateCharacteristicImpedance(trace);

    // Calculate propagation delay
    const delay = this.calculatePropagationDelay(trace);

    // Simulate signal behavior
    const signalResponse = this.simulateSignalResponse(trace, driver, receiver);

    // Calculate crosstalk (simplified)
    const crosstalk = this.calculateCrosstalk(trace, []);

    // Generate eye diagram
    const eyeDiagram = this.generateEyeDiagram(signalResponse, config);

    // Generate recommendations
    const recommendations = this.generateRecommendations(trace, Z0, signalResponse);

    return {
      traceId: trace.id,
      characteristicImpedance: Z0,
      propagationDelay: delay,
      signalRiseTime: signalResponse.riseTime,
      overshoot: signalResponse.overshoot,
      undershoot: signalResponse.undershoot,
      ringing: signalResponse.ringing,
      crosstalk,
      eyeDiagram,
      recommendations
    };
  }

  private calculateCharacteristicImpedance(trace: SignalTrace): number {
    // Microstrip line impedance calculation
    const er = trace.dielectricConstant;
    const h = trace.dielectricThickness; // mm
    const w = trace.width; // mm
    const t = trace.thickness; // mm

    // Simplified microstrip impedance formula
    const Z0 = (87 / Math.sqrt(er + 1.41)) * Math.log(5.98 * h / (0.8 * w + t));
    return Z0;
  }

  private calculatePropagationDelay(trace: SignalTrace): number {
    // Propagation delay in ns
    const er = trace.dielectricConstant;
    const c = 3e8; // Speed of light in m/s
    const vp = c / Math.sqrt(er); // Phase velocity
    const delay = (trace.length / 1000) / vp * 1e9; // Convert to ns
    return delay;
  }

  private simulateSignalResponse(
    trace: SignalTrace,
    driver: SignalDriver,
    receiver: SignalReceiver
  ): {
    riseTime: number;
    overshoot: number;
    undershoot: number;
    ringing: { frequency: number; amplitude: number; damping: number };
  } {
    const Z0 = this.calculateCharacteristicImpedance(trace);
    const delay = this.calculatePropagationDelay(trace);

    // Calculate reflection coefficient
    const gammaLoad = (receiver.inputImpedance - Z0) / (receiver.inputImpedance + Z0);
    const gammaSource = (driver.outputImpedance - Z0) / (driver.outputImpedance + Z0);

    // Estimate signal rise time (includes transmission line effects)
    const riseTime = Math.sqrt(
      Math.pow(driver.riseTime, 2) + Math.pow(delay, 2)
    );

    // Estimate overshoot/undershoot
    const overshoot = driver.voltage * Math.abs(gammaLoad) * 0.3;
    const undershoot = -driver.voltage * Math.abs(gammaLoad) * 0.2;

    // Estimate ringing
    const ringingFrequency = 1 / (4 * delay * 1e-9) / 1e6; // MHz
    const ringingAmplitude = driver.voltage * Math.abs(gammaLoad) * Math.abs(gammaSource);
    const damping = 1 - Math.abs(gammaLoad * gammaSource);

    return {
      riseTime,
      overshoot,
      undershoot,
      ringing: {
        frequency: ringingFrequency,
        amplitude: ringingAmplitude,
        damping
      }
    };
  }

  private calculateCrosstalk(
    trace: SignalTrace,
    nearbyTraces: SignalTrace[]
  ): Array<{ aggressor: string; victim: string; nearEnd: number; farEnd: number }> {
    const crosstalk: Array<{ aggressor: string; victim: string; nearEnd: number; farEnd: number }> = [];

    // Simplified crosstalk calculation
    nearbyTraces.forEach(aggressor => {
      const distance = this.calculateMinDistance(trace, aggressor);
      if (distance < 0.5) { // Consider traces within 0.5mm
        const coupling = Math.exp(-distance / 0.1); // Exponential decay
        const nearEnd = 0.1 * coupling; // V
        const farEnd = 0.05 * coupling; // V

        crosstalk.push({
          aggressor: aggressor.id,
          victim: trace.id,
          nearEnd,
          farEnd
        });
      }
    });

    return crosstalk;
  }

  private generateEyeDiagram(
    signalResponse: { riseTime: number; overshoot: number; undershoot: number; ringing: { frequency: number; amplitude: number; damping: number } },
    config: SignalIntegrityConfig
  ): { eyeHeight: number; eyeWidth: number; jitter: number } {
    // Simplified eye diagram generation
    const bitPeriod = 1000 / config.dataRate; // ns

    // Estimate eye height (reduced by overshoot/undershoot)
    const eyeHeight = config.frequency > 100 ? 0.7 : 0.9; // V (simplified)
    const eyeHeightReduced = eyeHeight - Math.abs(signalResponse.overshoot) - Math.abs(signalResponse.undershoot);

    // Estimate eye width (reduced by jitter)
    const jitter = signalResponse.riseTime * 0.1; // ns (simplified)
    const eyeWidth = bitPeriod - jitter - signalResponse.riseTime;

    return {
      eyeHeight: Math.max(0, eyeHeightReduced),
      eyeWidth: Math.max(0, eyeWidth),
      jitter
    };
  }

  private generateRecommendations(
    trace: SignalTrace,
    Z0: number,
    signalResponse: { riseTime: number; overshoot: number; undershoot: number; ringing: { frequency: number; amplitude: number; damping: number } }
  ): string[] {
    const recommendations: string[] = [];

    // Impedance matching
    if (Math.abs(Z0 - 50) > 5) {
      recommendations.push(`Trace impedance (${Z0.toFixed(1)}Ω) deviates from 50Ω. Adjust trace width or layer stackup.`);
    }

    // Overshoot/undershoot
    if (Math.abs(signalResponse.overshoot) > 0.2) {
      recommendations.push('Excessive overshoot detected. Consider adding series termination resistor.');
    }

    if (Math.abs(signalResponse.undershoot) > 0.2) {
      recommendations.push('Excessive undershoot detected. Consider adding parallel termination resistor.');
    }

    // Ringing
    if (signalResponse.ringing.amplitude > 0.3) {
      recommendations.push('Excessive ringing detected. Improve impedance matching or add damping resistor.');
    }

    // High-speed signals - simplified check based on trace length
    if (trace.length > 100) {
      recommendations.push('Long trace detected. Consider using differential signaling or controlled impedance routing.');
    }

    return recommendations;
  }

  private calculateMinDistance(trace1: SignalTrace, trace2: SignalTrace): number {
    let minDistance = Infinity;

    trace1.points.forEach(p1 => {
      trace2.points.forEach(p2 => {
        const distance = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
        minDistance = Math.min(minDistance, distance);
      });
    });

    return minDistance;
  }

  async optimizeTraceDesign(
    trace: SignalTrace,
    targetImpedance: number,
    constraints: { maxWidth: number; minWidth: number; maxLength: number }
  ): Promise<{
    optimizedTrace: SignalTrace;
    improvements: string[];
  }> {
    const currentZ0 = this.calculateCharacteristicImpedance(trace);
    const improvements: string[] = [];

    // Optimize trace width for target impedance
    let optimizedWidth = trace.width;
    if (Math.abs(currentZ0 - targetImpedance) > 1) {
      // Iterative optimization
      for (let i = 0; i < 10; i++) {
        const testTrace = { ...trace, width: optimizedWidth };
        const testZ0 = this.calculateCharacteristicImpedance(testTrace);
        
        if (Math.abs(testZ0 - targetImpedance) < 1) break;

        // Adjust width based on impedance difference
        optimizedWidth += (targetImpedance - testZ0) * 0.01;
        optimizedWidth = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, optimizedWidth));
      }

      improvements.push(`Optimized trace width from ${trace.width.toFixed(2)}mm to ${optimizedWidth.toFixed(2)}mm for ${targetImpedance}Ω impedance.`);
    }

    const optimizedTrace = {
      ...trace,
      width: optimizedWidth
    };

    return {
      optimizedTrace,
      improvements
    };
  }
}

export const signalIntegrityAnalyzer = new SignalIntegrityAnalyzer();

