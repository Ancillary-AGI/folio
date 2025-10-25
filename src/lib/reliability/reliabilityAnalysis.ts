import { Component } from '../../types';

export interface FailureMode {
  id: string;
  componentId: string;
  mode: string; // e.g., 'open', 'short', 'parametric_drift', 'intermittent'
  description: string;
  effects: string[];
  causes: string[];
  detection: string[];
  mitigation: string[];
  severity: 1 | 2 | 3 | 4 | 5; // 1=minor, 5=catastrophic
  occurrence: 1 | 2 | 3 | 4 | 5; // 1=remote, 5=frequent
  detection: 1 | 2 | 3 | 4 | 5; // 1=almost_certain, 5=very_remote
  riskPriority: number; // RPN = severity * occurrence * detection
}

export interface ReliabilityMetrics {
  id: string;
  componentId: string;
  mtbf: number; // Mean Time Between Failures (hours)
  mttr: number; // Mean Time To Repair (hours)
  availability: number; // percentage
  reliability: number; // probability of success over time
  failureRate: number; // failures per million hours
  confidence: number; // statistical confidence level
  testHours: number; // accumulated test time
  failureCount: number; // number of failures observed
}

export interface FMECAAnalysis {
  id: string;
  name: string;
  systemId: string;
  failureModes: FailureMode[];
  generated: Date;
  summary: {
    totalFailureModes: number;
    highRiskModes: number;
    criticalComponents: string[];
    recommendations: string[];
  };
}

export interface ReliabilityPrediction {
  id: string;
  systemId: string;
  predictionMethod: 'mil-hdbk-217' | 'telcordia' | 'custom';
  environment: 'ground_benign' | 'ground_fixed' | 'airborne' | 'space';
  temperature: number; // °C
  metrics: ReliabilityMetrics[];
  overallMTBF: number;
  overallAvailability: number;
  confidenceLevel: number;
  generated: Date;
}

export class ReliabilityAnalyzer {
  private fmecaAnalyses: Map<string, FMECAAnalysis> = new Map();
  private predictions: Map<string, ReliabilityPrediction> = new Map();
  private metrics: Map<string, ReliabilityMetrics> = new Map();

  performFMECA(components: Component[]): FMECAAnalysis {
    const failureModes: FailureMode[] = [];

    components.forEach(component => {
      const componentFailureModes = this.identifyFailureModes(component);
      failureModes.push(...componentFailureModes);
    });

    // Calculate Risk Priority Numbers
    failureModes.forEach(mode => {
      mode.riskPriority = mode.severity * mode.occurrence * mode.detection;
    });

    const highRiskModes = failureModes.filter(mode => mode.riskPriority > 100);
    const criticalComponents = [...new Set(highRiskModes.map(mode => mode.componentId))];

    const recommendations = this.generateFMECARecommendations(failureModes, highRiskModes);

    const analysis: FMECAAnalysis = {
      id: `fmeca_${Date.now()}`,
      name: 'System FMECA Analysis',
      systemId: 'system_1',
      failureModes,
      generated: new Date(),
      summary: {
        totalFailureModes: failureModes.length,
        highRiskModes: highRiskModes.length,
        criticalComponents,
        recommendations
      }
    };

    this.fmecaAnalyses.set(analysis.id, analysis);
    return analysis;
  }

  private identifyFailureModes(component: Component): FailureMode[] {
    const failureModes: FailureMode[] = [];

    // Common failure modes based on component category
    switch (component.category) {
      case 'resistor':
        failureModes.push({
          id: `fm_${component.id}_open`,
          componentId: component.id,
          mode: 'open',
          description: 'Resistor becomes open circuit',
          effects: ['Loss of circuit function', 'Open circuit in signal path'],
          causes: ['Manufacturing defect', 'Thermal stress', 'Mechanical damage'],
          detection: ['Continuity test', 'Functional test'],
          mitigation: ['Use higher quality resistors', 'Add redundancy', 'Improve thermal management'],
          severity: 4,
          occurrence: 2,
          detection: 2,
          riskPriority: 0 // Will be calculated
        });

        failureModes.push({
          id: `fm_${component.id}_drift`,
          componentId: component.id,
          mode: 'parametric_drift',
          description: 'Resistance value changes over time',
          effects: ['Signal distortion', 'Performance degradation'],
          causes: ['Temperature variation', 'Aging', 'Humidity'],
          detection: ['Parameter measurement', 'Performance monitoring'],
          mitigation: ['Use precision resistors', 'Temperature compensation', 'Regular calibration'],
          severity: 2,
          occurrence: 3,
          detection: 3,
          riskPriority: 0
        });
        break;

      case 'capacitor':
        failureModes.push({
          id: `fm_${component.id}_short`,
          componentId: component.id,
          mode: 'short',
          description: 'Capacitor becomes short circuit',
          effects: ['Power rail short', 'Component damage', 'System failure'],
          causes: ['Dielectric breakdown', 'Overvoltage', 'Manufacturing defect'],
          detection: ['Continuity test', 'Leakage current measurement'],
          mitigation: ['Use higher voltage rating', 'Add protection circuits', 'Improve filtering'],
          severity: 5,
          occurrence: 2,
          detection: 2,
          riskPriority: 0
        });
        break;

      case 'microcontroller':
        failureModes.push({
          id: `fm_${component.id}_lockup`,
          componentId: component.id,
          mode: 'lockup',
          description: 'Microcontroller becomes unresponsive',
          effects: ['System halt', 'Loss of control', 'Safety hazard'],
          causes: ['Software bug', 'Power supply glitch', 'EMI interference'],
          detection: ['Watchdog timeout', 'Heartbeat monitoring'],
          mitigation: ['Implement watchdog timer', 'Add reset circuitry', 'Improve EMI shielding'],
          severity: 5,
          occurrence: 3,
          detection: 2,
          riskPriority: 0
        });
        break;

      default:
        // Generic failure mode
        failureModes.push({
          id: `fm_${component.id}_generic`,
          componentId: component.id,
          mode: 'failure',
          description: 'Component fails to operate',
          effects: ['Loss of function'],
          causes: ['Various'],
          detection: ['Functional test'],
          mitigation: ['Use higher quality components', 'Add redundancy'],
          severity: 3,
          occurrence: 3,
          detection: 2,
          riskPriority: 0
        });
    }

    return failureModes;
  }

  private generateFMECARecommendations(failureModes: FailureMode[], highRiskModes: FailureMode[]): string[] {
    const recommendations = [];

    if (highRiskModes.length > 0) {
      recommendations.push(`Address ${highRiskModes.length} high-risk failure modes (RPN > 100)`);
    }

    const criticalComponents = [...new Set(highRiskModes.map(mode => mode.componentId))];
    if (criticalComponents.length > 0) {
      recommendations.push(`Focus reliability improvements on ${criticalComponents.length} critical components`);
    }

    const commonCauses = this.analyzeCommonCauses(failureModes);
    if (commonCauses.length > 0) {
      recommendations.push(`Address common failure causes: ${commonCauses.join(', ')}`);
    }

    recommendations.push('Implement redundancy for critical functions');
    recommendations.push('Add comprehensive monitoring and diagnostics');
    recommendations.push('Conduct regular preventive maintenance');

    return recommendations;
  }

  private analyzeCommonCauses(failureModes: FailureMode[]): string[] {
    const causeCount = new Map<string, number>();

    failureModes.forEach(mode => {
      mode.causes.forEach(cause => {
        causeCount.set(cause, (causeCount.get(cause) || 0) + 1);
      });
    });

    // Return causes that appear in more than 20% of failure modes
    const threshold = failureModes.length * 0.2;
    return Array.from(causeCount.entries())
      .filter(([, count]) => count > threshold)
      .map(([cause]) => cause);
  }

  predictReliability(components: Component[], method: ReliabilityPrediction['predictionMethod'] = 'mil-hdbk-217'): ReliabilityPrediction {
    const metrics: ReliabilityMetrics[] = [];

    components.forEach(component => {
      const componentMetrics = this.calculateComponentReliability(component, method);
      metrics.push(componentMetrics);
      this.metrics.set(componentMetrics.id, componentMetrics);
    });

    // Calculate system-level reliability using series model
    const systemFailureRate = metrics.reduce((sum, metric) => sum + metric.failureRate, 0);
    const overallMTBF = 1e6 / systemFailureRate; // hours
    const overallAvailability = (overallMTBF / (overallMTBF + 4)) * 100; // Assuming 4 hour MTTR

    const prediction: ReliabilityPrediction = {
      id: `pred_${Date.now()}`,
      systemId: 'system_1',
      predictionMethod: method,
      environment: 'ground_benign',
      temperature: 25,
      metrics,
      overallMTBF,
      overallAvailability,
      confidenceLevel: 0.9,
      generated: new Date()
    };

    this.predictions.set(prediction.id, prediction);
    return prediction;
  }

  private calculateComponentReliability(component: Component, method: string): ReliabilityMetrics {
    let baseFailureRate = 0;

    // Base failure rates from MIL-HDBK-217F (simplified)
    switch (component.category) {
      case 'resistor':
        baseFailureRate = 0.01; // failures per million hours
        break;
      case 'capacitor':
        baseFailureRate = 0.02;
        break;
      case 'inductor':
        baseFailureRate = 0.015;
        break;
      case 'diode':
        baseFailureRate = 0.05;
        break;
      case 'transistor':
        baseFailureRate = 0.1;
        break;
      case 'integrated_circuit':
        baseFailureRate = 0.5;
        break;
      case 'microcontroller':
        baseFailureRate = 1.0;
        break;
      default:
        baseFailureRate = 0.1;
    }

    // Apply environmental and quality factors
    const qualityFactor = 0.1; // High quality factor
    const environmentalFactor = 1.0; // Ground benign
    const temperatureFactor = 1.0; // 25°C

    const adjustedFailureRate = baseFailureRate * qualityFactor * environmentalFactor * temperatureFactor;

    return {
      id: `metrics_${component.id}`,
      componentId: component.id,
      mtbf: 1e6 / adjustedFailureRate,
      mttr: 4, // 4 hours average repair time
      availability: ((1e6 / adjustedFailureRate) / ((1e6 / adjustedFailureRate) + 4)) * 100,
      reliability: Math.exp(-adjustedFailureRate * 8760 / 1e6), // 1 year reliability
      failureRate: adjustedFailureRate,
      confidence: 0.9,
      testHours: 1000,
      failureCount: Math.floor(adjustedFailureRate * 1000 / 1e6)
    };
  }

  performReliabilityAllocation(totalMTBF: number, components: Component[]): ReliabilityMetrics[] {
    // Allocate system reliability requirement to components
    const totalFailureRate = 1e6 / totalMTBF;
    const componentCount = components.length;

    // Equal allocation (simplified)
    const allocatedFailureRate = totalFailureRate / componentCount;

    return components.map(component => ({
      id: `alloc_${component.id}`,
      componentId: component.id,
      mtbf: 1e6 / allocatedFailureRate,
      mttr: 4,
      availability: ((1e6 / allocatedFailureRate) / ((1e6 / allocatedFailureRate) + 4)) * 100,
      reliability: Math.exp(-allocatedFailureRate * 8760 / 1e6),
      failureRate: allocatedFailureRate,
      confidence: 0.8,
      testHours: 0,
      failureCount: 0
    }));
  }

  analyzeFailureData(failureData: Array<{ componentId: string; failureTime: number; failureMode: string }>): {
    weibullAnalysis: {
      shape: number;
      scale: number;
      characteristicLife: number;
    };
    trendAnalysis: {
      trend: 'improving' | 'stable' | 'degrading';
      confidence: number;
    };
    recommendations: string[];
  } {
    // Weibull analysis for failure distribution
    const times = failureData.map(d => d.failureTime).sort((a, b) => a - b);

    // Simplified Weibull parameter estimation
    const shape = 2.0; // Assumed shape parameter
    const scale = times[Math.floor(times.length * 0.63)] || 1000; // Scale parameter
    const characteristicLife = scale * Math.pow(Math.log(2), 1/shape);

    // Trend analysis
    const recentFailures = failureData.slice(-10);
    const earlyFailures = failureData.slice(0, 10);
    const recentRate = recentFailures.length / (recentFailures[recentFailures.length - 1]?.failureTime || 1);
    const earlyRate = earlyFailures.length / (earlyFailures[earlyFailures.length - 1]?.failureTime || 1);

    let trend: 'improving' | 'stable' | 'degrading' = 'stable';
    if (recentRate < earlyRate * 0.8) trend = 'improving';
    if (recentRate > earlyRate * 1.2) trend = 'degrading';

    const recommendations = [];
    if (trend === 'degrading') {
      recommendations.push('Investigate recent increase in failure rate');
      recommendations.push('Review maintenance procedures');
    }
    if (characteristicLife < 10000) {
      recommendations.push('Consider component replacement or redesign');
    }

    return {
      weibullAnalysis: {
        shape,
        scale,
        characteristicLife
      },
      trendAnalysis: {
        trend,
        confidence: 0.85
      },
      recommendations
    };
  }

  performMaintainabilityAnalysis(components: Component[]): {
    maintainabilityMetrics: Array<{
      componentId: string;
      mttr: number;
      accessibility: number; // 1-10 scale
      skillLevel: 'low' | 'medium' | 'high';
      tools: string[];
    }>;
    overallMTTR: number;
    maintenanceStrategy: string[];
  } {
    const maintainabilityMetrics = components.map(component => ({
      componentId: component.id,
      mttr: this.estimateMTTR(component),
      accessibility: Math.floor(Math.random() * 5) + 6, // 6-10
      skillLevel: this.determineSkillLevel(component),
      tools: this.requiredTools(component)
    }));

    const overallMTTR = maintainabilityMetrics.reduce((sum, metric) => sum + metric.mttr, 0) / maintainabilityMetrics.length;

    const maintenanceStrategy = [
      'Implement preventive maintenance schedule',
      'Train maintenance personnel on critical components',
      'Stock critical spare parts',
      'Develop detailed maintenance procedures',
      'Implement condition monitoring'
    ];

    return {
      maintainabilityMetrics,
      overallMTTR,
      maintenanceStrategy
    };
  }

  private estimateMTTR(component: Component): number {
    // Estimate Mean Time To Repair based on component complexity
    switch (component.category) {
      case 'resistor':
      case 'capacitor':
        return 0.5; // 30 minutes
      case 'integrated_circuit':
        return 2; // 2 hours
      case 'microcontroller':
        return 4; // 4 hours
      default:
        return 1; // 1 hour
    }
  }

  private determineSkillLevel(component: Component): 'low' | 'medium' | 'high' {
    switch (component.category) {
      case 'resistor':
      case 'capacitor':
      case 'diode':
        return 'low';
      case 'transistor':
      case 'integrated_circuit':
        return 'medium';
      case 'microcontroller':
      case 'dsp':
        return 'high';
      default:
        return 'medium';
    }
  }

  private requiredTools(component: Component): string[] {
    const tools = ['multimeter', 'soldering iron'];

    if (component.category === 'integrated_circuit') {
      tools.push('logic analyzer');
    }

    if (component.category === 'microcontroller') {
      tools.push('programmer', 'oscilloscope');
    }

    return tools;
  }

  getFMECAAnalysis(id: string): FMECAAnalysis | undefined {
    return this.fmecaAnalyses.get(id);
  }

  getReliabilityPrediction(id: string): ReliabilityPrediction | undefined {
    return this.predictions.get(id);
  }

  getReliabilityMetrics(id: string): ReliabilityMetrics | undefined {
    return this.metrics.get(id);
  }

  getAllFMECAAnalyses(): FMECAAnalysis[] {
    return Array.from(this.fmecaAnalyses.values());
  }

  getAllPredictions(): ReliabilityPrediction[] {
    return Array.from(this.predictions.values());
  }

  getAllMetrics(): ReliabilityMetrics[] {
    return Array.from(this.metrics.values());
  }
}

export const reliabilityAnalyzer = new ReliabilityAnalyzer();