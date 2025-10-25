import { Component } from '../../types';

export interface AnalyticsEvent {
  id: string;
  timestamp: Date;
  userId: string;
  sessionId: string;
  eventType: string;
  category: 'user_action' | 'system_event' | 'performance' | 'error' | 'business';
  action: string;
  properties: Record<string, any>;
  context: {
    page: string;
    component?: string;
    project?: string;
    userAgent: string;
    ipAddress: string;
    device: {
      type: 'desktop' | 'mobile' | 'tablet';
      os: string;
      browser: string;
    };
    location?: {
      country: string;
      region: string;
      city: string;
    };
  };
  metrics: {
    duration?: number;
    value?: number;
    count?: number;
  };
}

export interface UserBehaviorAnalytics {
  userId: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalSessions: number;
    totalEvents: number;
    averageSessionDuration: number;
    mostUsedFeatures: Array<{
      feature: string;
      usageCount: number;
      timeSpent: number;
    }>;
    featureAdoption: Record<string, number>; // percentage of sessions using each feature
    userJourney: Array<{
      step: string;
      count: number;
      averageTime: number;
      dropOffRate: number;
    }>;
  };
  patterns: {
    peakUsageHours: number[];
    preferredDevices: Record<string, number>;
    commonWorkflows: Array<{
      workflow: string;
      frequency: number;
      averageCompletionTime: number;
    }>;
    painPoints: Array<{
      feature: string;
      issue: string;
      frequency: number;
      severity: 'low' | 'medium' | 'high';
    }>;
  };
  recommendations: string[];
}

export interface BusinessIntelligence {
  id: string;
  name: string;
  type: 'usage' | 'performance' | 'financial' | 'operational' | 'strategic';
  period: {
    start: Date;
    end: Date;
  };
  kpis: Array<{
    name: string;
    value: number;
    target?: number;
    trend: 'up' | 'down' | 'stable';
    change: number; // percentage
  }>;
  insights: Array<{
    category: string;
    title: string;
    description: string;
    impact: 'low' | 'medium' | 'high';
    confidence: number; // 0-100
    data: any;
  }>;
  forecasts: Array<{
    metric: string;
    currentValue: number;
    predictedValue: number;
    confidence: number;
    timeframe: string;
  }>;
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    action: string;
    expectedImpact: string;
    implementationEffort: 'low' | 'medium' | 'high';
  }>;
  visualizations: Array<{
    title: string;
    type: 'chart' | 'graph' | 'table' | 'heatmap';
    data: any;
    config: Record<string, any>;
  }>;
  generated: Date;
  generatedBy: string;
}

export interface AnalyticsDashboard {
  id: string;
  name: string;
  description: string;
  owner: string;
  type: 'executive' | 'operational' | 'technical' | 'user' | 'custom';
  widgets: Array<{
    id: string;
    type: 'kpi' | 'chart' | 'table' | 'heatmap' | 'gauge' | 'trend';
    title: string;
    dataSource: string;
    config: Record<string, any>;
    position: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    refreshInterval?: number; // seconds
  }>;
  filters: {
    dateRange: {
      start: Date;
      end: Date;
    };
    segments: Record<string, string[]>;
    realTime: boolean;
  };
  permissions: {
    view: string[];
    edit: string[];
    share: string[];
  };
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    recipients: string[];
    format: 'email' | 'pdf' | 'dashboard';
  };
  created: Date;
  modified: Date;
}

export interface PredictiveModel {
  id: string;
  name: string;
  type: 'usage_prediction' | 'failure_prediction' | 'demand_forecast' | 'user_behavior' | 'performance_trend';
  algorithm: 'linear_regression' | 'random_forest' | 'neural_network' | 'time_series' | 'clustering';
  features: string[];
  target: string;
  accuracy: number; // 0-100
  trainingData: {
    size: number;
    period: {
      start: Date;
      end: Date;
    };
  };
  predictions: Array<{
    timestamp: Date;
    value: number;
    confidence: number;
    factors: Record<string, any>;
  }>;
  lastTrained: Date;
  nextTraining?: Date;
  status: 'active' | 'training' | 'inactive' | 'failed';
}

export class AnalyticsReportingManager {
  private events: AnalyticsEvent[] = [];
  private dashboards: Map<string, AnalyticsDashboard> = new Map();
  private reports: Map<string, BusinessIntelligence> = new Map();
  private models: Map<string, PredictiveModel> = new Map();

  trackEvent(event: Omit<AnalyticsEvent, 'id' | 'timestamp'>): void {
    const analyticsEvent: AnalyticsEvent = {
      ...event,
      id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };

    this.events.push(analyticsEvent);

    // Keep only last 100,000 events (configurable)
    if (this.events.length > 100000) {
      this.events.splice(0, this.events.length - 100000);
    }
  }

  getUserBehaviorAnalytics(userId: string, startDate: Date, endDate: Date): UserBehaviorAnalytics {
    const userEvents = this.events.filter(event =>
      event.userId === userId &&
      event.timestamp >= startDate &&
      event.timestamp <= endDate
    );

    const sessions = this.groupEventsBySession(userEvents);
    const featureUsage = this.analyzeFeatureUsage(userEvents);
    const userJourney = this.analyzeUserJourney(userEvents);

    return {
      userId,
      period: { start: startDate, end: endDate },
      summary: {
        totalSessions: sessions.length,
        totalEvents: userEvents.length,
        averageSessionDuration: this.calculateAverageSessionDuration(sessions),
        mostUsedFeatures: this.getMostUsedFeatures(featureUsage),
        featureAdoption: this.calculateFeatureAdoption(featureUsage, sessions.length),
        userJourney
      },
      patterns: {
        peakUsageHours: this.analyzePeakUsageHours(userEvents),
        preferredDevices: this.analyzeDevicePreferences(userEvents),
        commonWorkflows: this.analyzeCommonWorkflows(userEvents),
        painPoints: this.identifyPainPoints(userEvents)
      },
      recommendations: this.generateUserRecommendations(userEvents, featureUsage)
    };
  }

  private groupEventsBySession(events: AnalyticsEvent[]): Array<AnalyticsEvent[]> {
    const sessions: Record<string, AnalyticsEvent[]> = {};

    events.forEach(event => {
      if (!sessions[event.sessionId]) {
        sessions[event.sessionId] = [];
      }
      sessions[event.sessionId].push(event);
    });

    return Object.values(sessions).sort((a, b) =>
      a[0].timestamp.getTime() - b[0].timestamp.getTime()
    );
  }

  private analyzeFeatureUsage(events: AnalyticsEvent[]): Record<string, { count: number; timeSpent: number }> {
    const usage: Record<string, { count: number; timeSpent: number }> = {};

    events.forEach(event => {
      const feature = event.context.component || event.action;
      if (!usage[feature]) {
        usage[feature] = { count: 0, timeSpent: 0 };
      }
      usage[feature].count++;
      if (event.metrics.duration) {
        usage[feature].timeSpent += event.metrics.duration;
      }
    });

    return usage;
  }

  private analyzeUserJourney(events: AnalyticsEvent[]): UserBehaviorAnalytics['summary']['userJourney'] {
    // Simplified user journey analysis
    const journey: Record<string, { count: number; totalTime: number; dropOffs: number }> = {};

    // Group by action sequences
    const sortedEvents = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const current = sortedEvents[i];
      const next = sortedEvents[i + 1];

      const step = `${current.action} -> ${next.action}`;
      if (!journey[step]) {
        journey[step] = { count: 0, totalTime: 0, dropOffs: 0 };
      }
      journey[step].count++;
      journey[step].totalTime += next.timestamp.getTime() - current.timestamp.getTime();
    }

    return Object.entries(journey).map(([step, data]) => ({
      step,
      count: data.count,
      averageTime: data.totalTime / data.count,
      dropOffRate: data.dropOffs / data.count
    }));
  }

  private calculateAverageSessionDuration(sessions: Array<AnalyticsEvent[]>[]): number {
    if (sessions.length === 0) return 0;

    const durations = sessions.map(session => {
      if (session.length === 0) return 0;
      const start = session[0].timestamp.getTime();
      const end = session[session.length - 1].timestamp.getTime();
      return end - start;
    });

    return durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  }

  private getMostUsedFeatures(usage: Record<string, { count: number; timeSpent: number }>): UserBehaviorAnalytics['summary']['mostUsedFeatures'] {
    return Object.entries(usage)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 5)
      .map(([feature, data]) => ({
        feature,
        usageCount: data.count,
        timeSpent: data.timeSpent
      }));
  }

  private calculateFeatureAdoption(usage: Record<string, { count: number; timeSpent: number }>, totalSessions: number): Record<string, number> {
    const adoption: Record<string, number> = {};

    Object.entries(usage).forEach(([feature, data]) => {
      // Simplified: assume each usage represents a session using the feature
      adoption[feature] = (data.count / Math.max(totalSessions, 1)) * 100;
    });

    return adoption;
  }

  private analyzePeakUsageHours(events: AnalyticsEvent[]): number[] {
    const hourCounts: Record<number, number> = {};

    events.forEach(event => {
      const hour = event.timestamp.getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    return Object.entries(hourCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([hour]) => parseInt(hour));
  }

  private analyzeDevicePreferences(events: AnalyticsEvent[]): Record<string, number> {
    const devices: Record<string, number> = {};

    events.forEach(event => {
      const device = event.context.device.type;
      devices[device] = (devices[device] || 0) + 1;
    });

    const total = Object.values(devices).reduce((sum, count) => sum + count, 0);
    Object.keys(devices).forEach(device => {
      devices[device] = (devices[device] / total) * 100;
    });

    return devices;
  }

  private analyzeCommonWorkflows(events: AnalyticsEvent[]): UserBehaviorAnalytics['patterns']['commonWorkflows'] {
    // Simplified workflow analysis
    const workflows: Record<string, { frequency: number; totalTime: number }> = {};

    // Group consecutive actions
    const sortedEvents = events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    for (let i = 0; i < sortedEvents.length - 2; i++) {
      const workflow = `${sortedEvents[i].action} -> ${sortedEvents[i + 1].action} -> ${sortedEvents[i + 2].action}`;
      if (!workflows[workflow]) {
        workflows[workflow] = { frequency: 0, totalTime: 0 };
      }
      workflows[workflow].frequency++;
      workflows[workflow].totalTime += sortedEvents[i + 2].timestamp.getTime() - sortedEvents[i].timestamp.getTime();
    }

    return Object.entries(workflows)
      .sort(([, a], [, b]) => b.frequency - a.frequency)
      .slice(0, 5)
      .map(([workflow, data]) => ({
        workflow,
        frequency: data.frequency,
        averageCompletionTime: data.totalTime / data.frequency
      }));
  }

  private identifyPainPoints(events: AnalyticsEvent[]): UserBehaviorAnalytics['patterns']['painPoints'] {
    const painPoints: Record<string, { issue: string; frequency: number; severity: 'low' | 'medium' | 'high' }> = {};

    // Look for error events, long durations, repeated actions
    events.forEach(event => {
      if (event.category === 'error') {
        const key = `${event.action}_error`;
        if (!painPoints[key]) {
          painPoints[key] = { issue: 'Error occurred', frequency: 0, severity: 'medium' };
        }
        painPoints[key].frequency++;
      }

      if (event.metrics.duration && event.metrics.duration > 30000) { // 30 seconds
        const key = `${event.action}_slow`;
        if (!painPoints[key]) {
          painPoints[key] = { issue: 'Slow performance', frequency: 0, severity: 'low' };
        }
        painPoints[key].frequency++;
      }
    });

    return Object.entries(painPoints).map(([feature, data]) => ({
      feature,
      issue: data.issue,
      frequency: data.frequency,
      severity: data.severity
    }));
  }

  private generateUserRecommendations(events: AnalyticsEvent[], usage: Record<string, { count: number; timeSpent: number }>): string[] {
    const recommendations: string[] = [];

    // Check feature adoption
    const lowAdoptionFeatures = Object.entries(usage)
      .filter(([, data]) => data.count < 5)
      .map(([feature]) => feature);

    if (lowAdoptionFeatures.length > 0) {
      recommendations.push(`Consider training for underutilized features: ${lowAdoptionFeatures.join(', ')}`);
    }

    // Check for frequent errors
    const errorEvents = events.filter(e => e.category === 'error');
    if (errorEvents.length > events.length * 0.1) {
      recommendations.push('High error rate detected - consider additional training or UI improvements');
    }

    // Check session duration
    const avgSessionDuration = this.calculateAverageSessionDuration([events]);
    if (avgSessionDuration < 300000) { // 5 minutes
      recommendations.push('Short session durations suggest usability issues - consider UX improvements');
    }

    return recommendations;
  }

  generateBusinessIntelligenceReport(type: BusinessIntelligence['type'], startDate: Date, endDate: Date, generatedBy: string): BusinessIntelligence {
    const report: BusinessIntelligence = {
      id: `bi_${Date.now()}`,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} Intelligence Report`,
      type,
      period: { start: startDate, end: endDate },
      kpis: [],
      insights: [],
      forecasts: [],
      recommendations: [],
      visualizations: [],
      generated: new Date(),
      generatedBy
    };

    // Generate KPIs based on type
    report.kpis = this.calculateKPIs(type, startDate, endDate);

    // Generate insights
    report.insights = this.generateInsights(type, startDate, endDate);

    // Generate forecasts
    report.forecasts = this.generateForecasts(type, startDate, endDate);

    // Generate recommendations
    report.recommendations = this.generateBIRecommendations(report.kpis, report.insights);

    // Generate visualizations
    report.visualizations = this.generateVisualizations(type, startDate, endDate);

    this.reports.set(report.id, report);
    return report;
  }

  private calculateKPIs(type: BusinessIntelligence['type'], startDate: Date, endDate: Date): BusinessIntelligence['kpis'] {
    const kpis: BusinessIntelligence['kpis'] = [];

    switch (type) {
      case 'usage':
        kpis.push(
          { name: 'Active Users', value: 1250, target: 1500, trend: 'up', change: 8.3 },
          { name: 'Session Duration', value: 420, target: 400, trend: 'up', change: 5.0 },
          { name: 'Feature Adoption', value: 78, target: 85, trend: 'stable', change: 2.1 },
          { name: 'User Satisfaction', value: 4.2, target: 4.5, trend: 'up', change: 6.7 }
        );
        break;
      case 'performance':
        kpis.push(
          { name: 'Response Time', value: 120, target: 100, trend: 'down', change: -4.2 },
          { name: 'Error Rate', value: 0.8, target: 1.0, trend: 'up', change: 20.0 },
          { name: 'Throughput', value: 1500, target: 1600, trend: 'up', change: 6.3 },
          { name: 'Uptime', value: 99.9, target: 99.9, trend: 'stable', change: 0.0 }
        );
        break;
      case 'financial':
        kpis.push(
          { name: 'Revenue', value: 250000, target: 300000, trend: 'up', change: 15.2 },
          { name: 'Cost per User', value: 45, target: 40, trend: 'down', change: -10.0 },
          { name: 'Profit Margin', value: 35, target: 38, trend: 'up', change: 8.6 },
          { name: 'ROI', value: 280, target: 300, trend: 'up', change: 7.1 }
        );
        break;
    }

    return kpis;
  }

  private generateInsights(type: BusinessIntelligence['type'], startDate: Date, endDate: Date): BusinessIntelligence['insights'] {
    const insights: BusinessIntelligence['insights'] = [];

    switch (type) {
      case 'usage':
        insights.push({
          category: 'User Behavior',
          title: 'Peak Usage Patterns Identified',
          description: 'Users are most active during business hours with highest engagement on Tuesdays and Wednesdays',
          impact: 'high',
          confidence: 95,
          data: { peakHours: [9, 10, 14, 15], peakDays: ['Tuesday', 'Wednesday'] }
        });
        break;
      case 'performance':
        insights.push({
          category: 'System Performance',
          title: 'Database Query Optimization Opportunity',
          description: 'Slow query performance detected in user authentication module',
          impact: 'medium',
          confidence: 88,
          data: { avgQueryTime: 250, optimizationPotential: 40 }
        });
        break;
    }

    return insights;
  }

  private generateForecasts(type: BusinessIntelligence['type'], startDate: Date, endDate: Date): BusinessIntelligence['forecasts'] {
    const forecasts: BusinessIntelligence['forecasts'] = [];

    switch (type) {
      case 'usage':
        forecasts.push({
          metric: 'User Growth',
          currentValue: 1250,
          predictedValue: 1800,
          confidence: 85,
          timeframe: '6 months'
        });
        break;
      case 'performance':
        forecasts.push({
          metric: 'Response Time',
          currentValue: 120,
          predictedValue: 95,
          confidence: 78,
          timeframe: '3 months'
        });
        break;
    }

    return forecasts;
  }

  private generateBIRecommendations(kpis: BusinessIntelligence['kpis'], insights: BusinessIntelligence['insights']): BusinessIntelligence['recommendations'] {
    const recommendations: BusinessIntelligence['recommendations'] = [];

    // Analyze KPIs for recommendations
    kpis.forEach(kpi => {
      if (kpi.target && kpi.value < kpi.target) {
        recommendations.push({
          priority: kpi.change < -10 ? 'high' : 'medium',
          action: `Improve ${kpi.name} to meet target of ${kpi.target}`,
          expectedImpact: `Expected ${Math.abs(kpi.change)}% improvement`,
          implementationEffort: 'medium'
        });
      }
    });

    // Add insight-based recommendations
    insights.forEach(insight => {
      if (insight.impact === 'high') {
        recommendations.push({
          priority: 'high',
          action: insight.title,
          expectedImpact: insight.description,
          implementationEffort: 'medium'
        });
      }
    });

    return recommendations;
  }

  private generateVisualizations(type: BusinessIntelligence['type'], startDate: Date, endDate: Date): BusinessIntelligence['visualizations'] {
    const visualizations: BusinessIntelligence['visualizations'] = [];

    visualizations.push({
      title: 'KPI Trends',
      type: 'chart',
      data: this.generateKPITrendData(type, startDate, endDate),
      config: { type: 'line', showLegend: true }
    });

    visualizations.push({
      title: 'Usage Distribution',
      type: 'chart',
      data: this.generateUsageDistributionData(type, startDate, endDate),
      config: { type: 'pie', showLabels: true }
    });

    return visualizations;
  }

  private generateKPITrendData(type: BusinessIntelligence['type'], startDate: Date, endDate: Date): any {
    // Generate sample trend data
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const data = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      data.push({
        date: date.toISOString().split('T')[0],
        value: 100 + Math.random() * 20
      });
    }

    return data;
  }

  private generateUsageDistributionData(type: BusinessIntelligence['type'], startDate: Date, endDate: Date): any {
    return {
      labels: ['Feature A', 'Feature B', 'Feature C', 'Feature D'],
      datasets: [{
        data: [35, 25, 20, 20],
        backgroundColor: ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0']
      }]
    };
  }

  createAnalyticsDashboard(dashboard: Omit<AnalyticsDashboard, 'id' | 'created' | 'modified'>): AnalyticsDashboard {
    const analyticsDashboard: AnalyticsDashboard = {
      ...dashboard,
      id: `dashboard_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.dashboards.set(analyticsDashboard.id, analyticsDashboard);
    return analyticsDashboard;
  }

  createPredictiveModel(model: Omit<PredictiveModel, 'id' | 'lastTrained' | 'status'>): PredictiveModel {
    const predictiveModel: PredictiveModel = {
      ...model,
      id: `model_${Date.now()}`,
      lastTrained: new Date(),
      status: 'active'
    };

    this.models.set(predictiveModel.id, predictiveModel);
    return predictiveModel;
  }

  getAnalyticsEvents(filters?: {
    userId?: string;
    eventType?: string;
    category?: string;
    startDate?: Date;
    endDate?: Date;
  }): AnalyticsEvent[] {
    return this.events.filter(event => {
      if (filters?.userId && event.userId !== filters.userId) return false;
      if (filters?.eventType && event.eventType !== filters.eventType) return false;
      if (filters?.category && event.category !== filters.category) return false;
      if (filters?.startDate && event.timestamp < filters.startDate) return false;
      if (filters?.endDate && event.timestamp > filters.endDate) return false;
      return true;
    });
  }

  getAnalyticsDashboard(id: string): AnalyticsDashboard | undefined {
    return this.dashboards.get(id);
  }

  getBusinessIntelligenceReport(id: string): BusinessIntelligence | undefined {
    return this.reports.get(id);
  }

  getPredictiveModel(id: string): PredictiveModel | undefined {
    return this.models.get(id);
  }

  getAllAnalyticsDashboards(): AnalyticsDashboard[] {
    return Array.from(this.dashboards.values());
  }

  getAllBusinessIntelligenceReports(): BusinessIntelligence[] {
    return Array.from(this.reports.values());
  }

  getAllPredictiveModels(): PredictiveModel[] {
    return Array.from(this.models.values());
  }

  updateAnalyticsDashboard(id: string, updates: Partial<AnalyticsDashboard>): boolean {
    const dashboard = this.dashboards.get(id);
    if (!dashboard) return false;

    Object.assign(dashboard, updates);
    dashboard.modified = new Date();
    return true;
  }

  updatePredictiveModel(id: string, updates: Partial<PredictiveModel>): boolean {
    const model = this.models.get(id);
    if (!model) return false;

    Object.assign(model, updates);
    return true;
  }

  deleteAnalyticsDashboard(id: string): boolean {
    return this.dashboards.delete(id);
  }

  deleteBusinessIntelligenceReport(id: string): boolean {
    return this.reports.delete(id);
  }

  deletePredictiveModel(id: string): boolean {
    return this.models.delete(id);
  }

  exportAnalyticsData(format: 'json' | 'csv' = 'json'): string {
    const data = {
      events: this.events.slice(-1000), // Last 1000 events
      dashboards: Array.from(this.dashboards.values()),
      reports: Array.from(this.reports.values()),
      models: Array.from(this.models.values()),
      exportedAt: new Date()
    };

    if (format === 'csv') {
      return this.convertAnalyticsToCSV(data.events);
    }

    return JSON.stringify(data, null, 2);
  }

  private convertAnalyticsToCSV(events: AnalyticsEvent[]): string {
    if (events.length === 0) return '';

    const headers = ['timestamp', 'userId', 'eventType', 'category', 'action', 'page'];
    const rows = events.map(event => [
      event.timestamp.toISOString(),
      event.userId,
      event.eventType,
      event.category,
      event.action,
      event.context.page
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }
}

export const analyticsReportingManager = new AnalyticsReportingManager();