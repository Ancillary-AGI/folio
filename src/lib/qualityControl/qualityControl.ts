import { Component } from '../../types';

export interface QualityControl {
  id: string;
  name: string;
  description: string;
  type: 'incoming' | 'in_process' | 'final' | 'audit' | 'calibration' | 'preventive';
  scope: {
    process: string;
    product: string;
    department: string;
    frequency: 'continuous' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly';
    sampleSize: number;
    acceptanceCriteria: {
      aql: number; // Acceptable Quality Level
      rql: number; // Rejectable Quality Level
      confidence: number;
    };
  };
  parameters: Array<{
    name: string;
    description: string;
    type: 'measurement' | 'attribute' | 'count';
    unit: string;
    specification: {
      target: number;
      upperLimit: number;
      lowerLimit: number;
      critical: boolean;
    };
    measurement: {
      method: string;
      equipment: string;
      precision: number;
      accuracy: number;
    };
  }>;
  sampling: {
    plan: 'single' | 'double' | 'multiple' | 'sequential' | 'continuous';
    standard: 'mil_std_105' | 'iso_2859' | 'ansi_z1_4' | 'custom';
    level: 'I' | 'II' | 'III' | 'S-1' | 'S-2' | 'S-3' | 'S-4';
    lotSize: number;
    sampleSize: number;
    acceptanceNumber: number;
    rejectionNumber: number;
  };
  inspection: {
    checklist: Array<{
      item: string;
      method: string;
      criteria: string;
      critical: boolean;
      evidence: string;
    }>;
    procedures: Array<{
      step: number;
      description: string;
      time: number; // minutes
      responsible: string;
      documentation: string;
    }>;
    equipment: Array<{
      name: string;
      type: string;
      calibration: {
        due: Date;
        last: Date;
        status: 'current' | 'overdue' | 'scheduled';
      };
      location: string;
    }>;
  };
  data: Array<{
    batch: string;
    timestamp: Date;
    inspector: string;
    results: Record<string, {
      value: number;
      status: 'pass' | 'fail' | 'marginal';
      notes?: string;
    }>;
    overall: {
      status: 'accepted' | 'rejected' | 'conditional';
      defects: number;
      defectRate: number;
      disposition: string;
    };
  }>;
  trends: {
    defectRates: Array<{
      period: Date;
      rate: number;
      target: number;
      trend: 'improving' | 'stable' | 'degrading';
    }>;
    capability: {
      cp: number;
      cpk: number;
      sigma: number;
      lastUpdated: Date;
    };
    pareto: {
      defects: Array<{
        type: string;
        count: number;
        percentage: number;
      }>;
      vitalFew: string[];
    };
  };
  actions: Array<{
    id: string;
    type: 'corrective' | 'preventive' | 'improvement';
    trigger: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    owner: string;
    dueDate: Date;
    status: 'open' | 'in_progress' | 'completed' | 'cancelled';
    effectiveness: number; // 1-5 scale
    lessons: string[];
  }>;
  reports: {
    summary: {
      totalInspections: number;
      passRate: number;
      defectRate: number;
      trends: 'improving' | 'stable' | 'degrading';
      lastReport: Date;
    };
    certifications: Array<{
      standard: string;
      issued: Date;
      expires: Date;
      status: 'current' | 'expiring' | 'expired';
      auditor: string;
    }>;
  };
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'inactive' | 'archived';
    version: number;
    tags: string[];
    priority: 'strategic' | 'operational' | 'tactical';
  };
}

export interface QualityAudit {
  id: string;
  name: string;
  description: string;
  type: 'internal' | 'external' | 'supplier' | 'regulatory' | 'customer';
  scope: {
    area: string;
    processes: string[];
    standards: string[];
    period: {
      start: Date;
      end: Date;
    };
  };
  team: Array<{
    name: string;
    role: 'lead_auditor' | 'auditor' | 'technical_expert' | 'observer';
    qualifications: string[];
    assignments: string[];
  }>;
  checklist: Array<{
    category: string;
    requirement: string;
    reference: string;
    method: string;
    criteria: string;
    evidence: string;
    finding: {
      status: 'conformant' | 'nonconformant' | 'opportunity' | 'not_applicable';
      severity: 'critical' | 'major' | 'minor' | 'observation';
      description: string;
      evidence: string;
      rootCause?: string;
    };
  }>;
  findings: Array<{
    id: string;
    category: 'nonconformance' | 'observation' | 'opportunity';
    description: string;
    severity: 'critical' | 'major' | 'minor' | 'observation';
    clause: string;
    evidence: string;
    rootCause: string;
    correctiveAction: {
      description: string;
      owner: string;
      dueDate: Date;
      status: 'open' | 'in_progress' | 'completed' | 'verified';
      verification: string;
      effectiveness: number;
    };
  }>;
  report: {
    executiveSummary: string;
    scope: string;
    methodology: string;
    findings: {
      total: number;
      critical: number;
      major: number;
      minor: number;
      observations: number;
    };
    conclusions: string;
    recommendations: Array<{
      priority: 'high' | 'medium' | 'low';
      description: string;
      timeline: string;
      responsible: string;
    }>;
    followUp: {
      required: boolean;
      date?: Date;
      scope: string;
    };
  };
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'planned' | 'in_progress' | 'completed' | 'closed';
    auditDate: Date;
    completionDate?: Date;
    tags: string[];
  };
}

export interface CalibrationManagement {
  id: string;
  name: string;
  description: string;
  equipment: {
    id: string;
    name: string;
    type: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    location: string;
    criticality: 'high' | 'medium' | 'low';
  };
  calibration: {
    method: string;
    standard: string;
    frequency: number; // days
    tolerance: {
      upper: number;
      lower: number;
      unit: string;
    };
    procedure: Array<{
      step: number;
      description: string;
      expected: string;
      tolerance: string;
    }>;
    lastCalibration: {
      date: Date;
      performedBy: string;
      results: Array<{
        parameter: string;
        measured: number;
        expected: number;
        deviation: number;
        status: 'pass' | 'fail' | 'marginal';
      }>;
      overall: {
        status: 'pass' | 'fail' | 'conditional';
        certificate: string;
        nextDue: Date;
        notes: string;
      };
    };
    schedule: Array<{
      dueDate: Date;
      status: 'scheduled' | 'overdue' | 'completed' | 'cancelled';
      assignedTo: string;
      completedDate?: Date;
    }>;
  };
  maintenance: {
    schedule: Array<{
      type: 'preventive' | 'corrective' | 'predictive';
      description: string;
      frequency: number; // days
      lastPerformed?: Date;
      nextDue: Date;
      status: 'scheduled' | 'overdue' | 'completed';
    }>;
    history: Array<{
      date: Date;
      type: string;
      description: string;
      performedBy: string;
      cost: number;
      downtime: number; // hours
      parts: string[];
    }>;
  };
  traceability: {
    standards: string[];
    references: string[];
    certificates: Array<{
      number: string;
      issued: Date;
      expires: Date;
      issuer: string;
      status: 'current' | 'expired' | 'revoked';
    }>;
  };
  alerts: Array<{
    type: 'calibration_due' | 'calibration_overdue' | 'maintenance_due' | 'failure';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    triggered: Date;
    acknowledged: boolean;
    resolved: boolean;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'inactive' | 'retired';
    criticality: 'high' | 'medium' | 'low';
    tags: string[];
  };
}

export class QualityControlManager {
  private qualityControls: Map<string, QualityControl> = new Map();
  private qualityAudits: Map<string, QualityAudit> = new Map();
  private calibrations: Map<string, CalibrationManagement> = new Map();

  createQualityControl(qc: Omit<QualityControl, 'id' | 'data' | 'trends' | 'actions'>): QualityControl {
    const newQC: QualityControl = {
      ...qc,
      id: `qc_${Date.now()}`,
      data: [],
      trends: {
        defectRates: [],
        capability: {
          cp: 0,
          cpk: 0,
          sigma: 0,
          lastUpdated: new Date()
        },
        pareto: {
          defects: [],
          vitalFew: []
        }
      },
      actions: []
    };

    this.qualityControls.set(newQC.id, newQC);
    return newQC;
  }

  createQualityAudit(audit: Omit<QualityAudit, 'id' | 'findings' | 'report'>): QualityAudit {
    const newAudit: QualityAudit = {
      ...audit,
      id: `audit_${Date.now()}`,
      findings: [],
      report: {
        executiveSummary: '',
        scope: '',
        methodology: '',
        findings: {
          total: 0,
          critical: 0,
          major: 0,
          minor: 0,
          observations: 0
        },
        conclusions: '',
        recommendations: [],
        followUp: {
          required: false
        }
      }
    };

    this.qualityAudits.set(newAudit.id, newAudit);
    return newAudit;
  }

  createCalibrationManagement(cal: Omit<CalibrationManagement, 'id' | 'alerts'>): CalibrationManagement {
    const newCal: CalibrationManagement = {
      ...cal,
      id: `cal_${Date.now()}`,
      alerts: []
    };

    this.calibrations.set(newCal.id, newCal);
    return newCal;
  }

  performQualityInspection(qcId: string, batch: string, inspector: string, measurements: Record<string, number>): Promise<InspectionResult> {
    return new Promise((resolve) => {
      const qc = this.qualityControls.get(qcId);
      if (!qc) {
        resolve({ success: false, error: 'Quality control not found' });
        return;
      }

      // Simulate inspection
      setTimeout(() => {
        const result = this.performInspection(qc, batch, inspector, measurements);

        // Add to QC data
        qc.data.push(result.inspectionData);

        // Update trends
        this.updateQualityTrends(qc);

        resolve({
          success: true,
          qcId,
          batch,
          status: result.inspectionData.overall.status,
          defects: result.inspectionData.overall.defects,
          defectRate: result.inspectionData.overall.defectRate,
          inspectionTime: Date.now()
        });
      }, 1000 + Math.random() * 2000); // 1-3 seconds
    });
  }

  private performInspection(qc: QualityControl, batch: string, inspector: string, measurements: Record<string, number>): {
    inspectionData: QualityControl['data'][0];
    passCount: number;
    failCount: number;
  } {
    const results: Record<string, { value: number; status: 'pass' | 'fail' | 'marginal'; notes?: string }> = {};
    let defects = 0;

    qc.parameters.forEach(param => {
      const value = measurements[param.name];
      let status: 'pass' | 'fail' | 'marginal' = 'pass';
      let notes: string | undefined;

      if (value < param.specification.lowerLimit || value > param.specification.upperLimit) {
        status = 'fail';
        defects++;
        notes = `Out of spec: ${value} ${param.unit}`;
      } else if (value < param.specification.target * 0.95 || value > param.specification.target * 1.05) {
        status = 'marginal';
        notes = `Near limit: ${value} ${param.unit}`;
      }

      results[param.name] = { value, status, notes };
    });

    const defectRate = defects / qc.parameters.length;
    let overallStatus: 'accepted' | 'rejected' | 'conditional' = 'accepted';

    if (defectRate > qc.scope.acceptanceCriteria.rql) {
      overallStatus = 'rejected';
    } else if (defectRate > qc.scope.acceptanceCriteria.aql) {
      overallStatus = 'conditional';
    }

    const inspectionData: QualityControl['data'][0] = {
      batch,
      timestamp: new Date(),
      inspector,
      results,
      overall: {
        status: overallStatus,
        defects,
        defectRate,
        disposition: overallStatus === 'accepted' ? 'Released' : overallStatus === 'conditional' ? 'Rework required' : 'Rejected'
      }
    };

    return {
      inspectionData,
      passCount: qc.parameters.length - defects,
      failCount: defects
    };
  }

  private updateQualityTrends(qc: QualityControl): void {
    // Calculate defect rates over time
    const recentData = qc.data.slice(-30); // Last 30 inspections
    const defectRates = recentData.map(d => ({
      period: d.timestamp,
      rate: d.overall.defectRate,
      target: qc.scope.acceptanceCriteria.aql,
      trend: 'stable' as const
    }));

    // Calculate capability
    const allValues = qc.data.flatMap(d =>
      qc.parameters.map(p => d.results[p.name]?.value || 0)
    );

    if (allValues.length > 0) {
      const mean = allValues.reduce((sum, v) => sum + v, 0) / allValues.length;
      const stdDev = Math.sqrt(allValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / allValues.length);

      const target = qc.parameters[0]?.specification.target || mean;
      const usl = qc.parameters[0]?.specification.upperLimit || mean + 3 * stdDev;
      const lsl = qc.parameters[0]?.specification.lowerLimit || mean - 3 * stdDev;

      const cp = (usl - lsl) / (6 * stdDev);
      const cpk = Math.min((usl - mean) / (3 * stdDev), (mean - lsl) / (3 * stdDev));

      qc.trends.capability = {
        cp,
        cpk,
        sigma: cp,
        lastUpdated: new Date()
      };
    }

    qc.trends.defectRates = defectRates;
  }

  conductQualityAudit(auditId: string): Promise<AuditResult> {
    return new Promise((resolve) => {
      const audit = this.qualityAudits.get(auditId);
      if (!audit) {
        resolve({ success: false, error: 'Quality audit not found' });
        return;
      }

      // Simulate audit execution
      setTimeout(() => {
        const result = this.performQualityAudit(audit);

        // Update audit with results
        audit.findings = result.findings;
        audit.report = result.report;
        audit.metadata.status = 'completed';
        audit.metadata.completionDate = new Date();

        resolve({
          success: true,
          auditId,
          findings: result.findings.length,
          critical: result.report.findings.critical,
          major: result.report.findings.major,
          status: 'completed',
          auditTime: Date.now()
        });
      }, 3000 + Math.random() * 5000); // 3-8 seconds
    });
  }

  private performQualityAudit(audit: QualityAudit): {
    findings: QualityAudit['findings'];
    report: QualityAudit['report'];
  } {
    // Generate sample findings
    const findings: QualityAudit['findings'] = [
      {
        id: `finding_${Date.now()}_1`,
        category: 'nonconformance',
        description: 'Documentation not updated after process change',
        severity: 'major',
        clause: '4.1',
        evidence: 'Process documentation dated 2023, change implemented in 2024',
        rootCause: 'Lack of change management procedure',
        correctiveAction: {
          description: 'Update documentation and implement change control process',
          owner: 'Quality Manager',
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          status: 'open',
          verification: 'Audit documentation and verify implementation',
          effectiveness: 0
        }
      },
      {
        id: `finding_${Date.now()}_2`,
        category: 'observation',
        description: 'Training records could be more detailed',
        severity: 'minor',
        clause: '7.2',
        evidence: 'Training records lack specific competencies covered',
        rootCause: 'Training record template needs enhancement',
        correctiveAction: {
          description: 'Update training record template',
          owner: 'HR Manager',
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
          status: 'open',
          verification: 'Review updated template',
          effectiveness: 0
        }
      }
    ];

    const report: QualityAudit['report'] = {
      executiveSummary: `Quality audit completed for ${audit.scope.area}. ${findings.length} findings identified.`,
      scope: audit.scope.area,
      methodology: 'Document review, interviews, and process observation',
      findings: {
        total: findings.length,
        critical: findings.filter(f => f.severity === 'critical').length,
        major: findings.filter(f => f.severity === 'major').length,
        minor: findings.filter(f => f.severity === 'minor').length,
        observations: findings.filter(f => f.severity === 'observation').length
      },
      conclusions: 'Overall quality management system is effective with opportunities for improvement.',
      recommendations: [
        {
          priority: 'high',
          description: 'Implement robust change management process',
          timeline: '30 days',
          responsible: 'Quality Manager'
        },
        {
          priority: 'medium',
          description: 'Enhance training record documentation',
          timeline: '14 days',
          responsible: 'HR Manager'
        }
      ],
      followUp: {
        required: true,
        date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        scope: 'Verify corrective action implementation'
      }
    };

    return { findings, report };
  }

  scheduleCalibration(calId: string, dueDate: Date, assignedTo: string): Promise<CalibrationResult> {
    return new Promise((resolve) => {
      const cal = this.calibrations.get(calId);
      if (!cal) {
        resolve({ success: false, error: 'Calibration not found' });
        return;
      }

      // Add to schedule
      cal.calibration.schedule.push({
        dueDate,
        status: 'scheduled',
        assignedTo
      });

      // Check for alerts
      const daysUntilDue = Math.ceil((dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysUntilDue <= 30) {
        cal.alerts.push({
          type: 'calibration_due',
          severity: daysUntilDue <= 7 ? 'high' : 'medium',
          message: `Calibration due in ${daysUntilDue} days`,
          triggered: new Date(),
          acknowledged: false,
          resolved: false
        });
      }

      resolve({
        success: true,
        calId,
        scheduled: true,
        dueDate,
        assignedTo,
        daysUntilDue,
        scheduleTime: Date.now()
      });
    });
  }

  getQualityControl(id: string): QualityControl | undefined {
    return this.qualityControls.get(id);
  }

  getQualityAudit(id: string): QualityAudit | undefined {
    return this.qualityAudits.get(id);
  }

  getCalibrationManagement(id: string): CalibrationManagement | undefined {
    return this.calibrations.get(id);
  }

  getAllQualityControls(): QualityControl[] {
    return Array.from(this.qualityControls.values());
  }

  getAllQualityAudits(): QualityAudit[] {
    return Array.from(this.qualityAudits.values());
  }

  getAllCalibrationManagement(): CalibrationManagement[] {
    return Array.from(this.calibrations.values());
  }

  updateQualityControl(id: string, updates: Partial<QualityControl>): boolean {
    const qc = this.qualityControls.get(id);
    if (!qc) return false;

    Object.assign(qc, updates);
    qc.metadata.updated = new Date();
    return true;
  }

  deleteQualityControl(id: string): boolean {
    return this.qualityControls.delete(id);
  }

  exportQualityControlConfiguration(): Record<string, unknown> {
    return {
      qualityControls: Array.from(this.qualityControls.values()),
      qualityAudits: Array.from(this.qualityAudits.values()),
      calibrations: Array.from(this.calibrations.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface InspectionResult {
  success: boolean;
  error?: string;
  qcId?: string;
  batch?: string;
  status?: string;
  defects?: number;
  defectRate?: number;
  inspectionTime?: number;
}

interface AuditResult {
  success: boolean;
  error?: string;
  auditId?: string;
  findings?: number;
  critical?: number;
  major?: number;
  status?: string;
  auditTime?: number;
}

interface CalibrationResult {
  success: boolean;
  error?: string;
  calId?: string;
  scheduled?: boolean;
  dueDate?: Date;
  assignedTo?: string;
  daysUntilDue?: number;
  scheduleTime?: number;
}

export const qualityControlManager = new QualityControlManager();