import { Component } from '../../types';

export interface SixSigmaProject {
  id: string;
  name: string;
  description: string;
  phase: 'define' | 'measure' | 'analyze' | 'improve' | 'control';
  belt: 'white' | 'yellow' | 'green' | 'black' | 'master_black';
  y: {
    description: string;
    unit: string;
    target: number;
    current: number;
    defectOpportunity: number;
  };
  xs: Array<{
    name: string;
    description: string;
    type: 'continuous' | 'discrete' | 'attribute';
    unit: string;
    specification: {
      lsl: number;
      usl: number;
      target: number;
    };
    current: {
      mean: number;
      stdDev: number;
      cp: number;
      cpk: number;
      sigma: number;
    };
  }>;
  team: Array<{
    name: string;
    role: 'champion' | 'black_belt' | 'green_belt' | 'team_member' | 'sponsor';
    responsibilities: string[];
  }>;
  timeline: {
    startDate: Date;
    targetCompletion: Date;
    actualCompletion?: Date;
    milestones: Array<{
      phase: string;
      description: string;
      dueDate: Date;
      completed: boolean;
      actualDate?: Date;
    }>;
  };
  define: {
    problemStatement: string;
    goalStatement: string;
    scope: {
      in: string[];
      out: string[];
      boundaries: string[];
    };
    stakeholders: Array<{
      name: string;
      role: string;
      influence: 'high' | 'medium' | 'low';
      interest: 'high' | 'medium' | 'low';
    }>;
    sipoc: {
      suppliers: string[];
      inputs: string[];
      process: string[];
      outputs: string[];
      customers: string[];
    };
  };
  measure: {
    dataCollection: {
      plan: string;
      methods: string[];
      sampleSize: number;
      frequency: string;
      duration: number; // weeks
    };
    baseline: {
      yMean: number;
      yStdDev: number;
      dpmo: number;
      sigma: number;
      capability: number;
    };
    measurementSystem: {
      gageRR: number;
      accuracy: number;
      precision: number;
      stability: number;
    };
  };
  analyze: {
    rootCause: {
      fishbone: {
        categories: Record<string, string[]>;
        primaryRootCause: string;
      };
      fiveWhy: Array<{
        why: string;
        answer: string;
        level: number;
      }>;
      pareto: {
        defects: Array<{
          type: string;
          count: number;
          percentage: number;
        }>;
        vitalFew: string[];
      };
    };
    hypothesisTests: Array<{
      test: string;
      nullHypothesis: string;
      alternativeHypothesis: string;
      pValue: number;
      significance: number;
      result: 'reject_null' | 'fail_reject_null';
      conclusion: string;
    }>;
    regression: {
      model: string;
      rSquared: number;
      significantFactors: string[];
      equation: string;
    };
  };
  improve: {
    solutions: Array<{
      id: string;
      description: string;
      type: 'process_change' | 'technology' | 'training' | 'design_change' | 'supplier_change';
      expectedImpact: number;
      effort: 'high' | 'medium' | 'low';
      cost: number;
      risk: 'high' | 'medium' | 'low';
      pilot: {
        planned: boolean;
        completed: boolean;
        results: Record<string, number>;
      };
      implementation: {
        status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
        startDate?: Date;
        completionDate?: Date;
        responsible: string;
      };
    }>;
    doe: {
      factors: string[];
      levels: number[];
      runs: number;
      results: Array<{
        run: number;
        factors: Record<string, number>;
        response: number;
      }>;
      optimalSettings: Record<string, number>;
      improvement: number;
    };
  };
  control: {
    controlPlan: Array<{
      characteristic: string;
      specification: {
        target: number;
        lsl: number;
        usl: number;
      };
      measurement: {
        method: string;
        frequency: string;
        responsible: string;
        sampleSize: number;
      };
      reaction: {
        condition: string;
        action: string;
        responsible: string;
      };
    }>;
    controlCharts: Array<{
      type: 'xbar_r' | 'xbar_s' | 'individuals' | 'p' | 'np' | 'c' | 'u';
      parameter: string;
      cl: number;
      ucl: number;
      lcl: number;
      rules: string[];
      violations: Array<{
        point: number;
        rule: string;
        date: Date;
        action: string;
      }>;
    }>;
    standardization: {
      procedures: string[];
      training: Array<{
        topic: string;
        audience: string;
        frequency: string;
        lastConducted?: Date;
      }>;
      documentation: string[];
    };
  };
  results: {
    sigmaLevel: number;
    dpmo: number;
    improvement: number; // percentage
    costSavings: number;
    benefits: {
      financial: number;
      operational: number;
      quality: number;
      customer: number;
    };
    sustainability: {
      score: number; // 1-5 scale
      monitoringPeriod: number; // months
      relapsePrevention: string[];
    };
  };
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'completed' | 'cancelled' | 'on_hold';
    priority: 'high' | 'medium' | 'low';
    tags: string[];
    budget: number;
    actualCost: number;
  };
}

export interface SixSigmaTool {
  id: string;
  name: string;
  category: 'data_analysis' | 'process_analysis' | 'measurement' | 'improvement' | 'control';
  description: string;
  phase: ('define' | 'measure' | 'analyze' | 'improve' | 'control')[];
  inputs: Array<{
    name: string;
    type: 'number' | 'text' | 'date' | 'file';
    required: boolean;
    description: string;
  }>;
  outputs: Array<{
    name: string;
    type: 'chart' | 'table' | 'report' | 'value';
    description: string;
  }>;
  template: Record<string, unknown>;
  examples: Array<{
    industry: string;
    application: string;
    results: string;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    author: string;
    version: string;
    usage: number;
    rating: number;
  };
}

export interface StatisticalProcessControl {
  id: string;
  name: string;
  description: string;
  process: string;
  parameter: string;
  unit: string;
  chartType: 'xbar_r' | 'xbar_s' | 'individuals' | 'p' | 'np' | 'c' | 'u' | 'ewma' | 'cusum';
  specification: {
    target: number;
    lsl: number;
    usl: number;
  };
  data: Array<{
    subgroup: number;
    values: number[];
    timestamp: Date;
    notes?: string;
  }>;
  controlLimits: {
    cl: number;
    ucl: number;
    lcl: number;
    calculated: Date;
    method: 'standard' | 'custom';
  };
  rules: Array<{
    name: string;
    description: string;
    condition: string;
    action: string;
    severity: 'warning' | 'alert' | 'critical';
  }>;
  violations: Array<{
    point: number;
    rule: string;
    value: number;
    timestamp: Date;
    action: string;
    resolved: boolean;
    resolution?: string;
  }>;
  capability: {
    cp: number;
    cpk: number;
    pp: number;
    ppk: number;
    sigma: number;
    lastCalculated: Date;
  };
  trends: {
    slope: number;
    direction: 'improving' | 'stable' | 'degrading';
    confidence: number;
    forecast: Array<{
      period: Date;
      predicted: number;
      confidenceInterval: { lower: number; upper: number };
    }>;
  };
  alerts: Array<{
    id: string;
    condition: string;
    threshold: number;
    enabled: boolean;
    lastTriggered?: Date;
    recipients: string[];
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'inactive' | 'archived';
    updateFrequency: 'real_time' | 'hourly' | 'daily' | 'weekly';
    lastUpdate: Date;
  };
}

export class SixSigmaManager {
  private projects: Map<string, SixSigmaProject> = new Map();
  private tools: Map<string, SixSigmaTool> = new Map();
  private spcCharts: Map<string, StatisticalProcessControl> = new Map();

  createSixSigmaProject(project: Omit<SixSigmaProject, 'id' | 'results'>): SixSigmaProject {
    const newProject: SixSigmaProject = {
      ...project,
      id: `six_sigma_${Date.now()}`,
      results: {
        sigmaLevel: 0,
        dpmo: 0,
        improvement: 0,
        costSavings: 0,
        benefits: {
          financial: 0,
          operational: 0,
          quality: 0,
          customer: 0
        },
        sustainability: {
          score: 0,
          monitoringPeriod: 12,
          relapsePrevention: []
        }
      }
    };

    this.projects.set(newProject.id, newProject);
    return newProject;
  }

  createSixSigmaTool(tool: Omit<SixSigmaTool, 'id'>): SixSigmaTool {
    const newTool: SixSigmaTool = {
      ...tool,
      id: `tool_${Date.now()}`
    };

    this.tools.set(newTool.id, newTool);
    return newTool;
  }

  createSPCChart(chart: Omit<StatisticalProcessControl, 'id' | 'controlLimits' | 'capability' | 'trends'>): StatisticalProcessControl {
    const newChart: StatisticalProcessControl = {
      ...chart,
      id: `spc_${Date.now()}`,
      controlLimits: {
        cl: 0,
        ucl: 0,
        lcl: 0,
        calculated: new Date(),
        method: 'standard'
      },
      capability: {
        cp: 0,
        cpk: 0,
        pp: 0,
        ppk: 0,
        sigma: 0,
        lastCalculated: new Date()
      },
      trends: {
        slope: 0,
        direction: 'stable',
        confidence: 0,
        forecast: []
      }
    };

    this.spcCharts.set(newChart.id, newChart);
    return newChart;
  }

  calculateControlLimits(chartId: string): Promise<ControlLimitsResult> {
    return new Promise((resolve) => {
      const chart = this.spcCharts.get(chartId);
      if (!chart) {
        resolve({ success: false, error: 'SPC chart not found' });
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

  private performControlLimitsCalculation(chart: StatisticalProcessControl): {
    controlLimits: StatisticalProcessControl['controlLimits'];
    capability: StatisticalProcessControl['capability'];
    stability: { inControl: boolean; violations: number; stabilityIndex: number };
  } {
    const allValues = chart.data.flatMap(d => d.values);
    const mean = allValues.reduce((sum, v) => sum + v, 0) / allValues.length;
    const stdDev = Math.sqrt(allValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / allValues.length);

    let cl: number, ucl: number, lcl: number;

    switch (chart.chartType) {
      case 'xbar_r':
      case 'xbar_s':
        // X-bar chart limits
        cl = mean;
        ucl = mean + 3 * (stdDev / Math.sqrt(chart.data[0]?.values.length || 1));
        lcl = mean - 3 * (stdDev / Math.sqrt(chart.data[0]?.values.length || 1));
        break;
      case 'individuals':
        cl = mean;
        ucl = mean + 3 * stdDev;
        lcl = mean - 3 * stdDev;
        break;
      case 'p':
      case 'np':
        // Proportion charts
        cl = mean;
        ucl = mean + 3 * Math.sqrt(mean * (1 - mean) / (chart.data[0]?.values.length || 1));
        lcl = Math.max(0, mean - 3 * Math.sqrt(mean * (1 - mean) / (chart.data[0]?.values.length || 1)));
        break;
      case 'c':
      case 'u':
        // Count charts
        cl = mean;
        ucl = mean + 3 * Math.sqrt(mean);
        lcl = Math.max(0, mean - 3 * Math.sqrt(mean));
        break;
      default:
        cl = mean;
        ucl = mean + 3 * stdDev;
        lcl = mean - 3 * stdDev;
    }

    // Calculate capability
    const { target, lsl, usl } = chart.specification;
    const cp = usl && lsl ? (usl - lsl) / (6 * stdDev) : 0;
    const cpu = usl ? (usl - mean) / (3 * stdDev) : Infinity;
    const cpl = lsl ? (mean - lsl) / (3 * stdDev) : Infinity;
    const cpk = Math.min(cpu, cpl);

    // Check stability
    const violations = chart.violations.length;
    const totalPoints = chart.data.length;
    const stabilityIndex = Math.max(0, 100 - (violations / totalPoints) * 100);

    return {
      controlLimits: {
        cl,
        ucl,
        lcl,
        calculated: new Date(),
        method: 'standard'
      },
      capability: {
        cp,
        cpk,
        pp: cp, // Simplified
        ppk: cpk, // Simplified
        sigma: cp, // Simplified
        lastCalculated: new Date()
      },
      stability: {
        inControl: violations === 0,
        violations,
        stabilityIndex
      }
    };
  }

  executeSixSigmaPhase(projectId: string, phase: SixSigmaProject['phase']): Promise<PhaseResult> {
    return new Promise((resolve) => {
      const project = this.projects.get(projectId);
      if (!project) {
        resolve({ success: false, error: 'Six Sigma project not found' });
        return;
      }

      // Simulate phase execution
      setTimeout(() => {
        const result = this.performPhaseExecution(project, phase);

        // Update project
        project.phase = phase;
        if (phase === 'control') {
          project.results = result.results!;
        }

        resolve({
          success: true,
          projectId,
          phase,
          deliverables: result.deliverables,
          results: result.results,
          nextPhase: result.nextPhase,
          executionTime: Date.now()
        });
      }, 2000 + Math.random() * 5000); // 2-7 seconds
    });
  }

  private performPhaseExecution(project: SixSigmaProject, phase: SixSigmaProject['phase']): {
    deliverables: string[];
    results?: SixSigmaProject['results'];
    nextPhase?: SixSigmaProject['phase'];
  } {
    switch (phase) {
      case 'define':
        return {
          deliverables: [
            'Problem statement',
            'Goal statement',
            'Project charter',
            'SIPOC diagram',
            'Stakeholder analysis'
          ],
          nextPhase: 'measure'
        };

      case 'measure':
        return {
          deliverables: [
            'Data collection plan',
            'Measurement system analysis',
            'Baseline capability analysis',
            'Process capability metrics'
          ],
          nextPhase: 'analyze'
        };

      case 'analyze':
        return {
          deliverables: [
            'Root cause analysis',
            'Hypothesis testing results',
            'Regression analysis',
            'Pareto analysis',
            'Fishbone diagram'
          ],
          nextPhase: 'improve'
        };

      case 'improve':
        return {
          deliverables: [
            'Solution selection',
            'DOE results',
            'Pilot study results',
            'Implementation plan',
            'Risk assessment'
          ],
          nextPhase: 'control'
        };

      case 'control':
        const improvement = Math.random() * 50 + 25; // 25-75% improvement
        const sigmaLevel = 3 + (improvement / 100) * 3; // 3-6 sigma

        return {
          deliverables: [
            'Control plan',
            'Standard operating procedures',
            'Training materials',
            'Control charts',
            'Monitoring procedures'
          ],
          results: {
            sigmaLevel,
            dpmo: Math.pow(10, (6 - sigmaLevel) * 0.5) * 1000000,
            improvement,
            costSavings: improvement * 10000,
            benefits: {
              financial: improvement * 8000,
              operational: improvement * 6000,
              quality: improvement * 4000,
              customer: improvement * 2000
            },
            sustainability: {
              score: 4 + Math.random(),
              monitoringPeriod: 12,
              relapsePrevention: [
                'Regular audits',
                'Training refreshers',
                'Performance monitoring'
              ]
            }
          }
        };

      default:
        return { deliverables: [] };
    }
  }

  getSixSigmaProject(id: string): SixSigmaProject | undefined {
    return this.projects.get(id);
  }

  getSixSigmaTool(id: string): SixSigmaTool | undefined {
    return this.tools.get(id);
  }

  getSPCChart(id: string): StatisticalProcessControl | undefined {
    return this.spcCharts.get(id);
  }

  getAllSixSigmaProjects(): SixSigmaProject[] {
    return Array.from(this.projects.values());
  }

  getAllSixSigmaTools(): SixSigmaTool[] {
    return Array.from(this.tools.values());
  }

  getAllSPCCharts(): StatisticalProcessControl[] {
    return Array.from(this.spcCharts.values());
  }

  updateSixSigmaProject(id: string, updates: Partial<SixSigmaProject>): boolean {
    const project = this.projects.get(id);
    if (!project) return false;

    Object.assign(project, updates);
    project.metadata.updated = new Date();
    return true;
  }

  deleteSixSigmaProject(id: string): boolean {
    return this.projects.delete(id);
  }

  exportSixSigmaConfiguration(): Record<string, unknown> {
    return {
      projects: Array.from(this.projects.values()),
      tools: Array.from(this.tools.values()),
      spcCharts: Array.from(this.spcCharts.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface ControlLimitsResult {
  success: boolean;
  error?: string;
  chartId?: string;
  controlLimits?: StatisticalProcessControl['controlLimits'];
  capability?: StatisticalProcessControl['capability'];
  stability?: { inControl: boolean; violations: number; stabilityIndex: number };
  calculationTime?: number;
}

interface PhaseResult {
  success: boolean;
  error?: string;
  projectId?: string;
  phase?: string;
  deliverables?: string[];
  results?: SixSigmaProject['results'];
  nextPhase?: string;
  executionTime?: number;
}

export const sixSigmaManager = new SixSigmaManager();