import { Component } from '../../types';

export interface PerformanceIndicator {
  id: string;
  name: string;
  description: string;
  category: 'productivity' | 'quality' | 'efficiency' | 'effectiveness' | 'satisfaction' | 'financial' | 'operational' | 'strategic' | 'compliance' | 'innovation';
  type: 'ratio' | 'percentage' | 'count' | 'duration' | 'cost' | 'score' | 'index' | 'rate' | 'trend' | 'benchmark';
  unit: string;
  formula: string;
  parameters: Array<{
    name: string;
    description: string;
    source: 'database' | 'api' | 'calculation' | 'manual' | 'sensor';
    query?: string;
    defaultValue?: unknown;
    validation?: {
      type: 'number' | 'string' | 'date' | 'boolean';
      min?: number;
      max?: number;
      pattern?: string;
    };
  }>;
  targets: {
    baseline: number;
    target: number;
    stretch: number;
    timeframe: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
    direction: 'maximize' | 'minimize' | 'maintain' | 'range';
    range?: { min: number; max: number };
  };
  current: {
    value: number;
    timestamp: Date;
    confidence: number; // 0-100
    dataQuality: 'excellent' | 'good' | 'fair' | 'poor';
  };
  history: Array<{
    value: number;
    timestamp: Date;
    target: number;
    variance: number;
    trend: 'improving' | 'stable' | 'declining';
  }>;
  benchmarks: {
    industry: {
      average: number;
      percentile25: number;
      percentile75: number;
      best: number;
    };
    internal: {
      average: number;
      best: number;
      target: number;
    };
    competitors: Array<{
      name: string;
      value: number;
      source: string;
    }>;
  };
  alerts: Array<{
    id: string;
    name: string;
    condition: string;
    threshold: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    enabled: boolean;
    lastTriggered?: Date;
    cooldown: number; // minutes
  }>;
  correlations: Array<{
    indicatorId: string;
    correlation: number; // -1 to 1
    lag: number; // periods
    confidence: number;
    relationship: 'positive' | 'negative' | 'neutral';
  }>;
  drivers: Array<{
    factor: string;
    impact: number; // -1 to 1
    evidence: string;
    actions: string[];
  }>;
  metadata: {
    created: Date;
    updated: Date;
    owner: string;
    department: string;
    tags: string[];
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: 'active' | 'inactive' | 'deprecated';
    version: number;
  };
}

export interface PerformanceDashboard {
  id: string;
  name: string;
  description: string;
  scope: 'organization' | 'department' | 'team' | 'project' | 'individual';
  scopeId?: string;
  period: {
    type: 'rolling' | 'fixed' | 'custom';
    duration: number; // days, weeks, months
    startDate?: Date;
    endDate?: Date;
  };
  indicators: Array<{
    indicatorId: string;
    display: {
      chart: 'line' | 'bar' | 'gauge' | 'trend' | 'comparison' | 'heatmap';
      position: { x: number; y: number; width: number; height: number };
      color: string;
      showTarget: boolean;
      showBenchmark: boolean;
      showTrend: boolean;
    };
    weight: number;
  }>;
  summary: {
    overall: {
      score: number;
      grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
      trend: 'improving' | 'stable' | 'declining';
      change: number;
    };
    categories: Record<string, {
      score: number;
      indicators: number;
      trend: string;
    }>;
  };
  filters: {
    dateRange: boolean;
    categories: boolean;
    departments: boolean;
    owners: boolean;
    priorities: boolean;
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
    export: string[];
  };
  metadata: {
    created: Date;
    updated: Date;
    owner: string;
    starred: boolean;
    lastViewed: Date;
  };
}

export interface PerformanceReport {
  id: string;
  name: string;
  description: string;
  type: 'executive' | 'operational' | 'detailed' | 'trend' | 'benchmark' | 'custom';
  scope: PerformanceDashboard['scope'];
  scopeId?: string;
  period: PerformanceDashboard['period'];
  sections: Array<{
    title: string;
    type: 'summary' | 'charts' | 'tables' | 'insights' | 'recommendations' | 'raw_data';
    content: {
      indicators?: string[];
      filters?: Record<string, unknown>;
      format?: 'chart' | 'table' | 'text' | 'mixed';
      layout?: 'single' | 'grid' | 'tabs';
    };
    position: number;
  }>;
  styling: {
    theme: 'professional' | 'modern' | 'minimal' | 'colorful';
    logo?: string;
    colors: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
    };
    fonts: {
      heading: string;
      body: string;
      size: 'small' | 'medium' | 'large';
    };
    layout: {
      pageSize: 'a4' | 'letter' | 'legal';
      orientation: 'portrait' | 'landscape';
      margins: number;
    };
  };
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
    time: string;
    timezone: string;
    recipients: Array<{
      type: 'email' | 'webhook' | 'api';
      address: string;
      format: 'pdf' | 'excel' | 'html' | 'json';
    }>;
  };
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    lastGenerated?: Date;
    generationCount: number;
    averageGenerationTime: number;
  };
}

export interface PerformanceBenchmark {
  id: string;
  name: string;
  description: string;
  category: string;
  industry: string;
  source: 'gartner' | 'forrester' | 'mckinsey' | 'deloitte' | 'industry_survey' | 'internal_study' | 'custom';
  methodology: {
    sampleSize: number;
    collectionPeriod: {
      start: Date;
      end: Date;
    };
    segmentation: {
      by: 'company_size' | 'industry' | 'geography' | 'revenue' | 'custom';
      values: string[];
    };
    calculation: {
      method: 'mean' | 'median' | 'percentile' | 'regression' | 'custom';
      parameters: Record<string, unknown>;
    };
    validation: {
      confidence: number;
      marginOfError: number;
      statisticalTest: string;
    };
  };
  data: {
    overall: {
      mean: number;
      median: number;
      standardDeviation: number;
      min: number;
      max: number;
      percentiles: Record<number, number>;
    };
    segments: Record<string, {
      mean: number;
      median: number;
      count: number;
      confidence: number;
    }>;
    trends: Array<{
      period: string;
      value: number;
      change: number;
      significance: number;
    }>;
  };
  insights: Array<{
    type: 'strength' | 'weakness' | 'opportunity' | 'threat' | 'trend' | 'anomaly';
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    confidence: number;
    actions: string[];
  }>;
  metadata: {
    created: Date;
    updated: Date;
    author: string;
    version: string;
    citations: string[];
    access: 'public' | 'private' | 'restricted';
    cost?: number;
  };
}

export interface PerformanceInsight {
  id: string;
  title: string;
  description: string;
  type: 'correlation' | 'trend' | 'anomaly' | 'prediction' | 'benchmark' | 'driver' | 'opportunity' | 'risk';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  impact: {
    affected: string[];
    potential: 'high' | 'medium' | 'low';
    timeframe: 'immediate' | 'short_term' | 'medium_term' | 'long_term';
  };
  evidence: {
    indicators: string[];
    data: Record<string, unknown>;
    analysis: string;
    sources: string[];
  };
  recommendations: Array<{
    action: string;
    priority: 'high' | 'medium' | 'low';
    effort: 'high' | 'medium' | 'low';
    timeline: string;
    expectedImpact: number;
    owner?: string;
  }>;
  status: 'new' | 'acknowledged' | 'in_progress' | 'implemented' | 'rejected' | 'expired';
  metadata: {
    created: Date;
    updated: Date;
    discoveredBy: 'algorithm' | 'analyst' | 'system' | 'user';
    tags: string[];
    related: string[]; // related insight IDs
  };
}

export class PerformanceIndicatorsManager {
  private indicators: Map<string, PerformanceIndicator> = new Map();
  private dashboards: Map<string, PerformanceDashboard> = new Map();
  private reports: Map<string, PerformanceReport> = new Map();
  private benchmarks: Map<string, PerformanceBenchmark> = new Map();
  private insights: Map<string, PerformanceInsight> = new Map();

  createPerformanceIndicator(indicator: Omit<PerformanceIndicator, 'id' | 'current' | 'history' | 'alerts' | 'correlations' | 'drivers'>): PerformanceIndicator {
    const newIndicator: PerformanceIndicator = {
      ...indicator,
      id: `indicator_${Date.now()}`,
      current: {
        value: 0,
        timestamp: new Date(),
        confidence: 0,
        dataQuality: 'fair'
      },
      history: [],
      alerts: [],
      correlations: [],
      drivers: []
    };

    this.indicators.set(newIndicator.id, newIndicator);
    return newIndicator;
  }

  createPerformanceDashboard(dashboard: Omit<PerformanceDashboard, 'id' | 'summary'>): PerformanceDashboard {
    const newDashboard: PerformanceDashboard = {
      ...dashboard,
      id: `dashboard_${Date.now()}`,
      summary: {
        overall: {
          score: 0,
          grade: 'C',
          trend: 'stable',
          change: 0
        },
        categories: {}
      }
    };

    this.dashboards.set(newDashboard.id, newDashboard);
    return newDashboard;
  }

  createPerformanceReport(report: Omit<PerformanceReport, 'id' | 'metadata'>): PerformanceReport {
    const newReport: PerformanceReport = {
      ...report,
      id: `report_${Date.now()}`,
      metadata: {
        created: new Date(),
        updated: new Date(),
        createdBy: 'system',
        generationCount: 0,
        averageGenerationTime: 0
      }
    };

    this.reports.set(newReport.id, newReport);
    return newReport;
  }

  createPerformanceBenchmark(benchmark: Omit<PerformanceBenchmark, 'id'>): PerformanceBenchmark {
    const newBenchmark: PerformanceBenchmark = {
      ...benchmark,
      id: `benchmark_${Date.now()}`
    };

    this.benchmarks.set(newBenchmark.id, newBenchmark);
    return newBenchmark;
  }

  createPerformanceInsight(insight: Omit<PerformanceInsight, 'id'>): PerformanceInsight {
    const newInsight: PerformanceInsight = {
      ...insight,
      id: `insight_${Date.now()}`
    };

    this.insights.set(newInsight.id, newInsight);
    return newInsight;
  }

  calculateIndicatorValue(indicatorId: string, parameters?: Record<string, unknown>): Promise<IndicatorResult> {
    return new Promise((resolve) => {
      const indicator = this.indicators.get(indicatorId);
      if (!indicator) {
        resolve({ success: false, error: 'Performance indicator not found' });
        return;
      }

      // Simulate indicator calculation
      setTimeout(() => {
        const result = this.performIndicatorCalculation(indicator, parameters);

        // Update indicator current value
        indicator.current = result.current;
        indicator.history.push({
          value: result.current.value,
          timestamp: result.current.timestamp,
          target: indicator.targets.target,
          variance: result.current.value - indicator.targets.target,
          trend: result.trend
        });

        // Check for alerts
        const alerts = this.checkIndicatorAlerts(indicator);
        indicator.alerts.push(...alerts);

        resolve({
          success: true,
          indicatorId,
          value: result.current.value,
          target: indicator.targets.target,
          variance: result.variance,
          status: result.status,
          trend: result.trend,
          benchmark: result.benchmark,
          alertsTriggered: alerts.length,
          calculationTime: Date.now()
        });
      }, 300 + Math.random() * 700); // 0.3-1.0 seconds
    });
  }

  private performIndicatorCalculation(indicator: PerformanceIndicator, parameters?: Record<string, unknown>): {
    current: PerformanceIndicator['current'];
    variance: number;
    status: 'excellent' | 'good' | 'acceptable' | 'poor' | 'critical';
    trend: 'improving' | 'stable' | 'declining';
    benchmark: { position: string; percentile: number };
  } {
    // Simulate calculation based on indicator type and formula
    const baseValue = indicator.targets.baseline * (0.7 + Math.random() * 0.6); // 70-130% of baseline
    const target = indicator.targets.target;
    const variance = baseValue - target;

    // Determine status based on variance and direction
    let status: typeof indicator.history[0]['status'] = 'acceptable';
    const variancePercent = Math.abs(variance) / target;

    if (indicator.targets.direction === 'maximize') {
      if (variancePercent < 0.05) status = 'excellent';
      else if (variancePercent < 0.1) status = 'good';
      else if (variancePercent < 0.2) status = 'acceptable';
      else if (variancePercent < 0.3) status = 'poor';
      else status = 'critical';
    } else if (indicator.targets.direction === 'minimize') {
      if (variancePercent < 0.05) status = 'excellent';
      else if (variancePercent < 0.1) status = 'good';
      else if (variancePercent < 0.2) status = 'acceptable';
      else if (variancePercent < 0.3) status = 'poor';
      else status = 'critical';
    }

    // Calculate trend
    let trend: typeof indicator.history[0]['trend'] = 'stable';
    if (indicator.history.length > 1) {
      const recent = indicator.history.slice(-3);
      const avgRecent = recent.reduce((sum, h) => sum + h.value, 0) / recent.length;
      const avgOlder = indicator.history.slice(-6, -3).reduce((sum, h) => sum + h.value, 0) / 3;
      const changePercent = avgOlder !== 0 ? ((avgRecent - avgOlder) / avgOlder) * 100 : 0;

      if (changePercent > 5) trend = 'improving';
      else if (changePercent < -5) trend = 'declining';
    }

    // Calculate benchmark position
    const benchmarkValue = indicator.benchmarks.industry.average;
    const percentile = baseValue > benchmarkValue ?
      Math.min(100, 50 + ((baseValue - benchmarkValue) / benchmarkValue) * 50) :
      Math.max(0, 50 - ((benchmarkValue - baseValue) / benchmarkValue) * 50);

    let position = 'average';
    if (percentile >= 90) position = 'top_10';
    else if (percentile >= 75) position = 'top_25';
    else if (percentile >= 50) position = 'above_average';
    else if (percentile >= 25) position = 'below_average';
    else position = 'bottom_25';

    return {
      current: {
        value: baseValue,
        timestamp: new Date(),
        confidence: 85 + Math.random() * 10, // 85-95%
        dataQuality: 'good'
      },
      variance,
      status,
      trend,
      benchmark: { position, percentile }
    };
  }

  private checkIndicatorAlerts(indicator: PerformanceIndicator): PerformanceIndicator['alerts'] {
    const alerts: PerformanceIndicator['alerts'] = [];

    indicator.alerts.forEach(alert => {
      if (!alert.enabled) return;

      let triggered = false;
      const value = indicator.current.value;

      switch (alert.condition) {
        case 'value > threshold':
          triggered = value > alert.threshold;
          break;
        case 'value < threshold':
          triggered = value < alert.threshold;
          break;
        case 'variance > threshold':
          triggered = Math.abs(indicator.current.value - indicator.targets.target) > alert.threshold;
          break;
        case 'trend declining':
          triggered = indicator.current.trend === 'declining';
          break;
      }

      if (triggered && (!alert.lastTriggered || Date.now() - alert.lastTriggered.getTime() > alert.cooldown * 60 * 1000)) {
        alerts.push({
          id: `alert_${Date.now()}`,
          condition: alert.condition,
          threshold: alert.threshold,
          severity: alert.severity,
          triggered: new Date(),
          acknowledged: false,
          resolved: new Date(),
          action: `Review ${indicator.name} performance`
        });
        alert.lastTriggered = new Date();
      }
    });

    return alerts;
  }

  generatePerformanceInsights(scope: PerformanceDashboard['scope'], scopeId?: string, period?: { start: Date; end: Date }): Promise<InsightsResult> {
    return new Promise((resolve) => {
      // Simulate insights generation
      setTimeout(() => {
        const insights = this.performInsightsAnalysis(scope, scopeId, period);

        resolve({
          success: true,
          scope,
          scopeId,
          period: period || { start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), end: new Date() },
          insights: insights.map(insight => ({
            id: insight.id,
            title: insight.title,
            type: insight.type,
            severity: insight.severity,
            confidence: insight.confidence,
            impact: insight.impact,
            recommendations: insight.recommendations
          })),
          summary: {
            total: insights.length,
            byType: insights.reduce((acc, i) => {
              acc[i.type] = (acc[i.type] || 0) + 1;
              return acc;
            }, {} as Record<string, number>),
            bySeverity: insights.reduce((acc, i) => {
              acc[i.severity] = (acc[i.severity] || 0) + 1;
              return acc;
            }, {} as Record<string, number>)
          },
          generatedAt: Date.now()
        });
      }, 2000 + Math.random() * 3000); // 2-5 seconds
    });
  }

  private performInsightsAnalysis(scope: string, scopeId?: string, period?: { start: Date; end: Date }): PerformanceInsight[] {
    const insights: PerformanceInsight[] = [];

    // Generate sample insights
    insights.push({
      id: `insight_${Date.now()}_1`,
      title: 'Productivity Correlation with Team Size',
      description: 'Analysis shows 15% higher productivity in teams of 5-8 members compared to larger teams',
      type: 'correlation',
      severity: 'medium',
      confidence: 87,
      impact: {
        affected: ['productivity', 'team_efficiency'],
        potential: 'medium',
        timeframe: 'medium_term'
      },
      evidence: {
        indicators: ['productivity_index', 'team_size'],
        data: { correlation: 0.73, sample_size: 45 },
        analysis: 'Statistical analysis of 45 teams over 6 months',
        sources: ['internal_data', 'performance_logs']
      },
      recommendations: [
        {
          action: 'Optimize team sizes to 5-8 members where possible',
          priority: 'medium',
          effort: 'medium',
          timeline: '3 months',
          expectedImpact: 15,
          owner: 'team_lead'
        }
      ],
      status: 'new',
      metadata: {
        created: new Date(),
        updated: new Date(),
        discoveredBy: 'algorithm',
        tags: ['productivity', 'team_size', 'correlation'],
        related: []
      }
    });

    insights.push({
      id: `insight_${Date.now()}_2`,
      title: 'Quality Decline Trend',
      description: 'Defect rate has increased by 23% over the last quarter',
      type: 'trend',
      severity: 'high',
      confidence: 92,
      impact: {
        affected: ['quality', 'customer_satisfaction'],
        potential: 'high',
        timeframe: 'immediate'
      },
      evidence: {
        indicators: ['defect_rate', 'quality_score'],
        data: { change: 23, period: '3_months', trend: 'increasing' },
        analysis: 'Time series analysis with 95% confidence',
        sources: ['quality_metrics', 'defect_tracking']
      },
      recommendations: [
        {
          action: 'Implement additional quality checks in development pipeline',
          priority: 'high',
          effort: 'high',
          timeline: '2 weeks',
          expectedImpact: 20,
          owner: 'quality_manager'
        }
      ],
      status: 'new',
      metadata: {
        created: new Date(),
        updated: new Date(),
        discoveredBy: 'system',
        tags: ['quality', 'defects', 'trend'],
        related: []
      }
    });

    return insights;
  }

  getPerformanceIndicator(id: string): PerformanceIndicator | undefined {
    return this.indicators.get(id);
  }

  getPerformanceDashboard(id: string): PerformanceDashboard | undefined {
    return this.dashboards.get(id);
  }

  getPerformanceReport(id: string): PerformanceReport | undefined {
    return this.reports.get(id);
  }

  getPerformanceBenchmark(id: string): PerformanceBenchmark | undefined {
    return this.benchmarks.get(id);
  }

  getPerformanceInsight(id: string): PerformanceInsight | undefined {
    return this.insights.get(id);
  }

  getAllPerformanceIndicators(): PerformanceIndicator[] {
    return Array.from(this.indicators.values());
  }

  getAllPerformanceDashboards(): PerformanceDashboard[] {
    return Array.from(this.dashboards.values());
  }

  getAllPerformanceReports(): PerformanceReport[] {
    return Array.from(this.reports.values());
  }

  getAllPerformanceBenchmarks(): PerformanceBenchmark[] {
    return Array.from(this.benchmarks.values());
  }

  getAllPerformanceInsights(): PerformanceInsight[] {
    return Array.from(this.insights.values());
  }

  updatePerformanceIndicator(id: string, updates: Partial<PerformanceIndicator>): boolean {
    const indicator = this.indicators.get(id);
    if (!indicator) return false;

    Object.assign(indicator, updates);
    indicator.metadata.updated = new Date();
    return true;
  }

  deletePerformanceIndicator(id: string): boolean {
    return this.indicators.delete(id);
  }

  exportPerformanceIndicatorsConfiguration(): Record<string, unknown> {
    return {
      indicators: Array.from(this.indicators.values()),
      dashboards: Array.from(this.dashboards.values()),
      reports: Array.from(this.reports.values()),
      benchmarks: Array.from(this.benchmarks.values()),
      insights: Array.from(this.insights.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface IndicatorResult {
  success: boolean;
  error?: string;
  indicatorId?: string;
  value?: number;
  target?: number;
  variance?: number;
  status?: string;
  trend?: string;
  benchmark?: { position: string; percentile: number };
  alertsTriggered?: number;
  calculationTime?: number;
}

interface InsightsResult {
  success: boolean;
  error?: string;
  scope?: string;
  scopeId?: string;
  period?: { start: Date; end: Date };
  insights?: Array<{
    id: string;
    title: string;
    type: string;
    severity: string;
    confidence: number;
    impact: {
      affected: string[];
      potential: string;
      timeframe: string;
    };
    recommendations: Array<{
      action: string;
      priority: string;
      effort: string;
      timeline: string;
      expectedImpact: number;
      owner?: string;
    }>;
  }>;
  summary?: {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  };
  generatedAt?: number;
}

export const performanceIndicatorsManager = new PerformanceIndicatorsManager();