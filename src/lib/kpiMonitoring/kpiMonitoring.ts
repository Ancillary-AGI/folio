import { Component } from '../../types';

export interface KPI {
  id: string;
  name: string;
  description: string;
  category: 'financial' | 'operational' | 'quality' | 'customer' | 'employee' | 'innovation' | 'sustainability' | 'compliance' | 'project' | 'engineering';
  type: 'leading' | 'lagging' | 'diagnostic' | 'predictive';
  unit: string;
  target: {
    value: number;
    direction: 'higher_is_better' | 'lower_is_better' | 'target_range';
    range?: { min: number; max: number };
    timeframe: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  };
  calculation: {
    formula: string;
    parameters: Record<string, unknown>;
    dataSources: Array<{
      source: string;
      query: string;
      frequency: 'real_time' | 'hourly' | 'daily' | 'weekly';
    }>;
    aggregation: 'sum' | 'average' | 'count' | 'min' | 'max' | 'median' | 'percentile';
  };
  thresholds: {
    excellent: number;
    good: number;
    acceptable: number;
    poor: number;
    critical: number;
  };
  current: {
    value: number;
    timestamp: Date;
    trend: 'improving' | 'stable' | 'declining';
    change: number;
    changePercent: number;
  };
  history: Array<{
    value: number;
    timestamp: Date;
    target: number;
    status: 'excellent' | 'good' | 'acceptable' | 'poor' | 'critical';
  }>;
  alerts: Array<{
    id: string;
    condition: string;
    threshold: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    triggered: Date;
    acknowledged: boolean;
    resolved: Date;
    action: string;
  }>;
  owners: Array<{
    userId: string;
    role: 'primary' | 'secondary' | 'viewer';
    responsibilities: string[];
  }>;
  metadata: {
    created: Date;
    updated: Date;
    tags: string[];
    department: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: 'active' | 'inactive' | 'deprecated';
  };
}

export interface KPIScorecard {
  id: string;
  name: string;
  description: string;
  scope: 'organization' | 'department' | 'team' | 'project' | 'individual';
  scopeId?: string;
  period: {
    start: Date;
    end: Date;
    type: 'monthly' | 'quarterly' | 'yearly' | 'custom';
  };
  kpis: Array<{
    kpiId: string;
    weight: number;
    category: string;
    target: number;
  }>;
  overall: {
    score: number;
    grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
    trend: 'improving' | 'stable' | 'declining';
    change: number;
  };
  categories: Record<string, {
    score: number;
    weight: number;
    kpis: string[];
    grade: string;
  }>;
  benchmarks: {
    industry: {
      average: number;
      percentile: number;
      competitors: Array<{ name: string; score: number }>;
    };
    internal: {
      average: number;
      best: number;
      target: number;
    };
  };
  actions: Array<{
    id: string;
    kpiId: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    dueDate: Date;
    status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
    owner: string;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    reviewed: Date;
    reviewer: string;
  };
}

export interface KPIDashboard {
  id: string;
  name: string;
  description: string;
  layout: {
    type: 'grid' | 'masonry' | 'custom';
    columns: number;
    widgets: Array<{
      id: string;
      type: 'kpi_card' | 'trend_chart' | 'gauge' | 'table' | 'heatmap' | 'bullet_chart';
      position: { x: number; y: number; width: number; height: number };
      config: Record<string, unknown>;
    }>;
  };
  filters: {
    dateRange: { start: Date; end: Date };
    categories: string[];
    departments: string[];
    owners: string[];
  };
  refresh: {
    auto: boolean;
    interval: number; // seconds
    lastUpdate: Date;
  };
  permissions: {
    view: string[];
    edit: string[];
    share: string[];
  };
  metadata: {
    created: Date;
    updated: Date;
    owner: string;
    tags: string[];
  };
}

export interface KPIAlert {
  id: string;
  kpiId: string;
  name: string;
  description: string;
  condition: {
    type: 'value_threshold' | 'trend_change' | 'target_miss' | 'anomaly' | 'custom';
    operator: 'above' | 'below' | 'equals' | 'between' | 'outside' | 'change_percent';
    value: number;
    period?: number; // for trend analysis
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  recipients: Array<{
    type: 'user' | 'group' | 'email' | 'webhook';
    value: string;
    escalation?: {
      delay: number; // minutes
      recipients: string[];
    };
  }>;
  template: {
    subject: string;
    message: string;
    actions: Array<{
      label: string;
      url: string;
      type: 'primary' | 'secondary';
    }>;
  };
  schedule: {
    enabled: boolean;
    frequency: 'immediate' | 'hourly' | 'daily' | 'weekly';
    quietHours?: { start: string; end: string };
  };
  status: 'active' | 'inactive' | 'paused';
  history: Array<{
    triggered: Date;
    value: number;
    resolved: Date;
    action: string;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    lastTriggered?: Date;
  };
}

export interface KPIBenchmark {
  id: string;
  name: string;
  description: string;
  category: string;
  industry: string;
  source: 'internal' | 'industry_report' | 'competitor_data' | 'survey' | 'custom';
  data: {
    metric: string;
    unit: string;
    values: Array<{
      percentile: number;
      value: number;
      confidence: number;
    }>;
    trend: 'increasing' | 'stable' | 'decreasing';
    seasonality: boolean;
  };
  filters: {
    companySize?: string;
    industry?: string;
    geography?: string;
    period?: string;
  };
  methodology: {
    sampleSize: number;
    collectionMethod: string;
    calculationMethod: string;
    lastUpdated: Date;
    nextUpdate: Date;
  };
  insights: Array<{
    percentile: number;
    insight: string;
    recommendation: string;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    author: string;
    version: string;
    citations: string[];
  };
}

export class KPIMonitoringManager {
  private kpis: Map<string, KPI> = new Map();
  private scorecards: Map<string, KPIScorecard> = new Map();
  private dashboards: Map<string, KPIDashboard> = new Map();
  private alerts: Map<string, KPIAlert> = new Map();
  private benchmarks: Map<string, KPIBenchmark> = new Map();

  createKPI(kpi: Omit<KPI, 'id' | 'current' | 'history' | 'alerts'>): KPI {
    const newKPI: KPI = {
      ...kpi,
      id: `kpi_${Date.now()}`,
      current: {
        value: 0,
        timestamp: new Date(),
        trend: 'stable',
        change: 0,
        changePercent: 0
      },
      history: [],
      alerts: []
    };

    this.kpis.set(newKPI.id, newKPI);
    return newKPI;
  }

  createKPIScorecard(scorecard: Omit<KPIScorecard, 'id' | 'overall' | 'categories'>): KPIScorecard {
    const newScorecard: KPIScorecard = {
      ...scorecard,
      id: `scorecard_${Date.now()}`,
      overall: {
        score: 0,
        grade: 'C',
        trend: 'stable',
        change: 0
      },
      categories: {}
    };

    this.scorecards.set(newScorecard.id, newScorecard);
    return newScorecard;
  }

  createKPIDashboard(dashboard: Omit<KPIDashboard, 'id'>): KPIDashboard {
    const newDashboard: KPIDashboard = {
      ...dashboard,
      id: `dashboard_${Date.now()}`
    };

    this.dashboards.set(newDashboard.id, newDashboard);
    return newDashboard;
  }

  createKPIAlert(alert: Omit<KPIAlert, 'id' | 'history'>): KPIAlert {
    const newAlert: KPIAlert = {
      ...alert,
      id: `alert_${Date.now()}`,
      history: []
    };

    this.alerts.set(newAlert.id, newAlert);
    return newAlert;
  }

  createKPIBenchmark(benchmark: Omit<KPIBenchmark, 'id'>): KPIBenchmark {
    const newBenchmark: KPIBenchmark = {
      ...benchmark,
      id: `benchmark_${Date.now()}`
    };

    this.benchmarks.set(newBenchmark.id, newBenchmark);
    return newBenchmark;
  }

  calculateKPIValue(kpiId: string): Promise<KPIResult> {
    return new Promise((resolve) => {
      const kpi = this.kpis.get(kpiId);
      if (!kpi) {
        resolve({ success: false, error: 'KPI not found' });
        return;
      }

      // Simulate KPI calculation
      setTimeout(() => {
        const result = this.performKPICalculation(kpi);

        // Update KPI current value
        kpi.current = result.current;
        kpi.history.push({
          value: result.current.value,
          timestamp: result.current.timestamp,
          target: kpi.target.value,
          status: result.status
        });

        // Check for alerts
        const alerts = this.checkKPIAlerts(kpi);
        kpi.alerts.push(...alerts);

        resolve({
          success: true,
          kpiId,
          value: result.current.value,
          target: kpi.target.value,
          status: result.status,
          trend: result.current.trend,
          change: result.current.change,
          changePercent: result.current.changePercent,
          alertsTriggered: alerts.length,
          calculationTime: Date.now()
        });
      }, 500 + Math.random() * 1000); // 0.5-1.5 seconds
    });
  }

  private performKPICalculation(kpi: KPI): {
    current: KPI['current'];
    status: KPI['history'][0]['status'];
  } {
    // Simulate KPI calculation based on type and formula
    const baseValue = kpi.target.value * (0.8 + Math.random() * 0.4); // 80-120% of target
    const previousValue = kpi.history.length > 0 ? kpi.history[kpi.history.length - 1].value : kpi.target.value;

    const change = baseValue - previousValue;
    const changePercent = previousValue !== 0 ? (change / previousValue) * 100 : 0;

    let trend: KPI['current']['trend'] = 'stable';
    if (changePercent > 5) trend = 'improving';
    else if (changePercent < -5) trend = 'declining';

    let status: KPI['history'][0]['status'] = 'acceptable';
    if (baseValue >= kpi.thresholds.excellent) status = 'excellent';
    else if (baseValue >= kpi.thresholds.good) status = 'good';
    else if (baseValue >= kpi.thresholds.acceptable) status = 'acceptable';
    else if (baseValue >= kpi.thresholds.poor) status = 'poor';
    else status = 'critical';

    return {
      current: {
        value: baseValue,
        timestamp: new Date(),
        trend,
        change,
        changePercent
      },
      status
    };
  }

  private checkKPIAlerts(kpi: KPI): KPI['alerts'] {
    const alerts: KPI['alerts'] = [];

    // Check threshold alerts
    if (kpi.current.value <= kpi.thresholds.critical) {
      alerts.push({
        id: `alert_${Date.now()}_critical`,
        condition: `Value ${kpi.current.value} below critical threshold ${kpi.thresholds.critical}`,
        threshold: kpi.thresholds.critical,
        severity: 'critical',
        triggered: new Date(),
        acknowledged: false,
        resolved: new Date(),
        action: 'Immediate attention required'
      });
    } else if (kpi.current.value <= kpi.thresholds.poor) {
      alerts.push({
        id: `alert_${Date.now()}_poor`,
        condition: `Value ${kpi.current.value} below poor threshold ${kpi.thresholds.poor}`,
        threshold: kpi.thresholds.poor,
        severity: 'high',
        triggered: new Date(),
        acknowledged: false,
        resolved: new Date(),
        action: 'Review and improve performance'
      });
    }

    // Check trend alerts
    if (kpi.current.trend === 'declining' && Math.abs(kpi.current.changePercent) > 10) {
      alerts.push({
        id: `alert_${Date.now()}_trend`,
        condition: `Significant declining trend: ${kpi.current.changePercent.toFixed(1)}%`,
        threshold: 10,
        severity: 'medium',
        triggered: new Date(),
        acknowledged: false,
        resolved: new Date(),
        action: 'Investigate root cause'
      });
    }

    return alerts;
  }

  calculateScorecard(scorecardId: string): Promise<ScorecardResult> {
    return new Promise((resolve) => {
      const scorecard = this.scorecards.get(scorecardId);
      if (!scorecard) {
        resolve({ success: false, error: 'Scorecard not found' });
        return;
      }

      // Simulate scorecard calculation
      setTimeout(() => {
        const result = this.performScorecardCalculation(scorecard);

        scorecard.overall = result.overall;
        scorecard.categories = result.categories;

        resolve({
          success: true,
          scorecardId,
          overallScore: result.overall.score,
          grade: result.overall.grade,
          trend: result.overall.trend,
          categories: result.categories,
          actions: result.actions,
          calculationTime: Date.now()
        });
      }, 1000 + Math.random() * 2000); // 1-3 seconds
    });
  }

  private performScorecardCalculation(scorecard: KPIScorecard): {
    overall: KPIScorecard['overall'];
    categories: KPIScorecard['categories'];
    actions: KPIScorecard['actions'];
  } {
    const categories: Record<string, { score: number; weight: number; kpis: string[]; grade: string }> = {};
    let totalWeightedScore = 0;
    let totalWeight = 0;

    // Calculate category scores
    scorecard.kpis.forEach(kpi => {
      const kpiData = this.kpis.get(kpi.kpiId);
      if (!kpiData) return;

      if (!categories[kpi.category]) {
        categories[kpi.category] = { score: 0, weight: 0, kpis: [], grade: 'C' };
      }

      const kpiScore = this.calculateKPIScore(kpiData);
      categories[kpi.category].score += kpiScore * kpi.weight;
      categories[kpi.category].weight += kpi.weight;
      categories[kpi.category].kpis.push(kpi.kpiId);
    });

    // Normalize category scores and assign grades
    Object.keys(categories).forEach(category => {
      const cat = categories[category];
      cat.score = cat.weight > 0 ? cat.score / cat.weight : 0;
      cat.grade = this.assignGrade(cat.score);
      totalWeightedScore += cat.score * cat.weight;
      totalWeight += cat.weight;
    });

    const overallScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
    const grade = this.assignGrade(overallScore);

    // Generate actions based on poor performance
    const actions: KPIScorecard['actions'] = [];
    Object.entries(categories).forEach(([category, data]) => {
      if (data.score < 70) {
        actions.push({
          id: `action_${Date.now()}_${category}`,
          kpiId: data.kpis[0], // Use first KPI as representative
          description: `Improve ${category} performance from ${data.score.toFixed(1)}%`,
          priority: data.score < 50 ? 'high' : 'medium',
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          status: 'planned',
          owner: 'system'
        });
      }
    });

    return {
      overall: {
        score: overallScore,
        grade,
        trend: 'stable', // Would calculate based on historical data
        change: 0
      },
      categories,
      actions
    };
  }

  private calculateKPIScore(kpi: KPI): number {
    const target = kpi.target.value;
    const actual = kpi.current.value;

    if (kpi.target.direction === 'higher_is_better') {
      return Math.min(100, (actual / target) * 100);
    } else if (kpi.target.direction === 'lower_is_better') {
      return Math.min(100, (target / actual) * 100);
    } else {
      // Target range
      const range = kpi.target.range!;
      if (actual >= range.min && actual <= range.max) return 100;
      const distance = Math.min(Math.abs(actual - range.min), Math.abs(actual - range.max));
      return Math.max(0, 100 - (distance / (range.max - range.min)) * 100);
    }
  }

  private assignGrade(score: number): KPIScorecard['overall']['grade'] {
    if (score >= 95) return 'A+';
    if (score >= 90) return 'A';
    if (score >= 85) return 'B+';
    if (score >= 80) return 'B';
    if (score >= 75) return 'C+';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  triggerKPIAlert(alertId: string): Promise<AlertResult> {
    return new Promise((resolve) => {
      const alert = this.alerts.get(alertId);
      if (!alert) {
        resolve({ success: false, error: 'Alert not found' });
        return;
      }

      // Simulate alert triggering
      setTimeout(() => {
        const triggered = {
          triggered: new Date(),
          value: 0, // Would get actual KPI value
          resolved: new Date(),
          action: 'Alert sent to recipients'
        };

        alert.history.push(triggered);
        alert.metadata.lastTriggered = triggered.triggered;

        resolve({
          success: true,
          alertId,
          recipients: alert.recipients.length,
          severity: alert.severity,
          triggeredAt: triggered.triggered,
          triggerTime: Date.now()
        });
      }, 200 + Math.random() * 500); // 0.2-0.7 seconds
    });
  }

  getKPI(id: string): KPI | undefined {
    return this.kpis.get(id);
  }

  getKPIScorecard(id: string): KPIScorecard | undefined {
    return this.scorecards.get(id);
  }

  getKPIDashboard(id: string): KPIDashboard | undefined {
    return this.dashboards.get(id);
  }

  getKPIAlert(id: string): KPIAlert | undefined {
    return this.alerts.get(id);
  }

  getKPIBenchmark(id: string): KPIBenchmark | undefined {
    return this.benchmarks.get(id);
  }

  getAllKPIs(): KPI[] {
    return Array.from(this.kpis.values());
  }

  getAllKPIScorecards(): KPIScorecard[] {
    return Array.from(this.scorecards.values());
  }

  getAllKPIDashboards(): KPIDashboard[] {
    return Array.from(this.dashboards.values());
  }

  getAllKPIAlerts(): KPIAlert[] {
    return Array.from(this.alerts.values());
  }

  getAllKPIBenchmarks(): KPIBenchmark[] {
    return Array.from(this.benchmarks.values());
  }

  updateKPI(id: string, updates: Partial<KPI>): boolean {
    const kpi = this.kpis.get(id);
    if (!kpi) return false;

    Object.assign(kpi, updates);
    kpi.metadata.updated = new Date();
    return true;
  }

  deleteKPI(id: string): boolean {
    return this.kpis.delete(id);
  }

  exportKPIMonitoringConfiguration(): Record<string, unknown> {
    return {
      kpis: Array.from(this.kpis.values()),
      scorecards: Array.from(this.scorecards.values()),
      dashboards: Array.from(this.dashboards.values()),
      alerts: Array.from(this.alerts.values()),
      benchmarks: Array.from(this.benchmarks.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface KPIResult {
  success: boolean;
  error?: string;
  kpiId?: string;
  value?: number;
  target?: number;
  status?: string;
  trend?: string;
  change?: number;
  changePercent?: number;
  alertsTriggered?: number;
  calculationTime?: number;
}

interface ScorecardResult {
  success: boolean;
  error?: string;
  scorecardId?: string;
  overallScore?: number;
  grade?: string;
  trend?: string;
  categories?: Record<string, unknown>;
  actions?: unknown[];
  calculationTime?: number;
}

interface AlertResult {
  success: boolean;
  error?: string;
  alertId?: string;
  recipients?: number;
  severity?: string;
  triggeredAt?: Date;
  triggerTime?: number;
}

export const kpiMonitoringManager = new KPIMonitoringManager();