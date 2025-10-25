import { Component } from '../../types';

export interface SecurityConfig {
  id: string;
  userId: string;
  authentication: {
    enabled: boolean;
    method: 'password' | 'oauth' | 'saml' | 'ldap';
    mfa: {
      enabled: boolean;
      method: 'totp' | 'sms' | 'email' | 'hardware';
      required: boolean;
    };
    sessionTimeout: number; // minutes
    maxLoginAttempts: number;
    lockoutDuration: number; // minutes
  };
  authorization: {
    rbac: {
      enabled: boolean;
      roles: Array<{
        name: string;
        permissions: string[];
        inheritsFrom?: string[];
      }>;
    };
    abac: {
      enabled: boolean;
      policies: Array<{
        name: string;
        condition: string;
        effect: 'allow' | 'deny';
        priority: number;
      }>;
    };
  };
  encryption: {
    dataAtRest: {
      enabled: boolean;
      algorithm: 'aes-256-gcm' | 'chacha20-poly1305';
      keyRotation: number; // days
    };
    dataInTransit: {
      enabled: boolean;
      minTlsVersion: '1.2' | '1.3';
      cipherSuites: string[];
    };
    fileEncryption: {
      enabled: boolean;
      algorithm: 'aes-256-cbc' | 'aes-256-gcm';
    };
  };
  audit: {
    enabled: boolean;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    retentionPeriod: number; // days
    events: string[];
    alerts: Array<{
      event: string;
      threshold: number;
      action: 'email' | 'webhook' | 'disable_account';
    }>;
  };
  compliance: {
    standards: Array<'gdpr' | 'ccpa' | 'hipaa' | 'pci-dss' | 'sox' | 'iso27001'>;
    dataRetention: {
      personalData: number; // days
      logs: number; // days
      backups: number; // days
    };
    privacy: {
      dataMinimization: boolean;
      consentManagement: boolean;
      rightToDeletion: boolean;
      dataPortability: boolean;
    };
  };
  monitoring: {
    enabled: boolean;
    metrics: string[];
    alerts: Array<{
      metric: string;
      threshold: number;
      operator: 'gt' | 'lt' | 'eq';
      action: 'email' | 'webhook' | 'shutdown';
    }>;
    dashboards: Array<{
      name: string;
      metrics: string[];
      refreshInterval: number;
    }>;
  };
  incident: {
    response: {
      enabled: boolean;
      playbooks: Array<{
        incidentType: string;
        steps: string[];
        escalation: string[];
      }>;
      contacts: Array<{
        role: string;
        name: string;
        email: string;
        phone?: string;
      }>;
    };
  };
  created: Date;
  modified: Date;
}

export interface AuditLog {
  id: string;
  timestamp: Date;
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details: Record<string, any>;
  ipAddress: string;
  userAgent: string;
  sessionId?: string;
  success: boolean;
  errorMessage?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SecurityIncident {
  id: string;
  type: 'unauthorized_access' | 'data_breach' | 'malware' | 'ddos' | 'configuration_error' | 'policy_violation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'detected' | 'investigating' | 'contained' | 'resolved' | 'closed';
  description: string;
  detectedAt: Date;
  reportedBy?: string;
  assignedTo?: string;
  affectedResources: string[];
  impact: {
    users: number;
    data: string[];
    systems: string[];
    financial?: number;
  };
  timeline: Array<{
    timestamp: Date;
    action: string;
    actor: string;
    details: string;
  }>;
  evidence: Array<{
    type: 'log' | 'screenshot' | 'file' | 'network_traffic';
    location: string;
    description: string;
  }>;
  resolution?: {
    summary: string;
    preventiveActions: string[];
    lessonsLearned: string[];
  };
  created: Date;
  modified: Date;
}

export interface ComplianceReport {
  id: string;
  standard: string;
  period: {
    start: Date;
    end: Date;
  };
  status: 'compliant' | 'non_compliant' | 'partial' | 'not_assessed';
  score: number; // 0-100
  findings: Array<{
    requirement: string;
    status: 'pass' | 'fail' | 'not_applicable';
    evidence: string;
    remediation?: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  recommendations: string[];
  nextAuditDate?: Date;
  auditor?: string;
  created: Date;
}

export class SecurityManager {
  private configs: Map<string, SecurityConfig> = new Map();
  private auditLogs: AuditLog[] = [];
  private incidents: Map<string, SecurityIncident> = new Map();
  private complianceReports: Map<string, ComplianceReport> = new Map();

  createSecurityConfig(config: Omit<SecurityConfig, 'id' | 'created' | 'modified'>): SecurityConfig {
    const securityConfig: SecurityConfig = {
      ...config,
      id: `security_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.configs.set(securityConfig.id, securityConfig);
    return securityConfig;
  }

  logAuditEvent(event: Omit<AuditLog, 'id' | 'timestamp'>): void {
    const auditEvent: AuditLog = {
      ...event,
      id: `audit_${Date.now()}`,
      timestamp: new Date()
    };

    this.auditLogs.push(auditEvent);

    // Check for alerts
    this.checkAuditAlerts(auditEvent);

    // Cleanup old logs
    this.cleanupOldAuditLogs();
  }

  private checkAuditAlerts(event: AuditLog): void {
    const config = Array.from(this.configs.values()).find(c => c.userId === event.userId);
    if (!config?.audit.enabled) return;

    const alert = config.audit.alerts.find(a => a.event === event.action);
    if (!alert) return;

    // Count recent events of this type
    const recentEvents = this.auditLogs.filter(log =>
      log.userId === event.userId &&
      log.action === event.action &&
      (Date.now() - log.timestamp.getTime()) < (24 * 60 * 60 * 1000) // Last 24 hours
    );

    if (recentEvents.length >= alert.threshold) {
      this.triggerSecurityAlert(alert, event, recentEvents.length);
    }
  }

  private triggerSecurityAlert(alert: SecurityConfig['audit']['alerts'][0], event: AuditLog, count: number): void {
    console.log(`Security alert triggered: ${alert.event} occurred ${count} times`);

    // In practice, this would send notifications, disable accounts, etc.
    switch (alert.action) {
      case 'email':
        this.sendEmailAlert(alert, event, count);
        break;
      case 'webhook':
        this.sendWebhookAlert(alert, event, count);
        break;
      case 'disable_account':
        this.disableUserAccount(event.userId);
        break;
    }
  }

  private sendEmailAlert(alert: SecurityConfig['audit']['alerts'][0], event: AuditLog, count: number): void {
    // Email alert implementation
    console.log(`Sending email alert for ${alert.event}`);
  }

  private sendWebhookAlert(alert: SecurityConfig['audit']['alerts'][0], event: AuditLog, count: number): void {
    // Webhook alert implementation
    console.log(`Sending webhook alert for ${alert.event}`);
  }

  private disableUserAccount(userId: string): void {
    // Account disable implementation
    console.log(`Disabling account for user ${userId}`);
  }

  private cleanupOldAuditLogs(): void {
    const config = Array.from(this.configs.values())[0]; // Simplified - should be per user
    if (!config?.audit.retentionPeriod) return;

    const cutoffDate = new Date(Date.now() - (config.audit.retentionPeriod * 24 * 60 * 60 * 1000));
    this.auditLogs = this.auditLogs.filter(log => log.timestamp > cutoffDate);
  }

  createSecurityIncident(incident: Omit<SecurityIncident, 'id' | 'created' | 'modified'>): SecurityIncident {
    const securityIncident: SecurityIncident = {
      ...incident,
      id: `incident_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.incidents.set(securityIncident.id, securityIncident);

    // Trigger incident response
    this.triggerIncidentResponse(securityIncident);

    return securityIncident;
  }

  private triggerIncidentResponse(incident: SecurityIncident): void {
    const config = Array.from(this.configs.values()).find(c => c.userId === incident.reportedBy);
    if (!config?.incident.response.enabled) return;

    const playbook = config.incident.response.playbooks.find(p => p.incidentType === incident.type);
    if (!playbook) return;

    // Execute incident response playbook
    console.log(`Executing incident response playbook for ${incident.type}`);

    // Send notifications to incident response team
    config.incident.response.contacts.forEach(contact => {
      this.notifyIncidentContact(contact, incident);
    });
  }

  private notifyIncidentContact(contact: SecurityConfig['incident']['response']['contacts'][0], incident: SecurityIncident): void {
    // Send notification to incident response contact
    console.log(`Notifying ${contact.name} (${contact.role}) about incident ${incident.id}`);
  }

  updateIncidentStatus(incidentId: string, status: SecurityIncident['status'], updates?: Partial<SecurityIncident>): boolean {
    const incident = this.incidents.get(incidentId);
    if (!incident) return false;

    incident.status = status;
    incident.modified = new Date();

    if (updates) {
      Object.assign(incident, updates);
    }

    // Add timeline entry
    incident.timeline.push({
      timestamp: new Date(),
      action: `Status changed to ${status}`,
      actor: 'system',
      details: updates ? JSON.stringify(updates) : ''
    });

    return true;
  }

  generateComplianceReport(standard: string, startDate: Date, endDate: Date, auditor?: string): ComplianceReport {
    const report: ComplianceReport = {
      id: `compliance_${Date.now()}`,
      standard,
      period: { start: startDate, end: endDate },
      status: 'not_assessed',
      score: 0,
      findings: [],
      recommendations: [],
      auditor,
      created: new Date()
    };

    // Assess compliance based on standard
    const assessment = this.assessCompliance(standard, startDate, endDate);
    report.findings = assessment.findings;
    report.score = assessment.score;
    report.status = assessment.status;
    report.recommendations = assessment.recommendations;

    this.complianceReports.set(report.id, report);
    return report;
  }

  private assessCompliance(standard: string, startDate: Date, endDate: Date): {
    status: ComplianceReport['status'];
    score: number;
    findings: ComplianceReport['findings'];
    recommendations: string[];
  } {
    // Simplified compliance assessment
    const findings: ComplianceReport['findings'] = [];
    let score = 100;

    // Check audit logging
    const auditLogs = this.auditLogs.filter(log =>
      log.timestamp >= startDate && log.timestamp <= endDate
    );

    if (auditLogs.length === 0) {
      findings.push({
        requirement: 'Audit logging must be enabled',
        status: 'fail',
        evidence: 'No audit logs found for the period',
        remediation: 'Enable audit logging in security configuration',
        severity: 'high'
      });
      score -= 30;
    }

    // Check encryption
    const configs = Array.from(this.configs.values());
    const encryptionEnabled = configs.some(c => c.encryption.dataAtRest.enabled);

    if (!encryptionEnabled) {
      findings.push({
        requirement: 'Data at rest encryption must be enabled',
        status: 'fail',
        evidence: 'Encryption not configured',
        remediation: 'Configure data encryption in security settings',
        severity: 'critical'
      });
      score -= 40;
    }

    // Check MFA
    const mfaEnabled = configs.some(c => c.authentication.mfa.enabled);

    if (!mfaEnabled) {
      findings.push({
        requirement: 'Multi-factor authentication should be enabled',
        status: 'fail',
        evidence: 'MFA not configured for any users',
        remediation: 'Enable MFA for all user accounts',
        severity: 'medium'
      });
      score -= 15;
    }

    const status: ComplianceReport['status'] = score >= 80 ? 'compliant' :
                                               score >= 60 ? 'partial' : 'non_compliant';

    const recommendations = [
      'Implement regular security assessments',
      'Conduct security awareness training',
      'Establish incident response procedures',
      'Regular backup and recovery testing'
    ];

    return { status, score, findings, recommendations };
  }

  encryptData(data: string, algorithm: SecurityConfig['encryption']['dataAtRest']['algorithm'] = 'aes-256-gcm'): string {
    // Simplified encryption - in practice would use crypto APIs
    return btoa(data); // Base64 encoding as placeholder
  }

  decryptData(encryptedData: string, algorithm: SecurityConfig['encryption']['dataAtRest']['algorithm'] = 'aes-256-gcm'): string {
    // Simplified decryption
    return atob(encryptedData);
  }

  validatePassword(password: string): {
    valid: boolean;
    score: number;
    feedback: string[];
  } {
    const feedback: string[] = [];
    let score = 0;

    // Length check
    if (password.length >= 12) {
      score += 25;
    } else if (password.length >= 8) {
      score += 15;
      feedback.push('Password should be at least 12 characters long');
    } else {
      feedback.push('Password must be at least 8 characters long');
    }

    // Complexity checks
    if (/[a-z]/.test(password)) score += 20;
    else feedback.push('Include lowercase letters');

    if (/[A-Z]/.test(password)) score += 20;
    else feedback.push('Include uppercase letters');

    if (/\d/.test(password)) score += 15;
    else feedback.push('Include numbers');

    if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score += 20;
    else feedback.push('Include special characters');

    // Common password check
    const commonPasswords = ['password', '123456', 'qwerty', 'admin'];
    if (commonPasswords.includes(password.toLowerCase())) {
      score = 0;
      feedback.push('This is a commonly used password');
    }

    return {
      valid: score >= 60,
      score,
      feedback
    };
  }

  generateSecurityReport(userId: string, startDate: Date, endDate: Date): {
    summary: {
      totalEvents: number;
      securityIncidents: number;
      failedLogins: number;
      suspiciousActivities: number;
    };
    trends: {
      eventVolume: Array<{ date: string; count: number }>;
      incidentTrends: Array<{ date: string; count: number }>;
    };
    recommendations: string[];
  } {
    const userLogs = this.auditLogs.filter(log =>
      log.userId === userId &&
      log.timestamp >= startDate &&
      log.timestamp <= endDate
    );

    const userIncidents = Array.from(this.incidents.values()).filter(incident =>
      incident.reportedBy === userId &&
      incident.detectedAt >= startDate &&
      incident.detectedAt <= endDate
    );

    const failedLogins = userLogs.filter(log =>
      log.action === 'login' && !log.success
    ).length;

    const suspiciousActivities = userLogs.filter(log =>
      log.severity === 'high' || log.severity === 'critical'
    ).length;

    // Generate trends (simplified)
    const eventVolume = this.generateTrendData(userLogs, startDate, endDate);
    const incidentTrends = this.generateTrendData(userIncidents.map(i => ({
      timestamp: i.detectedAt,
      action: i.type
    })), startDate, endDate);

    const recommendations = [];
    if (failedLogins > 5) {
      recommendations.push('Consider enabling account lockout after failed login attempts');
    }
    if (userIncidents.length > 0) {
      recommendations.push('Review and improve incident response procedures');
    }
    if (suspiciousActivities > 10) {
      recommendations.push('Implement additional monitoring and alerting');
    }

    return {
      summary: {
        totalEvents: userLogs.length,
        securityIncidents: userIncidents.length,
        failedLogins,
        suspiciousActivities
      },
      trends: {
        eventVolume,
        incidentTrends
      },
      recommendations
    };
  }

  private generateTrendData(items: Array<{ timestamp: Date }>, startDate: Date, endDate: Date): Array<{ date: string; count: number }> {
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const trends = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate.getTime() + (i * 24 * 60 * 60 * 1000));
      const count = items.filter(item => {
        const itemDate = new Date(item.timestamp);
        return itemDate.toDateString() === date.toDateString();
      }).length;

      trends.push({
        date: date.toISOString().split('T')[0],
        count
      });
    }

    return trends;
  }

  getSecurityConfig(id: string): SecurityConfig | undefined {
    return this.configs.get(id);
  }

  getAuditLogs(userId?: string, startDate?: Date, endDate?: Date, action?: string): AuditLog[] {
    return this.auditLogs.filter(log => {
      if (userId && log.userId !== userId) return false;
      if (startDate && log.timestamp < startDate) return false;
      if (endDate && log.timestamp > endDate) return false;
      if (action && log.action !== action) return false;
      return true;
    });
  }

  getSecurityIncident(id: string): SecurityIncident | undefined {
    return this.incidents.get(id);
  }

  getAllSecurityIncidents(): SecurityIncident[] {
    return Array.from(this.incidents.values());
  }

  getComplianceReport(id: string): ComplianceReport | undefined {
    return this.complianceReports.get(id);
  }

  getAllComplianceReports(): ComplianceReport[] {
    return Array.from(this.complianceReports.values());
  }

  updateSecurityConfig(id: string, updates: Partial<SecurityConfig>): boolean {
    const config = this.configs.get(id);
    if (!config) return false;

    Object.assign(config, updates);
    config.modified = new Date();
    return true;
  }
}

export const securityManager = new SecurityManager();