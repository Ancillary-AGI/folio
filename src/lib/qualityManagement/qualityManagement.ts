import { Component } from '../../types';

export interface QualityStandard {
  id: string;
  name: string;
  code: string;
  description: string;
  category: 'design' | 'manufacturing' | 'testing' | 'documentation' | 'process';
  requirements: Array<{
    id: string;
    clause: string;
    title: string;
    description: string;
    objectiveEvidence: string;
    verification: string;
    frequency: 'one_time' | 'periodic' | 'continuous';
  }>;
  controls: Array<{
    id: string;
    requirementId: string;
    type: 'preventive' | 'detective' | 'corrective';
    description: string;
    implementation: string;
    responsible: string;
    status: 'implemented' | 'planned' | 'not_applicable';
  }>;
  metrics: Array<{
    id: string;
    name: string;
    description: string;
    target: number;
    unit: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    responsible: string;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'superseded' | 'deprecated';
    version: string;
    tags: string[];
  };
}

export interface QualityControl {
  id: string;
  name: string;
  description: string;
  type: 'incoming' | 'in_process' | 'final' | 'audit';
  scope: {
    components: string[];
    processes: string[];
    specifications: Array<{
      parameter: string;
      target: number;
      tolerance: {
        upper: number;
        lower: number;
      };
      unit: string;
      critical: boolean;
    }>;
  };
  inspection: {
    method: 'visual' | 'dimensional' | 'functional' | 'performance' | 'automated';
    sampleSize: number;
    acceptanceCriteria: string;
    tools: string[];
    procedure: string;
  };
  results: Array<{
    id: string;
    batch: string;
    timestamp: Date;
    inspector: string;
    measurements: Record<string, number>;
    defects: Array<{
      type: string;
      severity: 'minor' | 'major' | 'critical';
      description: string;
      quantity: number;
    }>;
    disposition: 'accepted' | 'rejected' | 'conditional' | 'quarantined';
    notes: string;
  }>;
  statistics: {
    yield: number;
    defectRate: number;
    capability: {
      cp: number;
      cpk: number;
      pp: number;
      ppk: number;
    };
    trends: Array<{
      period: Date;
      yield: number;
      defectRate: number;
      majorDefects: number;
    }>;
  };
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'inactive' | 'superseded';
    tags: string[];
  };
}

export interface NonConformance {
  id: string;
  title: string;
  description: string;
  category: 'material' | 'process' | 'design' | 'documentation' | 'equipment' | 'training';
  severity: 'minor' | 'major' | 'critical';
  source: {
    component: string;
    batch: string;
    process: string;
    location: string;
    discovered: Date;
    discoveredBy: string;
  };
  investigation: {
    rootCause: string;
    contributingFactors: string[];
    evidence: string[];
    analysis: string;
  };
  correctiveAction: {
    description: string;
    responsible: string;
    dueDate: Date;
    status: 'open' | 'in_progress' | 'completed' | 'verified';
    verification: string;
    effectiveness: 'effective' | 'partially_effective' | 'ineffective' | 'pending';
  };
  preventiveAction: {
    description: string;
    responsible: string;
    dueDate: Date;
    status: 'open' | 'in_progress' | 'completed' | 'verified';
    scope: string;
  };
  impact: {
    cost: number;
    schedule: number; // days
    quality: 'low' | 'medium' | 'high';
    safety: 'low' | 'medium' | 'high';
  };
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'open' | 'closed' | 'escalated';
    tags: string[];
  };
}

export interface QualityMetrics {
  id: string;
  name: string;
  description: string;
  category: 'yield' | 'defect' | 'performance' | 'compliance' | 'efficiency';
  calculation: {
    formula: string;
    parameters: string[];
    frequency: 'real_time' | 'hourly' | 'daily' | 'weekly' | 'monthly';
    method: 'manual' | 'automated' | 'sampled';
  };
  targets: {
    nominal: number;
    upper: number;
    lower: number;
    unit: string;
  };
  current: {
    value: number;
    timestamp: Date;
    status: 'on_target' | 'warning' | 'critical' | 'unknown';
  };
  history: Array<{
    timestamp: Date;
    value: number;
    target: number;
    status: string;
  }>;
  alerts: Array<{
    condition: string;
    threshold: number;
    severity: 'low' | 'medium' | 'high';
    enabled: boolean;
    lastTriggered?: Date;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'inactive' | 'deprecated';
    tags: string[];
  };
}

export class QualityManagementManager {
  private standards: Map<string, QualityStandard> = new Map();
  private controls: Map<string, QualityControl> = new Map();
  private nonconformances: Map<string, NonConformance> = new Map();
  private metrics: Map<string, QualityMetrics> = new Map();

  createQualityStandard(standard: Omit<QualityStandard, 'id'>): QualityStandard {
    const newStandard: QualityStandard = {
      ...standard,
      id: `quality_standard_${Date.now()}`
    };

    this.standards.set(newStandard.id, newStandard);
    return newStandard;
  }

  createQualityControl(control: Omit<QualityControl, 'id'>): QualityControl {
    const newControl: QualityControl = {
      ...control,
      id: `quality_control_${Date.now()}`
    };

    this.controls.set(newControl.id, newControl);
    return newControl;
  }

  createNonConformance(nc: Omit<NonConformance, 'id'>): NonConformance {
    const newNC: NonConformance = {
      ...nc,
      id: `nonconformance_${Date.now()}`
    };

    this.nonconformances.set(newNC.id, newNC);
    return newNC;
  }

  createQualityMetrics(metrics: Omit<QualityMetrics, 'id'>): QualityMetrics {
    const newMetrics: QualityMetrics = {
      ...metrics,
      id: `quality_metrics_${Date.now()}`
    };

    this.metrics.set(newMetrics.id, newMetrics);
    return newMetrics;
  }

  performQualityInspection(controlId: string, measurements: Record<string, number>): Promise<InspectionResult> {
    return new Promise((resolve) => {
      const control = this.controls.get(controlId);
      if (!control) {
        resolve({ success: false, error: 'Quality control not found' });
        return;
      }

      // Simulate inspection
      setTimeout(() => {
        const result = this.evaluateInspection(control, measurements);

        // Add result to control
        control.results.push({
          id: `result_${Date.now()}`,
          batch: `batch_${Date.now()}`,
          timestamp: new Date(),
          inspector: 'System',
          measurements,
          defects: result.defects,
          disposition: result.disposition,
          notes: result.notes
        });

        // Update statistics
        this.updateQualityStatistics(control);

        resolve({
          success: true,
          controlId,
          disposition: result.disposition,
          defects: result.defects.length,
          yield: result.yield,
          inspectionTime: Date.now()
        });
      }, 2000 + Math.random() * 3000); // 2-5 seconds
    });
  }

  private evaluateInspection(control: QualityControl, measurements: Record<string, number>): {
    defects: QualityControl['results'][0]['defects'];
    disposition: QualityControl['results'][0]['disposition'];
    notes: string;
    yield: number;
  } {
    const defects: QualityControl['results'][0]['defects'] = [];
    let defectCount = 0;

    // Check each specification
    control.scope.specifications.forEach(spec => {
      const value = measurements[spec.parameter];
      if (value !== undefined) {
        const isOutOfTolerance = value < spec.tolerance.lower || value > spec.tolerance.upper;

        if (isOutOfTolerance) {
          defects.push({
            type: spec.parameter,
            severity: spec.critical ? 'critical' : 'major',
            description: `${spec.parameter} out of tolerance: ${value} ${spec.unit}`,
            quantity: 1
          });
          defectCount++;
        }
      }
    });

    // Determine disposition
    const defectRate = defectCount / control.scope.specifications.length;
    let disposition: QualityControl['results'][0]['disposition'];
    let notes: string;

    if (defectRate === 0) {
      disposition = 'accepted';
      notes = 'All specifications met';
    } else if (defectRate <= 0.1) {
      disposition = 'conditional';
      notes = 'Minor defects found, conditional acceptance';
    } else {
      disposition = 'rejected';
      notes = 'Too many defects, rejected';
    }

    const yield = Math.max(0, 1 - defectRate);

    return { defects, disposition, notes, yield };
  }

  private updateQualityStatistics(control: QualityControl): void {
    const results = control.results.slice(-100); // Last 100 results
    const totalInspections = results.length;
    const accepted = results.filter(r => r.disposition === 'accepted').length;
    const yield = totalInspections > 0 ? accepted / totalInspections : 0;

    const totalDefects = results.reduce((sum, r) => sum + r.defects.length, 0);
    const defectRate = totalInspections > 0 ? totalDefects / totalInspections : 0;

    // Calculate capability indices (simplified)
    const values = results.flatMap(r =>
      control.scope.specifications.map(spec => r.measurements[spec.parameter]).filter(v => v !== undefined)
    );

    if (values.length > 0) {
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);

      // Simplified capability calculation
      const specWidth = 6; // Assume 6-sigma spec width
      const cp = specWidth / (6 * stdDev);
      const cpk = cp; // Simplified

      control.statistics = {
        yield,
        defectRate,
        capability: {
          cp,
          cpk,
          pp: cp,
          ppk: cpk
        },
        trends: control.statistics.trends.slice(-50).concat({
          period: new Date(),
          yield,
          defectRate,
          majorDefects: results.filter(r => r.defects.some(d => d.severity === 'major')).length
        })
      };
    }
  }

  analyzeQualityMetrics(metricsId: string): Promise<MetricsAnalysis> {
    return new Promise((resolve) => {
      const metrics = this.metrics.get(metricsId);
      if (!metrics) {
        resolve({ success: false, error: 'Quality metrics not found' });
        return;
      }

      // Simulate analysis
      setTimeout(() => {
        const analysis = this.performMetricsAnalysis(metrics);

        // Update metrics
        metrics.current = analysis.current;
        metrics.history = analysis.history;

        resolve({
          success: true,
          metricsId,
          status: analysis.current.status,
          trend: analysis.trend,
          alerts: analysis.alertsTriggered,
          analysisTime: Date.now()
        });
      }, 1500 + Math.random() * 2000); // 1.5-3.5 seconds
    });
  }

  private performMetricsAnalysis(metrics: QualityMetrics): {
    current: QualityMetrics['current'];
    history: QualityMetrics['history'];
    trend: 'improving' | 'stable' | 'degrading';
    alertsTriggered: number;
  } {
    // Generate sample data
    const currentValue = metrics.targets.nominal + (Math.random() - 0.5) * (metrics.targets.upper - metrics.targets.lower) * 0.5;
    const status = currentValue >= metrics.targets.lower && currentValue <= metrics.targets.upper ? 'on_target' :
                  currentValue >= metrics.targets.lower * 0.9 && currentValue <= metrics.targets.upper * 1.1 ? 'warning' : 'critical';

    const current: QualityMetrics['current'] = {
      value: currentValue,
      timestamp: new Date(),
      status
    };

    // Add to history
    const history = metrics.history.slice(-99).concat({
      timestamp: new Date(),
      value: currentValue,
      target: metrics.targets.nominal,
      status
    });

    // Determine trend
    const recent = history.slice(-10);
    const avgRecent = recent.reduce((sum, h) => sum + h.value, 0) / recent.length;
    const avgOlder = history.slice(-20, -10).reduce((sum, h) => sum + h.value, 0) / Math.min(10, history.length - 10) || avgRecent;

    let trend: 'improving' | 'stable' | 'degrading';
    if (Math.abs(avgRecent - avgOlder) < metrics.targets.nominal * 0.01) {
      trend = 'stable';
    } else if (avgRecent > avgOlder) {
      trend = metrics.targets.nominal > avgOlder ? 'improving' : 'degrading';
    } else {
      trend = metrics.targets.nominal < avgOlder ? 'improving' : 'degrading';
    }

    // Check alerts
    let alertsTriggered = 0;
    metrics.alerts.forEach(alert => {
      if (alert.enabled) {
        let triggered = false;
        switch (alert.condition) {
          case 'above':
            triggered = currentValue > alert.threshold;
            break;
          case 'below':
            triggered = currentValue < alert.threshold;
            break;
          case 'outside_range':
            triggered = currentValue < metrics.targets.lower || currentValue > metrics.targets.upper;
            break;
        }
        if (triggered) {
          alert.lastTriggered = new Date();
          alertsTriggered++;
        }
      }
    });

    return { current, history, trend, alertsTriggered };
  }

  getQualityStandard(id: string): QualityStandard | undefined {
    return this.standards.get(id);
  }

  getQualityControl(id: string): QualityControl | undefined {
    return this.controls.get(id);
  }

  getNonConformance(id: string): NonConformance | undefined {
    return this.nonconformances.get(id);
  }

  getQualityMetrics(id: string): QualityMetrics | undefined {
    return this.metrics.get(id);
  }

  getAllQualityStandards(): QualityStandard[] {
    return Array.from(this.standards.values());
  }

  getAllQualityControls(): QualityControl[] {
    return Array.from(this.controls.values());
  }

  getAllNonConformances(): NonConformance[] {
    return Array.from(this.nonconformances.values());
  }

  getAllQualityMetrics(): QualityMetrics[] {
    return Array.from(this.metrics.values());
  }

  updateQualityStandard(id: string, updates: Partial<QualityStandard>): boolean {
    const standard = this.standards.get(id);
    if (!standard) return false;

    Object.assign(standard, updates);
    standard.metadata.updated = new Date();
    return true;
  }

  deleteQualityStandard(id: string): boolean {
    return this.standards.delete(id);
  }

  exportQualityManagementConfiguration(): Record<string, unknown> {
    return {
      standards: Array.from(this.standards.values()),
      controls: Array.from(this.controls.values()),
      nonconformances: Array.from(this.nonconformances.values()),
      metrics: Array.from(this.metrics.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface InspectionResult {
  success: boolean;
  error?: string;
  controlId?: string;
  disposition?: string;
  defects?: number;
  yield?: number;
  inspectionTime?: number;
}

interface MetricsAnalysis {
  success: boolean;
  error?: string;
  metricsId?: string;
  status?: string;
  trend?: string;
  alerts?: number;
  analysisTime?: number;
}

export const qualityManagementManager = new QualityManagementManager();