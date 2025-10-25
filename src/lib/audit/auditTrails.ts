import { Component } from '../../types';

export interface AuditEvent {
  id: string;
  timestamp: Date;
  userId: string;
  sessionId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  resourceType: 'project' | 'component' | 'schematic' | 'simulation' | 'document' | 'user' | 'system' | 'security';
  operation: 'create' | 'read' | 'update' | 'delete' | 'execute' | 'login' | 'logout' | 'export' | 'import';
  details: {
    before?: Record<string, any>;
    after?: Record<string, any>;
    changes?: Array<{
      field: string;
      oldValue: any;
      newValue: any;
    }>;
    metadata?: Record<string, any>;
  };
  context: {
    ipAddress: string;
    userAgent: string;
    location?: {
      country: string;
      region: string;
      city: string;
    };
    device: {
      type: 'desktop' | 'mobile' | 'tablet';
      os: string;
      browser: string;
    };
  };
  compliance: {
    gdpr?: boolean;
    hipaa?: boolean;
    pci?: boolean;
    sox?: boolean;
    iso27001?: boolean;
  };
  risk: {
    level: 'low' | 'medium' | 'high' | 'critical';
    factors: string[];
    score: number;
  };
  status: 'success' | 'failure' | 'warning';
  errorMessage?: string;
  tags: string[];
}

export interface AuditTrail {
  id: string;
  name: string;
  description?: string;
  scope: {
    users?: string[];
    resources?: string[];
    actions?: string[];
    dateRange?: {
      start: Date;
      end: Date;
    };
  };
  filters: {
    severity?: AuditEvent['risk']['level'][];
    status?: AuditEvent['status'][];
    compliance?: string[];
    tags?: string[];
  };
  events: AuditEvent[];
  statistics: {
    totalEvents: number;
    eventsByAction: Record<string, number>;
    eventsByUser: Record<string, number>;
    eventsByResource: Record<string, number>;
    riskDistribution: Record<string, number>;
    complianceCoverage: Record<string, number>;
    temporalDistribution: Array<{
      date: string;
      count: number;
      riskScore: number;
    }>;
  };
  created: Date;
  modified: Date;
  retention: {
    period: number; // days
    autoDelete: boolean;
    archiveLocation?: string;
  };
}

export interface AuditReport {
  id: string;
  trailId: string;
  title: string;
  type: 'summary' | 'detailed' | 'compliance' | 'security' | 'anomaly' | 'forensic';
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalEvents: number;
    uniqueUsers: number;
    uniqueResources: number;
    averageRiskScore: number;
    complianceScore: number;
    anomaliesDetected: number;
  };
  findings: Array<{
    category: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    evidence: AuditEvent[];
    recommendations: string[];
    compliance?: string[];
  }>;
  charts: Array<{
    title: string;
    type: 'line' | 'bar' | 'pie' | 'heatmap';
    data: any;
    description: string;
  }>;
  recommendations: string[];
  generated: Date;
  generatedBy: string;
}

export interface AuditAlert {
  id: string;
  name: string;
  description: string;
  condition: {
    metric: string;
    operator: 'gt' | 'lt' | 'eq' | 'contains' | 'regex';
    threshold: any;
    timeWindow?: number; // minutes
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  actions: Array<{
    type: 'email' | 'webhook' | 'notification' | 'disable_user' | 'lock_resource';
    target: string;
    template?: string;
  }>;
  cooldown: number; // minutes - prevent alert spam
  lastTriggered?: Date;
  triggerCount: number;
  created: Date;
  modified: Date;
}

export class AuditTrailManager {
  private events: AuditEvent[] = [];
  private trails: Map<string, AuditTrail> = new Map();
  private reports: Map<string, AuditReport> = new Map();
  private alerts: Map<string, AuditAlert> = new Map();

  logEvent(event: Omit<AuditEvent, 'id' | 'timestamp'>): AuditEvent {
    const auditEvent: AuditEvent = {
      ...event,
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };

    this.events.push(auditEvent);

    // Check alerts
    this.checkAlerts(auditEvent);

    // Cleanup old events
    this.cleanupOldEvents();

    return auditEvent;
  }

  private checkAlerts(event: AuditEvent): void {
    for (const alert of this.alerts.values()) {
      if (!alert.enabled) continue;

      // Check cooldown
      if (alert.lastTriggered) {
        const timeSinceLastTrigger = (Date.now() - alert.lastTriggered.getTime()) / (1000 * 60);
        if (timeSinceLastTrigger < alert.cooldown) continue;
      }

      if (this.evaluateAlertCondition(alert, event)) {
        this.triggerAlert(alert, event);
        alert.lastTriggered = new Date();
        alert.triggerCount++;
      }
    }
  }

  private evaluateAlertCondition(alert: AuditAlert, event: AuditEvent): boolean {
    const { condition } = alert;

    switch (condition.metric) {
      case 'risk_score':
        return this.compareValues(event.risk.score, condition.operator, condition.threshold);

      case 'action':
        return this.compareValues(event.action, condition.operator, condition.threshold);

      case 'user':
        return this.compareValues(event.userId, condition.operator, condition.threshold);

      case 'resource':
        return this.compareValues(event.resource, condition.operator, condition.threshold);

      case 'status':
        return this.compareValues(event.status, condition.operator, condition.threshold);

      case 'ip_address':
        return this.compareValues(event.context.ipAddress, condition.operator, condition.threshold);

      case 'event_count':
        if (condition.timeWindow) {
          const timeWindow = condition.timeWindow;
          const recentEvents = this.events.filter(e =>
            e.timestamp > new Date(Date.now() - timeWindow * 60 * 1000) &&
            e.userId === event.userId &&
            e.action === event.action
          );
          return this.compareValues(recentEvents.length, condition.operator, condition.threshold);
        }
        return false;

      default:
        return false;
    }
  }

  private compareValues(value: any, operator: string, threshold: any): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'lt':
        return value < threshold;
      case 'eq':
        return value === threshold;
      case 'contains':
        return String(value).includes(String(threshold));
      case 'regex':
        return new RegExp(threshold).test(String(value));
      default:
        return false;
    }
  }

  private triggerAlert(alert: AuditAlert, event: AuditEvent): void {
    console.log(`Audit alert triggered: ${alert.name} for event ${event.id}`);

    for (const action of alert.actions) {
      switch (action.type) {
        case 'email':
          this.sendAlertEmail(alert, event, action);
          break;
        case 'webhook':
          this.sendAlertWebhook(alert, event, action);
          break;
        case 'notification':
          this.sendAlertNotification(alert, event, action);
          break;
        case 'disable_user':
          this.disableUser(event.userId);
          break;
        case 'lock_resource':
          this.lockResource(event.resourceId);
          break;
      }
    }
  }

  private sendAlertEmail(alert: AuditAlert, event: AuditEvent, action: AuditAlert['actions'][0]): void {
    // Email implementation
    console.log(`Sending email alert to ${action.target}`);
  }

  private sendAlertWebhook(alert: AuditAlert, event: AuditEvent, action: AuditAlert['actions'][0]): void {
    // Webhook implementation
    console.log(`Sending webhook alert to ${action.target}`);
  }

  private sendAlertNotification(alert: AuditAlert, event: AuditEvent, action: AuditAlert['actions'][0]): void {
    // In-app notification implementation
    console.log(`Sending in-app notification`);
  }

  private disableUser(userId: string): void {
    // User disable implementation
    console.log(`Disabling user ${userId}`);
  }

  private lockResource(resourceId?: string): void {
    if (resourceId) {
      console.log(`Locking resource ${resourceId}`);
    }
  }

  private cleanupOldEvents(): void {
    // Keep only last 30 days of events (configurable)
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    this.events = this.events.filter(event => event.timestamp > cutoffDate);
  }

  createAuditTrail(trail: Omit<AuditTrail, 'id' | 'events' | 'statistics' | 'created' | 'modified'>): AuditTrail {
    const auditTrail: AuditTrail = {
      ...trail,
      id: `trail_${Date.now()}`,
      events: [],
      statistics: {
        totalEvents: 0,
        eventsByAction: {},
        eventsByUser: {},
        eventsByResource: {},
        riskDistribution: {},
        complianceCoverage: {},
        temporalDistribution: []
      },
      created: new Date(),
      modified: new Date()
    };

    this.trails.set(auditTrail.id, auditTrail);
    return auditTrail;
  }

  updateAuditTrail(trailId: string): boolean {
    const trail = this.trails.get(trailId);
    if (!trail) return false;

    // Filter events based on scope and filters
    const filteredEvents = this.events.filter(event => {
      if (trail.scope.users && !trail.scope.users.includes(event.userId)) return false;
      if (trail.scope.resources && !trail.scope.resources.includes(event.resource)) return false;
      if (trail.scope.actions && !trail.scope.actions.includes(event.action)) return false;
      if (trail.scope.dateRange) {
        if (event.timestamp < trail.scope.dateRange.start || event.timestamp > trail.scope.dateRange.end) {
          return false;
        }
      }
      if (trail.filters.severity && !trail.filters.severity.includes(event.risk.level)) return false;
      if (trail.filters.status && !trail.filters.status.includes(event.status)) return false;
      if (trail.filters.tags && !trail.filters.tags.some(tag => event.tags.includes(tag))) return false;

      return true;
    });

    trail.events = filteredEvents;
    trail.statistics = this.calculateTrailStatistics(filteredEvents);
    trail.modified = new Date();

    return true;
  }

  private calculateTrailStatistics(events: AuditEvent[]): AuditTrail['statistics'] {
    const stats: AuditTrail['statistics'] = {
      totalEvents: events.length,
      eventsByAction: {},
      eventsByUser: {},
      eventsByResource: {},
      riskDistribution: {},
      complianceCoverage: {},
      temporalDistribution: []
    };

    // Count events by various dimensions
    events.forEach(event => {
      // By action
      stats.eventsByAction[event.action] = (stats.eventsByAction[event.action] || 0) + 1;

      // By user
      stats.eventsByUser[event.userId] = (stats.eventsByUser[event.userId] || 0) + 1;

      // By resource
      stats.eventsByResource[event.resource] = (stats.eventsByResource[event.resource] || 0) + 1;

      // By risk level
      stats.riskDistribution[event.risk.level] = (stats.riskDistribution[event.risk.level] || 0) + 1;

      // Compliance coverage
      Object.entries(event.compliance).forEach(([standard, applicable]) => {
        if (applicable) {
          stats.complianceCoverage[standard] = (stats.complianceCoverage[standard] || 0) + 1;
        }
      });
    });

    // Temporal distribution (last 30 days)
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const dayEvents = events.filter(e => e.timestamp.toISOString().split('T')[0] === dateStr);
      const avgRisk = dayEvents.length > 0 ?
        dayEvents.reduce((sum, e) => sum + e.risk.score, 0) / dayEvents.length : 0;

      stats.temporalDistribution.push({
        date: dateStr,
        count: dayEvents.length,
        riskScore: avgRisk
      });
    }

    return stats;
  }

  generateAuditReport(trailId: string, type: AuditReport['type'], title: string, generatedBy: string): AuditReport {
    const trail = this.trails.get(trailId);
    if (!trail) {
      throw new Error('Audit trail not found');
    }

    const report: AuditReport = {
      id: `report_${Date.now()}`,
      trailId,
      title,
      type,
      period: trail.scope.dateRange || {
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        end: new Date()
      },
      summary: {
        totalEvents: trail.statistics.totalEvents,
        uniqueUsers: Object.keys(trail.statistics.eventsByUser).length,
        uniqueResources: Object.keys(trail.statistics.eventsByResource).length,
        averageRiskScore: trail.events.reduce((sum, e) => sum + e.risk.score, 0) / trail.events.length || 0,
        complianceScore: this.calculateComplianceScore(trail.events),
        anomaliesDetected: this.detectAnomalies(trail.events)
      },
      findings: [],
      charts: [],
      recommendations: [],
      generated: new Date(),
      generatedBy
    };

    // Generate findings based on type
    report.findings = this.generateFindings(trail.events, type);
    report.charts = this.generateCharts(trail, type);
    report.recommendations = this.generateRecommendations(report.findings);

    this.reports.set(report.id, report);
    return report;
  }

  private calculateComplianceScore(events: AuditEvent[]): number {
    const complianceEvents = events.filter(e => Object.values(e.compliance).some(v => v));
    return complianceEvents.length / events.length * 100;
  }

  private detectAnomalies(events: AuditEvent[]): number {
    // Simple anomaly detection - events with high risk scores
    return events.filter(e => e.risk.score > 7).length;
  }

  private generateFindings(events: AuditEvent[], type: AuditReport['type']): AuditReport['findings'] {
    const findings: AuditReport['findings'] = [];

    switch (type) {
      case 'security':
        findings.push(...this.generateSecurityFindings(events));
        break;
      case 'compliance':
        findings.push(...this.generateComplianceFindings(events));
        break;
      case 'anomaly':
        findings.push(...this.generateAnomalyFindings(events));
        break;
      default:
        findings.push(...this.generateGeneralFindings(events));
    }

    return findings;
  }

  private generateSecurityFindings(events: AuditEvent[]): AuditReport['findings'] {
    const findings: AuditReport['findings'] = [];

    // Failed login attempts
    const failedLogins = events.filter(e => e.action === 'login' && e.status === 'failure');
    if (failedLogins.length > 10) {
      findings.push({
        category: 'Authentication',
        severity: 'high',
        description: `${failedLogins.length} failed login attempts detected`,
        evidence: failedLogins,
        recommendations: [
          'Implement account lockout after failed attempts',
          'Enable multi-factor authentication',
          'Monitor for brute force attacks'
        ]
      });
    }

    // High-risk actions
    const highRiskEvents = events.filter(e => e.risk.level === 'high' || e.risk.level === 'critical');
    if (highRiskEvents.length > 0) {
      findings.push({
        category: 'High Risk Activities',
        severity: 'critical',
        description: `${highRiskEvents.length} high-risk actions performed`,
        evidence: highRiskEvents,
        recommendations: [
          'Review user permissions',
          'Implement additional monitoring',
          'Conduct security training'
        ]
      });
    }

    return findings;
  }

  private generateComplianceFindings(events: AuditEvent[]): AuditReport['findings'] {
    const findings: AuditReport['findings'] = [];

    // GDPR compliance
    const gdprEvents = events.filter(e => e.compliance.gdpr);
    const nonCompliantGdpr = events.filter(e => !e.compliance.gdpr && e.resourceType === 'user');
    if (nonCompliantGdpr.length > 0) {
      findings.push({
        category: 'GDPR Compliance',
        severity: 'high',
        description: `${nonCompliantGdpr.length} events may not comply with GDPR`,
        evidence: nonCompliantGdpr,
        recommendations: [
          'Implement data minimization practices',
          'Add consent management',
          'Enable right to deletion'
        ],
        compliance: ['gdpr']
      });
    }

    return findings;
  }

  private generateAnomalyFindings(events: AuditEvent[]): AuditReport['findings'] {
    const findings: AuditReport['findings'] = [];

    // Unusual login times
    const unusualLogins = events.filter(e => {
      const hour = e.timestamp.getHours();
      return hour < 6 || hour > 22; // Outside normal business hours
    });

    if (unusualLogins.length > events.length * 0.1) {
      findings.push({
        category: 'Unusual Activity',
        severity: 'medium',
        description: 'Unusual login times detected',
        evidence: unusualLogins,
        recommendations: [
          'Review login time restrictions',
          'Implement geo-blocking',
          'Add additional verification for unusual logins'
        ]
      });
    }

    return findings;
  }

  private generateGeneralFindings(events: AuditEvent[]): AuditReport['findings'] {
    const findings: AuditReport['findings'] = [];

    // General statistics
    const totalEvents = events.length;
    const uniqueUsers = new Set(events.map(e => e.userId)).size;

    findings.push({
      category: 'General Statistics',
      severity: 'low',
      description: `${totalEvents} events from ${uniqueUsers} users`,
      evidence: [],
      recommendations: []
    });

    return findings;
  }

  private generateCharts(trail: AuditTrail, type: AuditReport['type']): AuditReport['charts'] {
    const charts: AuditReport['charts'] = [];

    // Events over time
    charts.push({
      title: 'Events Over Time',
      type: 'line',
      data: trail.statistics.temporalDistribution,
      description: 'Number of audit events per day'
    });

    // Risk distribution
    charts.push({
      title: 'Risk Distribution',
      type: 'pie',
      data: trail.statistics.riskDistribution,
      description: 'Distribution of events by risk level'
    });

    // Top actions
    const topActions = Object.entries(trail.statistics.eventsByAction)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);

    charts.push({
      title: 'Top Actions',
      type: 'bar',
      data: topActions,
      description: 'Most frequent audit actions'
    });

    return charts;
  }

  private generateRecommendations(findings: AuditReport['findings']): string[] {
    const recommendations: string[] = [];

    findings.forEach(finding => {
      recommendations.push(...finding.recommendations);
    });

    // Remove duplicates
    return [...new Set(recommendations)];
  }

  createAuditAlert(alert: Omit<AuditAlert, 'id' | 'created' | 'modified' | 'triggerCount'>): AuditAlert {
    const auditAlert: AuditAlert = {
      ...alert,
      id: `alert_${Date.now()}`,
      triggerCount: 0,
      created: new Date(),
      modified: new Date()
    };

    this.alerts.set(auditAlert.id, auditAlert);
    return auditAlert;
  }

  getAuditEvent(id: string): AuditEvent | undefined {
    return this.events.find(e => e.id === id);
  }

  getAuditTrail(id: string): AuditTrail | undefined {
    return this.trails.get(id);
  }

  getAuditReport(id: string): AuditReport | undefined {
    return this.reports.get(id);
  }

  getAuditAlert(id: string): AuditAlert | undefined {
    return this.alerts.get(id);
  }

  getAuditEvents(filters?: {
    userId?: string;
    action?: string;
    resource?: string;
    startDate?: Date;
    endDate?: Date;
    status?: AuditEvent['status'];
    riskLevel?: AuditEvent['risk']['level'];
  }): AuditEvent[] {
    return this.events.filter(event => {
      if (filters?.userId && event.userId !== filters.userId) return false;
      if (filters?.action && event.action !== filters.action) return false;
      if (filters?.resource && event.resource !== filters.resource) return false;
      if (filters?.startDate && event.timestamp < filters.startDate) return false;
      if (filters?.endDate && event.timestamp > filters.endDate) return false;
      if (filters?.status && event.status !== filters.status) return false;
      if (filters?.riskLevel && event.risk.level !== filters.riskLevel) return false;
      return true;
    });
  }

  getAllAuditTrails(): AuditTrail[] {
    return Array.from(this.trails.values());
  }

  getAllAuditReports(): AuditReport[] {
    return Array.from(this.reports.values());
  }

  getAllAuditAlerts(): AuditAlert[] {
    return Array.from(this.alerts.values());
  }

  updateAuditAlert(id: string, updates: Partial<AuditAlert>): boolean {
    const alert = this.alerts.get(id);
    if (!alert) return false;

    Object.assign(alert, updates);
    alert.modified = new Date();
    return true;
  }

  deleteAuditAlert(id: string): boolean {
    return this.alerts.delete(id);
  }

  exportAuditTrail(trailId: string, format: 'json' | 'csv' | 'xml' = 'json'): string {
    const trail = this.trails.get(trailId);
    if (!trail) throw new Error('Audit trail not found');

    const data = {
      trail: trail,
      events: trail.events
    };

    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'csv':
        return this.convertToCSV(trail.events);
      case 'xml':
        return this.convertToXML(data);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  private convertToCSV(events: AuditEvent[]): string {
    if (events.length === 0) return '';

    const headers = ['id', 'timestamp', 'userId', 'action', 'resource', 'status', 'riskLevel'];
    const rows = events.map(event => [
      event.id,
      event.timestamp.toISOString(),
      event.userId,
      event.action,
      event.resource,
      event.status,
      event.risk.level
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  private convertToXML(data: any): string {
    // Simple XML conversion
    return `<?xml version="1.0" encoding="UTF-8"?><audit>${JSON.stringify(data)}</audit>`;
  }
}

export const auditTrailManager = new AuditTrailManager();