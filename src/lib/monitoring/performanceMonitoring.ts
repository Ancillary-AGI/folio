import { Component } from '../../types';

export interface PerformanceMetric {
  id: string;
  name: string;
  category: 'system' | 'application' | 'user' | 'business';
  type: 'counter' | 'gauge' | 'histogram' | 'summary';
  unit: string;
  description: string;
  tags: Record<string, string>;
  value: number;
  timestamp: Date;
  metadata: {
    source: string;
    version: string;
    environment: string;
  };
}

export interface PerformanceAlert {
  id: string;
  name: string;
  description: string;
  metric: string;
  condition: {
    operator: 'gt' | 'lt' | 'eq' | 'ne' | 'gte' | 'lte';
    threshold: number;
    duration: number; // seconds
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  channels: Array<{
    type: 'email' | 'webhook' | 'slack' | 'sms';
    target: string;
    template?: string;
  }>;
  cooldown: number; // seconds
  lastTriggered?: Date;
  triggerCount: number;
  created: Date;
  modified: Date;
}

export interface SystemHealth {
  id: string;
  timestamp: Date;
  overall: 'healthy' | 'degraded' | 'unhealthy' | 'critical';
  components: Array<{
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy' | 'critical';
    metrics: Record<string, number>;
    issues: string[];
    lastChecked: Date;
  }>;
  recommendations: string[];
  nextCheck: Date;
}

export interface PerformanceDashboard {
  id: string;
  name: string;
  description: string;
  owner: string;
  widgets: Array<{
    id: string;
    type: 'chart' | 'gauge' | 'table' | 'metric' | 'heatmap';
    title: string;
    metrics: string[];
    config: Record<string, any>;
    position: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
  filters: {
    timeRange: {
      start: Date;
      end: Date;
    };
    tags: Record<string, string[]>;
    refreshInterval: number; // seconds
  };
  permissions: {
    view: string[];
    edit: string[];
    delete: string[];
  };
  created: Date;
  modified: Date;
}

export interface PerformanceReport {
  id: string;
  title: string;
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom';
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    overallScore: number;
    trend: 'improving' | 'stable' | 'declining';
    keyMetrics: Record<string, {
      current: number;
      previous: number;
      change: number;
      target?: number;
    }>;
    topIssues: Array<{
      metric: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      description: string;
      impact: string;
    }>;
  };
  sections: Array<{
    title: string;
    content: string;
    charts: Array<{
      title: string;
      type: string;
      data: any;
    }>;
    recommendations: string[];
  }>;
  generated: Date;
  generatedBy: string;
  recipients: string[];
}

export class PerformanceMonitoringManager {
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private alerts: Map<string, PerformanceAlert> = new Map();
  private dashboards: Map<string, PerformanceDashboard> = new Map();
  private reports: Map<string, PerformanceReport> = new Map();
  private healthChecks: SystemHealth[] = [];

  recordMetric(metric: Omit<PerformanceMetric, 'id' | 'timestamp'>): void {
    const performanceMetric: PerformanceMetric = {
      ...metric,
      id: `metric_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };

    const key = `${metric.name}:${JSON.stringify(metric.tags)}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    this.metrics.get(key)!.push(performanceMetric);

    // Keep only last 1000 metrics per key
    const metrics = this.metrics.get(key)!;
    if (metrics.length > 1000) {
      metrics.splice(0, metrics.length - 1000);
    }

    // Check alerts
    this.checkAlerts(performanceMetric);
  }

  private checkAlerts(metric: PerformanceMetric): void {
    for (const alert of this.alerts.values()) {
      if (!alert.enabled || alert.metric !== metric.name) continue;

      // Check cooldown
      if (alert.lastTriggered) {
        const timeSinceLastTrigger = (Date.now() - alert.lastTriggered.getTime()) / 1000;
        if (timeSinceLastTrigger < alert.cooldown) continue;
      }

      // Check condition
      if (this.evaluateAlertCondition(alert, metric)) {
        this.triggerAlert(alert, metric);
        alert.lastTriggered = new Date();
        alert.triggerCount++;
      }
    }
  }

  private evaluateAlertCondition(alert: PerformanceAlert, metric: PerformanceMetric): boolean {
    const { condition } = alert;

    // Check if metric value meets condition
    let conditionMet = false;
    switch (condition.operator) {
      case 'gt':
        conditionMet = metric.value > condition.threshold;
        break;
      case 'lt':
        conditionMet = metric.value < condition.threshold;
        break;
      case 'eq':
        conditionMet = metric.value === condition.threshold;
        break;
      case 'ne':
        conditionMet = metric.value !== condition.threshold;
        break;
      case 'gte':
        conditionMet = metric.value >= condition.threshold;
        break;
      case 'lte':
        conditionMet = metric.value <= condition.threshold;
        break;
    }

    if (!conditionMet) return false;

    // Check duration - simplified version
    if (condition.duration > 0) {
      const key = `${metric.name}:${JSON.stringify(metric.tags)}`;
      const recentMetrics = this.metrics.get(key) || [];
      const durationMs = condition.duration * 1000;
      const cutoffTime = Date.now() - durationMs;

      const recentViolations = recentMetrics.filter(m =>
        m.timestamp.getTime() > cutoffTime &&
        this.evaluateAlertCondition(alert, m)
      );

      // Require at least 80% of recent metrics to violate for duration-based alerts
      const violationRatio = recentViolations.length / Math.max(1, recentMetrics.length);
      return violationRatio >= 0.8;
    }

    return true;
  }

  private triggerAlert(alert: PerformanceAlert, metric: PerformanceMetric): void {
    console.log(`Performance alert triggered: ${alert.name} - ${metric.name}: ${metric.value}`);

    for (const channel of alert.channels) {
      switch (channel.type) {
        case 'email':
          this.sendAlertEmail(alert, metric, channel);
          break;
        case 'webhook':
          this.sendAlertWebhook(alert, metric, channel);
          break;
        case 'slack':
          this.sendAlertSlack(alert, metric, channel);
          break;
        case 'sms':
          this.sendAlertSMS(alert, metric, channel);
          break;
      }
    }
  }

  private sendAlertEmail(alert: PerformanceAlert, metric: PerformanceMetric, channel: PerformanceAlert['channels'][0]): void {
    // Email implementation
    console.log(`Sending email alert to ${channel.target}`);
  }

  private sendAlertWebhook(alert: PerformanceAlert, metric: PerformanceMetric, channel: PerformanceAlert['channels'][0]): void {
    // Webhook implementation
    console.log(`Sending webhook alert to ${channel.target}`);
  }

  private sendAlertSlack(alert: PerformanceAlert, metric: PerformanceMetric, channel: PerformanceAlert['channels'][0]): void {
    // Slack implementation
    console.log(`Sending Slack alert to ${channel.target}`);
  }

  private sendAlertSMS(alert: PerformanceAlert, metric: PerformanceMetric, channel: PerformanceAlert['channels'][0]): void {
    // SMS implementation
    console.log(`Sending SMS alert to ${channel.target}`);
  }

  createPerformanceAlert(alert: Omit<PerformanceAlert, 'id' | 'created' | 'modified' | 'triggerCount'>): PerformanceAlert {
    const performanceAlert: PerformanceAlert = {
      ...alert,
      id: `alert_${Date.now()}`,
      triggerCount: 0,
      created: new Date(),
      modified: new Date()
    };

    this.alerts.set(performanceAlert.id, performanceAlert);
    return performanceAlert;
  }

  performSystemHealthCheck(): SystemHealth {
    const healthCheck: SystemHealth = {
      id: `health_${Date.now()}`,
      timestamp: new Date(),
      overall: 'healthy',
      components: [],
      recommendations: [],
      nextCheck: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    };

    // Check various system components
    healthCheck.components = [
      this.checkDatabaseHealth(),
      this.checkAPIServicesHealth(),
      this.checkSimulationEngineHealth(),
      this.checkFileStorageHealth(),
      this.checkNetworkHealth()
    ];

    // Determine overall health
    const criticalCount = healthCheck.components.filter(c => c.status === 'critical').length;
    const unhealthyCount = healthCheck.components.filter(c => c.status === 'unhealthy').length;
    const degradedCount = healthCheck.components.filter(c => c.status === 'degraded').length;

    if (criticalCount > 0) {
      healthCheck.overall = 'critical';
    } else if (unhealthyCount > 0) {
      healthCheck.overall = 'unhealthy';
    } else if (degradedCount > 0) {
      healthCheck.overall = 'degraded';
    }

    // Generate recommendations
    healthCheck.recommendations = this.generateHealthRecommendations(healthCheck.components);

    this.healthChecks.push(healthCheck);

    // Keep only last 100 health checks
    if (this.healthChecks.length > 100) {
      this.healthChecks.splice(0, this.healthChecks.length - 100);
    }

    return healthCheck;
  }

  private checkDatabaseHealth(): SystemHealth['components'][0] {
    // Simplified database health check
    return {
      name: 'Database',
      status: 'healthy',
      metrics: {
        connectionPool: 95,
        queryLatency: 45,
        activeConnections: 12
      },
      issues: [],
      lastChecked: new Date()
    };
  }

  private checkAPIServicesHealth(): SystemHealth['components'][0] {
    return {
      name: 'API Services',
      status: 'healthy',
      metrics: {
        responseTime: 120,
        errorRate: 0.1,
        throughput: 1500
      },
      issues: [],
      lastChecked: new Date()
    };
  }

  private checkSimulationEngineHealth(): SystemHealth['components'][0] {
    return {
      name: 'Simulation Engine',
      status: 'healthy',
      metrics: {
        activeSimulations: 3,
        memoryUsage: 75,
        cpuUsage: 60
      },
      issues: [],
      lastChecked: new Date()
    };
  }

  private checkFileStorageHealth(): SystemHealth['components'][0] {
    return {
      name: 'File Storage',
      status: 'healthy',
      metrics: {
        storageUsed: 65,
        ioLatency: 25,
        errorRate: 0.05
      },
      issues: [],
      lastChecked: new Date()
    };
  }

  private checkNetworkHealth(): SystemHealth['components'][0] {
    return {
      name: 'Network',
      status: 'healthy',
      metrics: {
        latency: 15,
        packetLoss: 0.01,
        bandwidth: 100
      },
      issues: [],
      lastChecked: new Date()
    };
  }

  private generateHealthRecommendations(components: SystemHealth['components']): string[] {
    const recommendations: string[] = [];

    components.forEach(component => {
      if (component.status === 'critical') {
        recommendations.push(`Immediate action required for ${component.name}`);
      } else if (component.status === 'unhealthy') {
        recommendations.push(`Investigate issues with ${component.name}`);
      } else if (component.status === 'degraded') {
        recommendations.push(`Monitor and optimize ${component.name} performance`);
      }

      // Check specific metrics
      Object.entries(component.metrics).forEach(([metric, value]) => {
        if (metric === 'errorRate' && value > 1) {
          recommendations.push(`High error rate in ${component.name} - investigate ${metric}`);
        }
        if (metric.includes('Latency') && value > 1000) {
          recommendations.push(`High latency in ${component.name} - optimize ${metric}`);
        }
        if (metric.includes('Usage') && value > 90) {
          recommendations.push(`High resource usage in ${component.name} - consider scaling`);
        }
      });
    });

    return recommendations;
  }

  createPerformanceDashboard(dashboard: Omit<PerformanceDashboard, 'id' | 'created' | 'modified'>): PerformanceDashboard {
    const performanceDashboard: PerformanceDashboard = {
      ...dashboard,
      id: `dashboard_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.dashboards.set(performanceDashboard.id, performanceDashboard);
    return performanceDashboard;
  }

  generatePerformanceReport(type: PerformanceReport['type'], startDate: Date, endDate: Date, generatedBy: string): PerformanceReport {
    const report: PerformanceReport = {
      id: `report_${Date.now()}`,
      title: `${type.charAt(0).toUpperCase() + type.slice(1)} Performance Report`,
      type,
      period: { start: startDate, end: endDate },
      summary: {
        overallScore: 85,
        trend: 'stable',
        keyMetrics: {},
        topIssues: []
      },
      sections: [],
      generated: new Date(),
      generatedBy,
      recipients: []
    };

    // Calculate summary metrics
    report.summary = this.calculateReportSummary(startDate, endDate);

    // Generate report sections
    report.sections = this.generateReportSections(type, startDate, endDate);

    this.reports.set(report.id, report);
    return report;
  }

  private calculateReportSummary(startDate: Date, endDate: Date): PerformanceReport['summary'] {
    // Simplified summary calculation
    const keyMetrics: Record<string, { current: number; previous: number; change: number; target?: number }> = {
      'response_time': { current: 120, previous: 115, change: 4.3, target: 100 },
      'error_rate': { current: 0.1, previous: 0.15, change: -33.3, target: 0.1 },
      'throughput': { current: 1500, previous: 1450, change: 3.4, target: 1600 },
      'cpu_usage': { current: 65, previous: 70, change: -7.1, target: 80 },
      'memory_usage': { current: 75, previous: 72, change: 4.2, target: 85 }
    };

    const topIssues: PerformanceReport['summary']['topIssues'] = [
      {
        metric: 'response_time',
        severity: 'medium',
        description: 'Average response time above target',
        impact: 'User experience degradation'
      },
      {
        metric: 'memory_usage',
        severity: 'low',
        description: 'Memory usage trending upward',
        impact: 'Potential performance issues under load'
      }
    ];

    // Calculate overall score based on metrics
    const scores = Object.values(keyMetrics).map(m => {
      if (m.target) {
        return Math.min(100, (m.target / m.current) * 100);
      }
      return 85; // Default score
    });

    const overallScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

    // Determine trend
    const positiveChanges = Object.values(keyMetrics).filter(m => m.change > 0).length;
    const negativeChanges = Object.values(keyMetrics).filter(m => m.change < 0).length;
    const trend = positiveChanges > negativeChanges ? 'improving' :
                  negativeChanges > positiveChanges ? 'declining' : 'stable';

    return {
      overallScore: Math.round(overallScore),
      trend,
      keyMetrics,
      topIssues
    };
  }

  private generateReportSections(type: PerformanceReport['type'], startDate: Date, endDate: Date): PerformanceReport['sections'] {
    const sections: PerformanceReport['sections'] = [];

    sections.push({
      title: 'Executive Summary',
      content: 'This report provides an overview of system performance during the reporting period.',
      charts: [],
      recommendations: [
        'Monitor response times closely',
        'Consider memory optimization',
        'Review error handling procedures'
      ]
    });

    sections.push({
      title: 'System Performance',
      content: 'Detailed analysis of system metrics and performance indicators.',
      charts: [
        {
          title: 'Response Time Trend',
          type: 'line',
          data: this.generateTrendData('response_time', startDate, endDate)
        },
        {
          title: 'Resource Usage',
          type: 'bar',
          data: this.generateResourceUsageData(startDate, endDate)
        }
      ],
      recommendations: [
        'Implement response time monitoring alerts',
        'Optimize database queries',
        'Consider load balancing'
      ]
    });

    sections.push({
      title: 'Issues and Recommendations',
      content: 'Analysis of performance issues and recommended actions.',
      charts: [],
      recommendations: [
        'Address high response times',
        'Implement caching strategies',
        'Regular performance testing'
      ]
    });

    return sections;
  }

  private generateTrendData(metric: string, startDate: Date, endDate: Date): any {
    // Generate sample trend data
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const data = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      data.push({
        date: date.toISOString().split('T')[0],
        value: 100 + Math.random() * 50
      });
    }

    return data;
  }

  private generateResourceUsageData(startDate: Date, endDate: Date): any {
    return {
      labels: ['CPU', 'Memory', 'Disk', 'Network'],
      datasets: [{
        label: 'Usage (%)',
        data: [65, 75, 45, 30]
      }]
    };
  }

  getMetrics(name?: string, tags?: Record<string, string>, startDate?: Date, endDate?: Date): PerformanceMetric[] {
    let allMetrics: PerformanceMetric[] = [];

    for (const metrics of this.metrics.values()) {
      allMetrics.push(...metrics);
    }

    // Apply filters
    if (name) {
      allMetrics = allMetrics.filter(m => m.name === name);
    }

    if (tags) {
      allMetrics = allMetrics.filter(m => {
        return Object.entries(tags).every(([key, value]) => m.tags[key] === value);
      });
    }

    if (startDate) {
      allMetrics = allMetrics.filter(m => m.timestamp >= startDate);
    }

    if (endDate) {
      allMetrics = allMetrics.filter(m => m.timestamp <= endDate);
    }

    return allMetrics.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  getPerformanceAlert(id: string): PerformanceAlert | undefined {
    return this.alerts.get(id);
  }

  getSystemHealthHistory(limit: number = 10): SystemHealth[] {
    return this.healthChecks.slice(-limit);
  }

  getPerformanceDashboard(id: string): PerformanceDashboard | undefined {
    return this.dashboards.get(id);
  }

  getPerformanceReport(id: string): PerformanceReport | undefined {
    return this.reports.get(id);
  }

  getAllPerformanceAlerts(): PerformanceAlert[] {
    return Array.from(this.alerts.values());
  }

  getAllPerformanceDashboards(): PerformanceDashboard[] {
    return Array.from(this.dashboards.values());
  }

  getAllPerformanceReports(): PerformanceReport[] {
    return Array.from(this.reports.values());
  }

  updatePerformanceAlert(id: string, updates: Partial<PerformanceAlert>): boolean {
    const alert = this.alerts.get(id);
    if (!alert) return false;

    Object.assign(alert, updates);
    alert.modified = new Date();
    return true;
  }

  updatePerformanceDashboard(id: string, updates: Partial<PerformanceDashboard>): boolean {
    const dashboard = this.dashboards.get(id);
    if (!dashboard) return false;

    Object.assign(dashboard, updates);
    dashboard.modified = new Date();
    return true;
  }

  deletePerformanceAlert(id: string): boolean {
    return this.alerts.delete(id);
  }

  deletePerformanceDashboard(id: string): boolean {
    return this.dashboards.delete(id);
  }

  deletePerformanceReport(id: string): boolean {
    return this.reports.delete(id);
  }
}

export const performanceMonitoringManager = new PerformanceMonitoringManager();