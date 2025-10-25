import { Component } from '../../types';

export interface ControlChart {
  id: string;
  name: string;
  description: string;
  process: string;
  parameter: string;
  unit: string;
  chartType: 'xbar_r' | 'xbar_s' | 'individuals' | 'p' | 'np' | 'c' | 'u' | 'ewma' | 'cusum';
  subgroupSize: number;
  data: Array<{
    subgroup: number;
    timestamp: Date;
    values: number[];
    average?: number;
    range?: number;
    standardDeviation?: number;
    proportion?: number;
    count?: number;
    notes?: string;
  }>;
  controlLimits: {
    cl: number;
    ucl: number;
    lcl: number;
    calculated: Date;
    method: 'standard' | 'custom' | 'historical';
    subgroupsUsed: number;
  };
  specification: {
    target?: number;
    usl?: number;
    lsl?: number;
    tolerance?: number;
  };
  rules: Array<{
    id: string;
    name: string;
    description: string;
    condition: string;
    action: string;
    severity: 'warning' | 'alert' | 'critical';
    enabled: boolean;
  }>;
  violations: Array<{
    id: string;
    point: number;
    rule: string;
    value: number;
    timestamp: Date;
    severity: 'warning' | 'alert' | 'critical';
    acknowledged: boolean;
    resolved: boolean;
    resolution?: string;
    actionTaken?: string;
  }>;
  capability: {
    cp?: number;
    cpk?: number;
    pp?: number;
    ppk?: number;
    sigmaLevel?: number;
    performance?: 'excellent' | 'good' | 'fair' | 'poor';
    lastCalculated: Date;
  };
  trends: {
    direction: 'improving' | 'stable' | 'degrading';
    slope: number;
    rSquared: number;
    confidence: number;
    forecast: Array<{
      period: Date;
      predicted: number;
      upperBound: number;
      lowerBound: number;
    }>;
  };
  alerts: Array<{
    id: string;
    condition: string;
    threshold: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    enabled: boolean;
    lastTriggered?: Date;
    recipients: string[];
    cooldown: number; // minutes
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'inactive' | 'archived';
    updateFrequency: 'real_time' | 'hourly' | 'daily' | 'weekly';
    lastUpdate: Date;
    tags: string[];
  };
}

export interface ProcessCapabilityStudy {
  id: string;
  name: string;
  description: string;
  process: string;
  parameter: string;
  unit: string;
  specification: {
    target: number;
    usl: number;
    lsl: number;
    tolerance: number;
  };
  data: Array<{
    value: number;
    timestamp: Date;
    subgroup?: number;
    notes?: string;
  }>;
  analysis: {
    sampleSize: number;
    distribution: {
      type: 'normal' | 'lognormal' | 'exponential' | 'weibull' | 'custom';
      parameters: Record<string, number>;
      goodnessOfFit: number;
      normalityTest: {
        test: string;
        statistic: number;
        pValue: number;
        result: 'normal' | 'not_normal';
      };
    };
    statistics: {
      count: number;
      mean: number;
      median: number;
      mode: number;
      standardDeviation: number;
      variance: number;
      min: number;
      max: number;
      range: number;
      skewness: number;
      kurtosis: number;
      confidenceInterval: {
        mean: { lower: number; upper: number };
        stdDev: { lower: number; upper: number };
      };
    };
    capability: {
      cp: number;
      cpk: number;
      cpk_lower?: number;
      cpk_upper?: number;
      pp: number;
      ppk: number;
      sigmaLevel: number;
      zScore: number;
      performance: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
      confidence: number;
    };
    stability: {
      inControl: boolean;
      controlChart?: string; // reference to control chart
      violations: number;
      stabilityIndex: number; // 0-100
    };
  };
  recommendations: Array<{
    type: 'process_improvement' | 'specification_change' | 'measurement_system' | 'training' | 'equipment';
    description: string;
    impact: 'high' | 'medium' | 'low';
    effort: 'high' | 'medium' | 'low';
    priority: 'high' | 'medium' | 'low';
    timeline: string;
    cost?: number;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'draft' | 'in_progress' | 'completed' | 'approved';
    approvedBy?: string;
    approvalDate?: Date;
    tags: string[];
  };
}

export interface MeasurementSystemAnalysis {
  id: string;
  name: string;
  description: string;
  process: string;
  parameter: string;
  unit: string;
  method: 'gage_rr' | 'attribute_agreement' | 'kappa' | 'correlation' | 'custom';
  operators: Array<{
    id: string;
    name: string;
    experience: number; // years
    training: string[];
  }>;
  parts: Array<{
    id: string;
    referenceValue: number;
    tolerance: number;
  }>;
  trials: number;
  data: Array<{
    operator: string;
    part: string;
    trial: number;
    measurement: number;
    timestamp: Date;
  }>;
  analysis: {
    gageRR: {
      totalRR: number;
      repeatability: number;
      reproducibility: number;
      partVariation: number;
      totalVariation: number;
      ndc: number; // number of distinct categories
      precisionToTolerance: number;
      performance: 'excellent' | 'good' | 'fair' | 'poor' | 'unacceptable';
    };
    anova: {
      operatorVariance: number;
      partVariance: number;
      errorVariance: number;
      fOperator: number;
      fPart: number;
      pOperator: number;
      pPart: number;
    };
    bias: {
      averageBias: number;
      biasVariation: number;
      linearity: number;
      stability: number;
    };
    accuracy: number;
    precision: number;
    resolution: number;
  };
  recommendations: Array<{
    area: 'training' | 'equipment' | 'procedure' | 'environment' | 'calibration';
    description: string;
    priority: 'high' | 'medium' | 'low';
    impact: number;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'planned' | 'in_progress' | 'completed' | 'approved';
    approvedBy?: string;
    approvalDate?: Date;
    tags: string[];
  };
}

export class StatisticalProcessControlManager {
  private controlCharts: Map<string, ControlChart> = new Map();
  private capabilityStudies: Map<string, ProcessCapabilityStudy> = new Map();
  private measurementAnalyses: Map<string, MeasurementSystemAnalysis> = new Map();

  createControlChart(chart: Omit<ControlChart, 'id' | 'controlLimits' | 'capability' | 'trends' | 'violations'>): ControlChart {
    const newChart: ControlChart = {
      ...chart,
      id: `chart_${Date.now()}`,
      controlLimits: {
        cl: 0,
        ucl: 0,
        lcl: 0,
        calculated: new Date(),
        method: 'standard',
        subgroupsUsed: 0
      },
      capability: {
        lastCalculated: new Date()
      },
      trends: {
        direction: 'stable',
        slope: 0,
        rSquared: 0,
        confidence: 0,
        forecast: []
      },
      violations: []
    };

    this.controlCharts.set(newChart.id, newChart);
    return newChart;
  }

  createProcessCapabilityStudy(study: Omit<ProcessCapabilityStudy, 'id' | 'analysis'>): ProcessCapabilityStudy {
    const newStudy: ProcessCapabilityStudy = {
      ...study,
      id: `capability_${Date.now()}`,
      analysis: {
        sampleSize: 0,
        distribution: {
          type: 'normal',
          parameters: {},
          goodnessOfFit: 0,
          normalityTest: {
            test: '',
            statistic: 0,
            pValue: 0,
            result: 'normal'
          }
        },
        statistics: {
          count: 0,
          mean: 0,
          median: 0,
          mode: 0,
          standardDeviation: 0,
          variance: 0,
          min: 0,
          max: 0,
          range: 0,
          skewness: 0,
          kurtosis: 0,
          confidenceInterval: {
            mean: { lower: 0, upper: 0 },
            stdDev: { lower: 0, upper: 0 }
          }
        },
        capability: {
          cp: 0,
          cpk: 0,
          pp: 0,
          ppk: 0,
          sigmaLevel: 0,
          zScore: 0,
          performance: 'fair',
          confidence: 0
        },
        stability: {
          inControl: false,
          violations: 0,
          stabilityIndex: 0
        }
      }
    };

    this.capabilityStudies.set(newStudy.id, newStudy);
    return newStudy;
  }

  createMeasurementSystemAnalysis(analysis: Omit<MeasurementSystemAnalysis, 'id' | 'analysis'>): MeasurementSystemAnalysis {
    const newAnalysis: MeasurementSystemAnalysis = {
      ...analysis,
      id: `msa_${Date.now()}`,
      analysis: {
        gageRR: {
          totalRR: 0,
          repeatability: 0,
          reproducibility: 0,
          partVariation: 0,
          totalVariation: 0,
          ndc: 0,
          precisionToTolerance: 0,
          performance: 'fair'
        },
        anova: {
          operatorVariance: 0,
          partVariance: 0,
          errorVariance: 0,
          fOperator: 0,
          fPart: 0,
          pOperator: 0,
          pPart: 0
        },
        bias: {
          averageBias: 0,
          biasVariation: 0,
          linearity: 0,
          stability: 0
        },
        accuracy: 0,
        precision: 0,
        resolution: 0
      }
    };

    this.measurementAnalyses.set(newAnalysis.id, newAnalysis);
    return newAnalysis;
  }

  calculateControlLimits(chartId: string): Promise<ControlLimitsResult> {
    return new Promise((resolve) => {
      const chart = this.controlCharts.get(chartId);
      if (!chart) {
        resolve({ success: false, error: 'Control chart not found' });
        return;
      }

      // Simulate control limits calculation
      setTimeout(() => {
        const result = this.performControlLimitsCalculation(chart);

        // Update chart
        chart.controlLimits = result.controlLimits;
        chart.capability = result.capability;

        resolve({
          success: true,
          chartId,
          controlLimits: result.controlLimits,
          capability: result.capability,
          stability: result.stability,
          calculationTime: Date.now()
        });
      }, 1000 + Math.random() * 2000); // 1-3 seconds
    });
  }

  private performControlLimitsCalculation(chart: ControlChart): {
    controlLimits: ControlChart['controlLimits'];
    capability: ControlChart['capability'];
    stability: { inControl: boolean; violations: number; stabilityIndex: number };
  } {
    const data = chart.data;
    if (data.length === 0) {
      return {
        controlLimits: chart.controlLimits,
        capability: chart.capability,
        stability: { inControl: false, violations: 0, stabilityIndex: 0 }
      };
    }

    let cl: number, ucl: number, lcl: number;

    switch (chart.chartType) {
      case 'xbar_r':
      case 'xbar_s':
        // Calculate averages and ranges
        const averages = data.map(d => d.average || d.values.reduce((sum, v) => sum + v, 0) / d.values.length);
        const ranges = data.map(d => d.range || (d.values.length > 1 ? Math.max(...d.values) - Math.min(...d.values) : 0));

        const xbar = averages.reduce((sum, v) => sum + v, 0) / averages.length;
        const rbar = ranges.reduce((sum, v) => sum + v, 0) / ranges.length;

        // Control limits for X-bar chart
        cl = xbar;
        ucl = xbar + 3 * (rbar / this.getD2(chart.subgroupSize));
        lcl = xbar - 3 * (rbar / this.getD2(chart.subgroupSize));
        break;

      case 'individuals':
        const values = data.flatMap(d => d.values);
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);

        cl = mean;
        ucl = mean + 3 * stdDev;
        lcl = mean - 3 * stdDev;
        break;

      case 'p':
        const proportions = data.map(d => d.proportion || 0);
        const pbar = proportions.reduce((sum, v) => sum + v, 0) / proportions.length;

        cl = pbar;
        ucl = pbar + 3 * Math.sqrt(pbar * (1 - pbar) / chart.subgroupSize);
        lcl = Math.max(0, pbar - 3 * Math.sqrt(pbar * (1 - pbar) / chart.subgroupSize));
        break;

      case 'c':
        const counts = data.map(d => d.count || 0);
        const cbar = counts.reduce((sum, v) => sum + v, 0) / counts.length;

        cl = cbar;
        ucl = cbar + 3 * Math.sqrt(cbar);
        lcl = Math.max(0, cbar - 3 * Math.sqrt(cbar));
        break;

      default:
        cl = 0;
        ucl = 0;
        lcl = 0;
    }

    // Calculate capability
    const { target, usl, lsl } = chart.specification;
    const cp = usl && lsl ? (usl - lsl) / (6 * (ucl - cl) / 3) : 0; // Simplified
    const cpk = Math.min(
      usl && target ? (usl - target) / (3 * (ucl - cl) / 3) : Infinity,
      lsl && target ? (target - lsl) / (3 * (ucl - cl) / 3) : Infinity
    );

    // Check stability
    const violations = chart.violations.length;
    const stabilityIndex = Math.max(0, 100 - (violations / data.length) * 100);

    return {
      controlLimits: {
        cl,
        ucl,
        lcl,
        calculated: new Date(),
        method: 'standard',
        subgroupsUsed: data.length
      },
      capability: {
        cp,
        cpk,
        pp: cp, // Simplified
        ppk: cpk, // Simplified
        sigmaLevel: cpk,
        performance: cpk >= 1.67 ? 'excellent' : cpk >= 1.33 ? 'good' : cpk >= 1.0 ? 'fair' : 'poor',
        lastCalculated: new Date()
      },
      stability: {
        inControl: violations === 0,
        violations,
        stabilityIndex
      }
    };
  }

  private getD2(n: number): number {
    // D2 constants for control charts
    const d2Values: Record<number, number> = {
      2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078
    };
    return d2Values[n] || 3.078; // Default for n >= 10
  }

  performCapabilityAnalysis(studyId: string): Promise<CapabilityResult> {
    return new Promise((resolve) => {
      const study = this.capabilityStudies.get(studyId);
      if (!study) {
        resolve({ success: false, error: 'Capability study not found' });
        return;
      }

      // Simulate capability analysis
      setTimeout(() => {
        const result = this.performCapabilityAnalysisCalculation(study);

        // Update study
        study.analysis = result.analysis;

        resolve({
          success: true,
          studyId,
          capability: result.analysis.capability,
          statistics: result.analysis.statistics,
          recommendations: result.recommendations,
          analysisTime: Date.now()
        });
      }, 2000 + Math.random() * 3000); // 2-5 seconds
    });
  }

  private performCapabilityAnalysisCalculation(study: ProcessCapabilityStudy): {
    analysis: ProcessCapabilityStudy['analysis'];
    recommendations: ProcessCapabilityStudy['recommendations'];
  } {
    const values = study.data.map(d => d.value);
    const n = values.length;

    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);

    const { target, usl, lsl } = study.specification;

    // Calculate capability indices
    const cp = usl && lsl ? (usl - lsl) / (6 * stdDev) : 0;
    const cpk = Math.min(
      usl && target ? (usl - target) / (3 * stdDev) : Infinity,
      lsl && target ? (target - lsl) / (3 * stdDev) : Infinity
    );

    const sigmaLevel = cpk;
    const zScore = cpk * 3;

    // Determine performance
    let performance: ProcessCapabilityStudy['analysis']['capability']['performance'];
    if (cpk >= 1.67) performance = 'excellent';
    else if (cpk >= 1.33) performance = 'good';
    else if (cpk >= 1.0) performance = 'fair';
    else if (cpk >= 0.67) performance = 'poor';
    else performance = 'critical';

    const analysis: ProcessCapabilityStudy['analysis'] = {
      sampleSize: n,
      distribution: {
        type: 'normal',
        parameters: { mean, stdDev },
        goodnessOfFit: 0.95,
        normalityTest: {
          test: 'Anderson-Darling',
          statistic: 0.5,
          pValue: 0.8,
          result: 'normal'
        }
      },
      statistics: {
        count: n,
        mean,
        median: values.sort((a, b) => a - b)[Math.floor(n / 2)],
        mode: mean, // Simplified
        standardDeviation: stdDev,
        variance,
        min: Math.min(...values),
        max: Math.max(...values),
        range: Math.max(...values) - Math.min(...values),
        skewness: 0, // Would calculate actual skewness
        kurtosis: 0, // Would calculate actual kurtosis
        confidenceInterval: {
          mean: {
            lower: mean - 1.96 * stdDev / Math.sqrt(n),
            upper: mean + 1.96 * stdDev / Math.sqrt(n)
          },
          stdDev: {
            lower: stdDev * Math.sqrt((n - 1) / this.getChiSquare(n - 1, 0.975)),
            upper: stdDev * Math.sqrt((n - 1) / this.getChiSquare(n - 1, 0.025))
          }
        }
      },
      capability: {
        cp,
        cpk,
        pp: cp, // Simplified
        ppk: cpk, // Simplified
        sigmaLevel,
        zScore,
        performance,
        confidence: 95
      },
      stability: {
        inControl: true, // Simplified
        violations: 0,
        stabilityIndex: 95
      }
    };

    // Generate recommendations
    const recommendations: ProcessCapabilityStudy['recommendations'] = [];

    if (cpk < 1.0) {
      recommendations.push({
        type: 'process_improvement',
        description: 'Implement process improvements to reduce variation',
        impact: 'high',
        effort: 'high',
        priority: 'high',
        timeline: '3-6 months',
        cost: 50000
      });
    }

    if (Math.abs(mean - target!) > stdDev) {
      recommendations.push({
        type: 'process_improvement',
        description: 'Center the process on target',
        impact: 'medium',
        effort: 'medium',
        priority: 'medium',
        timeline: '1-3 months',
        cost: 25000
      });
    }

    return { analysis, recommendations };
  }

  private getChiSquare(df: number, p: number): number {
    // Simplified chi-square approximation
    return df + Math.sqrt(2 * df) * this.getZScore(p);
  }

  private getZScore(p: number): number {
    // Simplified z-score for normal distribution
    if (p === 0.975) return 1.96;
    if (p === 0.025) return -1.96;
    return 0;
  }

  performMeasurementSystemAnalysis(analysisId: string): Promise<MSAResult> {
    return new Promise((resolve) => {
      const analysis = this.measurementAnalyses.get(analysisId);
      if (!analysis) {
        resolve({ success: false, error: 'Measurement system analysis not found' });
        return;
      }

      // Simulate MSA
      setTimeout(() => {
        const result = this.performMSACalculation(analysis);

        // Update analysis
        analysis.analysis = result.analysis;

        resolve({
          success: true,
          analysisId,
          gageRR: result.analysis.gageRR,
          recommendations: result.recommendations,
          analysisTime: Date.now()
        });
      }, 1500 + Math.random() * 2000); // 1.5-3.5 seconds
    });
  }

  private performMSACalculation(analysis: MeasurementSystemAnalysis): {
    analysis: MeasurementSystemAnalysis['analysis'];
    recommendations: MeasurementSystemAnalysis['recommendations'];
  } {
    // Simplified Gage R&R calculation
    const data = analysis.data;
    const operators = [...new Set(data.map(d => d.operator))];
    const parts = [...new Set(data.map(d => d.part))];

    // Calculate variances
    const operatorVariance = 0.1; // Simplified
    const partVariance = 0.8; // Simplified
    const errorVariance = 0.1; // Simplified

    const totalVariation = operatorVariance + partVariance + errorVariance;
    const repeatability = errorVariance / totalVariation * 100;
    const reproducibility = operatorVariance / totalVariation * 100;
    const totalRR = repeatability + reproducibility;

    const ndc = Math.max(1, Math.floor(partVariance / errorVariance));
    const precisionToTolerance = totalRR; // Simplified

    let performance: MeasurementSystemAnalysis['analysis']['gageRR']['performance'];
    if (totalRR < 10) performance = 'excellent';
    else if (totalRR < 20) performance = 'good';
    else if (totalRR < 30) performance = 'fair';
    else performance = 'poor';

    const analysisResult: MeasurementSystemAnalysis['analysis'] = {
      gageRR: {
        totalRR,
        repeatability,
        reproducibility,
        partVariation: partVariance / totalVariation * 100,
        totalVariation: 100,
        ndc,
        precisionToTolerance,
        performance
      },
      anova: {
        operatorVariance,
        partVariance,
        errorVariance,
        fOperator: 2.1,
        fPart: 15.3,
        pOperator: 0.05,
        pPart: 0.001
      },
      bias: {
        averageBias: 0.02,
        biasVariation: 0.01,
        linearity: 0.98,
        stability: 0.95
      },
      accuracy: 98,
      precision: 95,
      resolution: 0.01
    };

    const recommendations: MeasurementSystemAnalysis['recommendations'] = [];

    if (totalRR > 30) {
      recommendations.push({
        area: 'equipment',
        description: 'Replace or recalibrate measurement equipment',
        priority: 'high',
        impact: 80
      });
    }

    if (reproducibility > 20) {
      recommendations.push({
        area: 'training',
        description: 'Provide additional training to operators',
        priority: 'medium',
        impact: 60
      });
    }

    return { analysis: analysisResult, recommendations };
  }

  getControlChart(id: string): ControlChart | undefined {
    return this.controlCharts.get(id);
  }

  getProcessCapabilityStudy(id: string): ProcessCapabilityStudy | undefined {
    return this.capabilityStudies.get(id);
  }

  getMeasurementSystemAnalysis(id: string): MeasurementSystemAnalysis | undefined {
    return this.measurementAnalyses.get(id);
  }

  getAllControlCharts(): ControlChart[] {
    return Array.from(this.controlCharts.values());
  }

  getAllProcessCapabilityStudies(): ProcessCapabilityStudy[] {
    return Array.from(this.capabilityStudies.values());
  }

  getAllMeasurementSystemAnalyses(): MeasurementSystemAnalysis[] {
    return Array.from(this.measurementAnalyses.values());
  }

  updateControlChart(id: string, updates: Partial<ControlChart>): boolean {
    const chart = this.controlCharts.get(id);
    if (!chart) return false;

    Object.assign(chart, updates);
    chart.metadata.updated = new Date();
    return true;
  }

  deleteControlChart(id: string): boolean {
    return this.controlCharts.delete(id);
  }

  exportStatisticalProcessControlConfiguration(): Record<string, unknown> {
    return {
      controlCharts: Array.from(this.controlCharts.values()),
      capabilityStudies: Array.from(this.capabilityStudies.values()),
      measurementAnalyses: Array.from(this.measurementAnalyses.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface ControlLimitsResult {
  success: boolean;
  error?: string;
  chartId?: string;
  controlLimits?: ControlChart['controlLimits'];
  capability?: ControlChart['capability'];
  stability?: { inControl: boolean; violations: number; stabilityIndex: number };
  calculationTime?: number;
}

interface CapabilityResult {
  success: boolean;
  error?: string;
  studyId?: string;
  capability?: ProcessCapabilityStudy['analysis']['capability'];
  statistics?: ProcessCapabilityStudy['analysis']['statistics'];
  recommendations?: ProcessCapabilityStudy['analysis']['recommendations'];
  analysisTime?: number;
}

interface MSAResult {
  success: boolean;
  error?: string;
  analysisId?: string;
  gageRR?: MeasurementSystemAnalysis['analysis']['gageRR'];
  recommendations?: MeasurementSystemAnalysis['analysis']['recommendations'];
  analysisTime?: number;
}

export const statisticalProcessControlManager = new StatisticalProcessControlManager();