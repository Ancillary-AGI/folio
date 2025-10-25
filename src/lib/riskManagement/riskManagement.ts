import { Component } from '../../types';

export interface Risk {
  id: string;
  name: string;
  description: string;
  category: 'strategic' | 'operational' | 'financial' | 'compliance' | 'reputational' | 'technological' | 'supply_chain' | 'market' | 'environmental' | 'health_safety';
  type: 'threat' | 'opportunity' | 'uncertainty';
  source: string;
  owner: string;
  probability: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  impact: 'very_low' | 'low' | 'medium' | 'high' | 'very_high';
  riskScore: number; // probability * impact
  timeframe: 'immediate' | 'short_term' | 'medium_term' | 'long_term';
  status: 'identified' | 'assessed' | 'mitigated' | 'accepted' | 'transferred' | 'avoided' | 'occurred';
  detection: {
    method: string;
    date: Date;
    detectedBy: string;
  };
  assessment: {
    qualitative: {
      likelihood: number; // 1-5
      consequence: number; // 1-5
      velocity: number; // how quickly impact materializes
    };
    quantitative: {
      expectedLoss: number;
      worstCaseLoss: number;
      bestCaseLoss: number;
      currency: string;
    };
  };
  mitigation: Array<{
    id: string;
    strategy: 'avoid' | 'mitigate' | 'transfer' | 'accept' | 'exploit';
    action: string;
    responsible: string;
    dueDate: Date;
    cost: number;
    effectiveness: number; // 0-1
    status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
    result?: string;
  }>;
  monitoring: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
    indicators: Array<{
      name: string;
      current: number;
      threshold: number;
      trend: 'improving' | 'stable' | 'worsening';
    }>;
    lastReview: Date;
    nextReview: Date;
  };
  contingency: {
    trigger: string;
    plan: string;
    responsible: string;
    resources: string[];
    tested: boolean;
    lastTest: Date;
  };
  lessons: Array<{
    event: string;
    lesson: string;
    application: string;
    date: Date;
  }>;
  metadata: {
    created: Date;
    lastModified: Date;
    tags: string[];
    priority: 'low' | 'medium' | 'high' | 'critical';
    escalation: boolean;
  };
}

export interface RiskRegister {
  id: string;
  name: string;
  scope: 'project' | 'program' | 'portfolio' | 'organization';
  scopeId: string; // project/program/portfolio/organization ID
  period: {
    start: Date;
    end: Date;
  };
  riskAppetite: {
    overall: number; // 1-10 scale
    categories: Record<string, number>;
    thresholds: {
      high: number;
      medium: number;
      low: number;
    };
  };
  riskProfile: {
    totalRisks: number;
    highRisks: number;
    mediumRisks: number;
    lowRisks: number;
    riskScore: number;
    trend: 'improving' | 'stable' | 'worsening';
  };
  heatMap: {
    categories: string[];
    probabilityLevels: string[];
    impactLevels: string[];
    data: Array<Array<number>>; // risk count by probability/impact
  };
  topRisks: Array<{
    riskId: string;
    score: number;
    trend: 'increasing' | 'stable' | 'decreasing';
  }>;
  mitigation: {
    planned: number;
    inProgress: number;
    completed: number;
    effectiveness: number;
  };
  reporting: {
    frequency: 'weekly' | 'monthly' | 'quarterly';
    stakeholders: string[];
    format: 'dashboard' | 'report' | 'presentation';
    lastReport: Date;
  };
}

export interface RiskAssessment {
  id: string;
  name: string;
  type: 'qualitative' | 'quantitative' | 'semi_quantitative';
  methodology: 'brainstorming' | 'delphi' | 'checklist' | 'swot' | 'pestel' | 'monte_carlo' | 'fault_tree' | 'fmea';
  scope: {
    area: string;
    boundaries: string[];
    assumptions: string[];
    exclusions: string[];
  };
  stakeholders: Array<{
    name: string;
    role: string;
    expertise: string[];
    bias: string;
  }>;
  criteria: {
    probability: Array<{
      level: string;
      description: string;
      value: number;
    }>;
    impact: Array<{
      level: string;
      description: string;
      value: number;
      categories: string[];
    }>;
  };
  risks: Array<{
    id: string;
    description: string;
    probability: number;
    impact: number;
    score: number;
    owner: string;
    mitigation: string;
  }>;
  analysis: {
    summary: string;
    keyFindings: string[];
    recommendations: string[];
    uncertainties: string[];
  };
  validation: {
    method: string;
    results: string;
    confidence: number;
  };
  metadata: {
    conducted: Date;
    facilitator: string;
    participants: string[];
    duration: number; // hours
    cost: number;
  };
}

export interface RiskMonitoring {
  id: string;
  name: string;
  riskId: string;
  monitoring: {
    type: 'active' | 'passive';
    frequency: 'continuous' | 'daily' | 'weekly' | 'monthly';
    method: 'automated' | 'manual' | 'hybrid';
  };
  indicators: Array<{
    id: string;
    name: string;
    type: 'leading' | 'lagging';
    source: string;
    current: number;
    target: number;
    threshold: {
      warning: number;
      critical: number;
    };
    trend: 'improving' | 'stable' | 'worsening';
    lastUpdate: Date;
  }>;
  alerts: Array<{
    id: string;
    condition: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    triggered: Date;
    acknowledged: boolean;
    resolved: Date;
    action: string;
  }>;
  reports: Array<{
    id: string;
    date: Date;
    status: string;
    changes: string[];
    actions: string[];
  }>;
  escalation: {
    triggers: Array<{
      condition: string;
      level: string;
      action: string;
    }>;
    history: Array<{
      date: Date;
      level: string;
      reason: string;
      action: string;
    }>;
  };
}

export interface RiskMitigation {
  id: string;
  name: string;
  riskId: string;
  strategy: {
    primary: 'avoid' | 'mitigate' | 'transfer' | 'accept';
    secondary?: string;
    rationale: string;
  };
  actions: Array<{
    id: string;
    description: string;
    type: 'preventive' | 'corrective' | 'contingency';
    responsible: string;
    dueDate: Date;
    budget: number;
    resources: string[];
    dependencies: string[];
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
    progress: number;
    startDate?: Date;
    completionDate?: Date;
  }>;
  controls: Array<{
    id: string;
    type: 'detective' | 'preventive' | 'corrective' | 'directive';
    description: string;
    frequency: string;
    responsible: string;
    effectiveness: number;
    cost: number;
    lastTest: Date;
    nextTest: Date;
  }>;
  transfer: {
    method?: 'insurance' | 'contract' | 'outsourcing';
    provider?: string;
    coverage: number;
    premium: number;
    deductible: number;
    expiry: Date;
  };
  residual: {
    probability: number;
    impact: number;
    score: number;
    acceptable: boolean;
  };
  monitoring: {
    effectiveness: number;
    cost: number;
    schedule: string;
    responsible: string;
  };
}

export interface RiskReporting {
  id: string;
  name: string;
  type: 'dashboard' | 'report' | 'presentation' | 'briefing';
  audience: string;
  frequency: 'ad_hoc' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
  scope: {
    period: {
      start: Date;
      end: Date;
    };
    categories: string[];
    riskLevels: string[];
  };
  content: {
    executiveSummary: string;
    keyMetrics: Record<string, number>;
    topRisks: Array<{
      risk: string;
      score: number;
      trend: string;
      mitigation: string;
    }>;
    trends: Array<{
      category: string;
      change: number;
      drivers: string[];
    }>;
    recommendations: string[];
  };
  visualization: {
    heatMap: boolean;
    trendCharts: boolean;
    riskProfile: boolean;
    mitigationProgress: boolean;
  };
  distribution: {
    recipients: string[];
    method: 'email' | 'portal' | 'meeting' | 'printed';
    schedule: Date;
    status: 'draft' | 'approved' | 'distributed';
  };
  feedback: Array<{
    recipient: string;
    response: string;
    date: Date;
    action: string;
  }>;
}

export class RiskManagementManager {
  private risks: Map<string, Risk> = new Map();
  private registers: Map<string, RiskRegister> = new Map();
  private assessments: Map<string, RiskAssessment> = new Map();
  private monitoring: Map<string, RiskMonitoring> = new Map();
  private mitigations: Map<string, RiskMitigation> = new Map();
  private reports: Map<string, RiskReporting> = new Map();

  createRisk(risk: Omit<Risk, 'id'>): Risk {
    const newRisk: Risk = {
      ...risk,
      id: `risk_${Date.now()}`
    };

    this.risks.set(newRisk.id, newRisk);
    return newRisk;
  }

  createRiskRegister(register: Omit<RiskRegister, 'id'>): RiskRegister {
    const riskRegister: RiskRegister = {
      ...register,
      id: `register_${Date.now()}`
    };

    this.registers.set(riskRegister.id, riskRegister);
    return riskRegister;
  }

  createRiskAssessment(assessment: Omit<RiskAssessment, 'id'>): RiskAssessment {
    const riskAssessment: RiskAssessment = {
      ...assessment,
      id: `assessment_${Date.now()}`
    };

    this.assessments.set(riskAssessment.id, riskAssessment);
    return riskAssessment;
  }

  createRiskMonitoring(monitoring: Omit<RiskMonitoring, 'id'>): RiskMonitoring {
    const riskMonitoring: RiskMonitoring = {
      ...monitoring,
      id: `monitoring_${Date.now()}`
    };

    this.monitoring.set(riskMonitoring.id, riskMonitoring);
    return riskMonitoring;
  }

  createRiskMitigation(mitigation: Omit<RiskMitigation, 'id'>): RiskMitigation {
    const riskMitigation: RiskMitigation = {
      ...mitigation,
      id: `mitigation_${Date.now()}`
    };

    this.mitigations.set(riskMitigation.id, riskMitigation);
    return riskMitigation;
  }

  createRiskReporting(report: Omit<RiskReporting, 'id'>): RiskReporting {
    const riskReporting: RiskReporting = {
      ...report,
      id: `report_${Date.now()}`
    };

    this.reports.set(riskReporting.id, riskReporting);
    return riskReporting;
  }

  assessRisk(riskId: string): Promise<RiskAssessmentResult> {
    return new Promise((resolve) => {
      const risk = this.risks.get(riskId);
      if (!risk) {
        resolve({ success: false, error: 'Risk not found' });
        return;
      }

      // Simulate risk assessment
      setTimeout(() => {
        const result = this.performRiskAssessment(risk);

        resolve({
          success: true,
          riskId,
          probability: result.probability,
          impact: result.impact,
          riskScore: result.riskScore,
          category: result.category,
          priority: result.priority,
          recommendations: result.recommendations,
          assessmentTime: Date.now()
        });
      }, 1000 + Math.random() * 2000); // 1-3 seconds
    });
  }

  private performRiskAssessment(risk: Risk): {
    probability: number;
    impact: number;
    riskScore: number;
    category: string;
    priority: string;
    recommendations: string[];
  } {
    const probabilityMap = { very_low: 1, low: 2, medium: 3, high: 4, very_high: 5 };
    const impactMap = { very_low: 1, low: 2, medium: 3, high: 4, very_high: 5 };

    const probability = probabilityMap[risk.probability];
    const impact = impactMap[risk.impact];
    const riskScore = probability * impact;

    let category = 'low';
    if (riskScore >= 16) category = 'critical';
    else if (riskScore >= 12) category = 'high';
    else if (riskScore >= 6) category = 'medium';

    let priority = 'low';
    if (riskScore >= 15) priority = 'critical';
    else if (riskScore >= 10) priority = 'high';
    else if (riskScore >= 5) priority = 'medium';

    const recommendations: string[] = [];
    if (riskScore >= 12) {
      recommendations.push('Immediate mitigation required');
      recommendations.push('Escalate to senior management');
    } else if (riskScore >= 6) {
      recommendations.push('Develop mitigation plan');
      recommendations.push('Regular monitoring required');
    } else {
      recommendations.push('Monitor periodically');
    }

    return { probability, impact, riskScore, category, priority, recommendations };
  }

  monitorRisk(monitoringId: string): Promise<MonitoringResult> {
    return new Promise((resolve) => {
      const monitoring = this.monitoring.get(monitoringId);
      if (!monitoring) {
        resolve({ success: false, error: 'Risk monitoring not found' });
        return;
      }

      // Simulate monitoring
      setTimeout(() => {
        const result = this.performRiskMonitoring(monitoring);

        resolve({
          success: true,
          monitoringId,
          status: result.status,
          indicators: result.indicators,
          alerts: result.alerts,
          changes: result.changes,
          actions: result.actions,
          monitoringTime: Date.now()
        });
      }, 500 + Math.random() * 1000); // 0.5-1.5 seconds
    });
  }

  private performRiskMonitoring(monitoring: RiskMonitoring): {
    status: string;
    indicators: RiskMonitoring['indicators'];
    alerts: RiskMonitoring['alerts'];
    changes: string[];
    actions: string[];
  } {
    // Simulate monitoring results
    const status = 'stable';
    const indicators = monitoring.indicators.map(indicator => ({
      ...indicator,
      current: indicator.current * (0.95 + Math.random() * 0.1),
      trend: ['improving', 'stable', 'worsening'][Math.floor(Math.random() * 3)] as any,
      lastUpdate: new Date()
    }));

    const alerts: RiskMonitoring['alerts'] = [];
    if (Math.random() > 0.8) {
      alerts.push({
        id: `alert_${Date.now()}`,
        condition: 'Threshold exceeded',
        severity: 'medium',
        triggered: new Date(),
        acknowledged: false,
        resolved: new Date(),
        action: 'Review mitigation plan'
      });
    }

    const changes = ['Minor indicator fluctuation'];
    const actions = ['Continue monitoring'];

    return { status, indicators, alerts, changes, actions };
  }

  implementMitigation(mitigationId: string): Promise<MitigationResult> {
    return new Promise((resolve) => {
      const mitigation = this.mitigations.get(mitigationId);
      if (!mitigation) {
        resolve({ success: false, error: 'Risk mitigation not found' });
        return;
      }

      // Simulate mitigation implementation
      setTimeout(() => {
        const result = this.performMitigationImplementation(mitigation);

        mitigation.actions = result.actions;
        mitigation.residual = result.residual;

        resolve({
          success: true,
          mitigationId,
          implementedActions: result.implementedActions,
          effectiveness: result.effectiveness,
          residualRisk: result.residualRisk,
          cost: result.cost,
          completionDate: result.completionDate,
          implementationTime: Date.now()
        });
      }, 3000 + Math.random() * 4000); // 3-7 seconds
    });
  }

  private performMitigationImplementation(mitigation: RiskMitigation): {
    actions: RiskMitigation['actions'];
    residual: RiskMitigation['residual'];
    implementedActions: number;
    effectiveness: number;
    residualRisk: number;
    cost: number;
    completionDate: Date;
  } {
    const actions = mitigation.actions.map(action => ({
      ...action,
      status: 'completed' as const,
      progress: 100,
      startDate: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      completionDate: new Date()
    }));

    const residual: RiskMitigation['residual'] = {
      probability: mitigation.residual.probability * 0.3, // 70% reduction
      impact: mitigation.residual.impact * 0.5, // 50% reduction
      score: mitigation.residual.score * 0.3,
      acceptable: mitigation.residual.score * 0.3 < 5
    };

    const implementedActions = actions.length;
    const effectiveness = 0.7 + Math.random() * 0.2;
    const residualRisk = residual.score;
    const cost = actions.reduce((sum, action) => sum + action.budget, 0);
    const completionDate = new Date();

    return { actions, residual, implementedActions, effectiveness, residualRisk, cost, completionDate };
  }

  generateRiskReport(registerId: string): Promise<ReportResult> {
    return new Promise((resolve) => {
      const register = this.registers.get(registerId);
      if (!register) {
        resolve({ success: false, error: 'Risk register not found' });
        return;
      }

      // Simulate report generation
      setTimeout(() => {
        const result = this.generateRiskReportData(register);

        resolve({
          success: true,
          registerId,
          report: result.report,
          summary: result.summary,
          recommendations: result.recommendations,
          riskProfile: result.riskProfile,
          generationTime: Date.now()
        });
      }, 1500 + Math.random() * 2000); // 1.5-3.5 seconds
    });
  }

  private generateRiskReportData(register: RiskRegister): {
    report: Record<string, unknown>;
    summary: string;
    recommendations: string[];
    riskProfile: RiskRegister['riskProfile'];
  } {
    const report: Record<string, unknown> = {
      period: register.period,
      totalRisks: register.riskProfile.totalRisks,
      highRisks: register.riskProfile.highRisks,
      riskScore: register.riskProfile.riskScore,
      topRisks: register.topRisks
    };

    const summary = `Risk assessment for ${register.scope} shows ${register.riskProfile.totalRisks} identified risks with ${register.riskProfile.highRisks} high-priority items. Overall risk score: ${register.riskProfile.riskScore}.`;

    const recommendations = [
      'Implement mitigation plans for high-priority risks',
      'Enhance monitoring for critical risk indicators',
      'Review risk appetite thresholds',
      'Update contingency plans'
    ];

    const riskProfile = register.riskProfile;

    return { report, summary, recommendations, riskProfile };
  }

  getRisk(id: string): Risk | undefined {
    return this.risks.get(id);
  }

  getRiskRegister(id: string): RiskRegister | undefined {
    return this.registers.get(id);
  }

  getRiskAssessment(id: string): RiskAssessment | undefined {
    return this.assessments.get(id);
  }

  getRiskMonitoring(id: string): RiskMonitoring | undefined {
    return this.monitoring.get(id);
  }

  getRiskMitigation(id: string): RiskMitigation | undefined {
    return this.mitigations.get(id);
  }

  getRiskReporting(id: string): RiskReporting | undefined {
    return this.reports.get(id);
  }

  getAllRisks(): Risk[] {
    return Array.from(this.risks.values());
  }

  getAllRiskRegisters(): RiskRegister[] {
    return Array.from(this.registers.values());
  }

  getAllRiskAssessments(): RiskAssessment[] {
    return Array.from(this.assessments.values());
  }

  getAllRiskMonitoring(): RiskMonitoring[] {
    return Array.from(this.monitoring.values());
  }

  getAllRiskMitigations(): RiskMitigation[] {
    return Array.from(this.mitigations.values());
  }

  getAllRiskReporting(): RiskReporting[] {
    return Array.from(this.reports.values());
  }

  updateRisk(id: string, updates: Partial<Risk>): boolean {
    const risk = this.risks.get(id);
    if (!risk) return false;

    Object.assign(risk, updates);
    risk.metadata.lastModified = new Date();
    return true;
  }

  deleteRisk(id: string): boolean {
    return this.risks.delete(id);
  }

  exportRiskManagementConfiguration(): Record<string, unknown> {
    return {
      risks: Array.from(this.risks.values()),
      registers: Array.from(this.registers.values()),
      assessments: Array.from(this.assessments.values()),
      monitoring: Array.from(this.monitoring.values()),
      mitigations: Array.from(this.mitigations.values()),
      reports: Array.from(this.reports.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface RiskAssessmentResult {
  success: boolean;
  error?: string;
  riskId?: string;
  probability?: number;
  impact?: number;
  riskScore?: number;
  category?: string;
  priority?: string;
  recommendations?: string[];
  assessmentTime?: number;
}

interface MonitoringResult {
  success: boolean;
  error?: string;
  monitoringId?: string;
  status?: string;
  indicators?: RiskMonitoring['indicators'];
  alerts?: RiskMonitoring['alerts'];
  changes?: string[];
  actions?: string[];
  monitoringTime?: number;
}

interface MitigationResult {
  success: boolean;
  error?: string;
  mitigationId?: string;
  implementedActions?: number;
  effectiveness?: number;
  residualRisk?: number;
  cost?: number;
  completionDate?: Date;
  implementationTime?: number;
}

interface ReportResult {
  success: boolean;
  error?: string;
  registerId?: string;
  report?: Record<string, unknown>;
  summary?: string;
  recommendations?: string[];
  riskProfile?: RiskRegister['riskProfile'];
  generationTime?: number;
}

export const riskManagementManager = new RiskManagementManager();