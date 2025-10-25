import { Component } from '../../types';

export interface CertificationWorkflow {
  id: string;
  name: string;
  description: string;
  standardId: string;
  category: 'safety' | 'emc' | 'environmental' | 'quality' | 'medical' | 'automotive';
  phases: Array<{
    id: string;
    name: string;
    description: string;
    order: number;
    duration: number; // days
    responsible: 'manufacturer' | 'lab' | 'authority' | 'consultant';
    deliverables: string[];
    checkpoints: Array<{
      id: string;
      name: string;
      description: string;
      required: boolean;
      validator?: string; // Function name for automated validation
    }>;
  }>;
  requiredDocuments: Array<{
    type: string;
    name: string;
    description: string;
    mandatory: boolean;
    template?: string;
  }>;
  testingRequirements: Array<{
    type: string;
    standard: string;
    description: string;
    accreditedLab: boolean;
    estimatedCost: number;
    estimatedDuration: number; // days
  }>;
  fees: {
    application: number;
    testing: number;
    certification: number;
    annual: number;
    total: number;
  };
  successCriteria: Array<{
    phase: string;
    criteria: string;
    measurement: string;
  }>;
  riskFactors: Array<{
    factor: string;
    impact: 'low' | 'medium' | 'high';
    mitigation: string;
  }>;
  created: Date;
  modified: Date;
}

export interface CertificationApplication {
  id: string;
  workflowId: string;
  productId: string;
  applicant: {
    companyName: string;
    contactPerson: string;
    email: string;
    phone: string;
    address: string;
  };
  product: {
    name: string;
    model: string;
    version: string;
    description: string;
    category: string;
    intendedUse: string;
    targetMarkets: string[];
  };
  status: 'draft' | 'submitted' | 'under_review' | 'testing' | 'approved' | 'rejected' | 'expired';
  currentPhase: string;
  progress: {
    completedPhases: string[];
    currentPhaseStart?: Date;
    estimatedCompletion?: Date;
  };
  documents: Array<{
    type: string;
    name: string;
    url: string;
    uploadedDate: Date;
    status: 'pending' | 'submitted' | 'approved' | 'rejected';
    comments?: string;
  }>;
  testResults: Array<{
    testType: string;
    labName: string;
    date: Date;
    result: 'pass' | 'fail' | 'conditional';
    reportUrl: string;
    certificateNumber?: string;
    expiryDate?: Date;
  }>;
  deficiencies: Array<{
    id: string;
    phase: string;
    description: string;
    severity: 'minor' | 'major' | 'critical';
    status: 'open' | 'addressed' | 'resolved';
    resolution?: string;
    dueDate?: Date;
  }>;
  communications: Array<{
    id: string;
    date: Date;
    from: string;
    to: string;
    subject: string;
    message: string;
    attachments?: string[];
  }>;
  fees: {
    paid: number;
    outstanding: number;
    dueDates: Array<{
      amount: number;
      description: string;
      dueDate: Date;
      status: 'pending' | 'paid' | 'overdue';
    }>;
  };
  timeline: Array<{
    date: Date;
    event: string;
    description: string;
    actor: string;
  }>;
  created: Date;
  modified: Date;
}

export interface QualityManagement {
  id: string;
  organizationId: string;
  standard: 'ISO9001' | 'ISO13485' | 'IATF16949' | 'AS9100';
  version: string;
  scope: string;
  qualityPolicy: string;
  qualityObjectives: Array<{
    id: string;
    objective: string;
    target: string;
    measure: string;
    responsible: string;
    deadline: Date;
  }>;
  processes: Array<{
    id: string;
    name: string;
    description: string;
    owner: string;
    inputs: string[];
    outputs: string[];
    controls: string[];
    metrics: Array<{
      name: string;
      target: number;
      current: number;
      trend: 'improving' | 'stable' | 'declining';
    }>;
  }>;
  audits: Array<{
    id: string;
    type: 'internal' | 'external' | 'supplier';
    date: Date;
    auditor: string;
    scope: string;
    findings: Array<{
      requirement: string;
      severity: 'minor' | 'major';
      description: string;
      correctiveAction: string;
      status: 'open' | 'closed';
    }>;
    score: number;
    reportUrl: string;
  }>;
  training: Array<{
    id: string;
    employeeId: string;
    course: string;
    completionDate: Date;
    score?: number;
    certification?: string;
    expiryDate?: Date;
  }>;
  nonConformities: Array<{
    id: string;
    date: Date;
    description: string;
    category: string;
    severity: 'minor' | 'major' | 'critical';
    rootCause: string;
    correctiveAction: string;
    preventiveAction: string;
    status: 'open' | 'closed';
    dueDate: Date;
  }>;
  continuousImprovement: Array<{
    id: string;
    initiative: string;
    objective: string;
    metrics: string[];
    startDate: Date;
    targetDate: Date;
    status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
    results?: string;
  }>;
  created: Date;
  modified: Date;
}

export class CertificationWorkflowManager {
  private workflows: Map<string, CertificationWorkflow> = new Map();
  private applications: Map<string, CertificationApplication> = new Map();
  private qualitySystems: Map<string, QualityManagement> = new Map();

  createCertificationWorkflow(workflow: Omit<CertificationWorkflow, 'id' | 'created' | 'modified'>): CertificationWorkflow {
    const certWorkflow: CertificationWorkflow = {
      ...workflow,
      id: `workflow_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.workflows.set(certWorkflow.id, certWorkflow);
    return certWorkflow;
  }

  createCertificationApplication(application: Omit<CertificationApplication, 'id' | 'created' | 'modified'>): CertificationApplication {
    const certApplication: CertificationApplication = {
      ...application,
      id: `application_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.applications.set(certApplication.id, certApplication);
    return certApplication;
  }

  createQualityManagementSystem(system: Omit<QualityManagement, 'id' | 'created' | 'modified'>): QualityManagement {
    const qms: QualityManagement = {
      ...system,
      id: `qms_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.qualitySystems.set(qms.id, qms);
    return qms;
  }

  advanceApplicationPhase(applicationId: string, newPhase: string, notes?: string): boolean {
    const application = this.applications.get(applicationId);
    if (!application) return false;

    const workflow = this.workflows.get(application.workflowId);
    if (!workflow) return false;

    const phaseExists = workflow.phases.some(p => p.id === newPhase);
    if (!phaseExists) return false;

    // Update progress
    if (!application.progress.completedPhases.includes(application.currentPhase)) {
      application.progress.completedPhases.push(application.currentPhase);
    }

    application.currentPhase = newPhase;
    application.progress.currentPhaseStart = new Date();

    // Calculate estimated completion
    const currentPhaseIndex = workflow.phases.findIndex(p => p.id === newPhase);
    const remainingPhases = workflow.phases.slice(currentPhaseIndex);
    const estimatedDays = remainingPhases.reduce((sum, phase) => sum + phase.duration, 0);
    application.progress.estimatedCompletion = new Date(Date.now() + estimatedDays * 24 * 60 * 60 * 1000);

    // Add timeline entry
    application.timeline.push({
      date: new Date(),
      event: 'phase_advanced',
      description: `Advanced to phase: ${workflow.phases.find(p => p.id === newPhase)?.name}`,
      actor: 'system'
    });

    if (notes) {
      application.timeline[application.timeline.length - 1].description += ` - ${notes}`;
    }

    application.modified = new Date();
    return true;
  }

  validatePhaseCheckpoints(applicationId: string, phaseId: string): {
    passed: boolean;
    results: Array<{
      checkpointId: string;
      passed: boolean;
      message: string;
    }>;
  } {
    const application = this.applications.get(applicationId);
    if (!application) {
      return { passed: false, results: [] };
    }

    const workflow = this.workflows.get(application.workflowId);
    if (!workflow) {
      return { passed: false, results: [] };
    }

    const phase = workflow.phases.find(p => p.id === phaseId);
    if (!phase) {
      return { passed: false, results: [] };
    }

    const results = phase.checkpoints.map(checkpoint => {
      // Simplified validation - in practice would call actual validators
      const passed = Math.random() > 0.2; // 80% pass rate for demo
      return {
        checkpointId: checkpoint.id,
        passed,
        message: passed ? 'Checkpoint passed' : 'Checkpoint failed - additional work required'
      };
    });

    const passed = results.every(r => r.passed);

    return { passed, results };
  }

  submitCertificationApplication(applicationId: string): boolean {
    const application = this.applications.get(applicationId);
    if (!application || application.status !== 'draft') return false;

    application.status = 'submitted';

    // Add timeline entry
    application.timeline.push({
      date: new Date(),
      event: 'submitted',
      description: 'Certification application submitted',
      actor: 'system'
    });

    application.modified = new Date();
    return true;
  }

  approveCertificationApplication(applicationId: string, certificateNumber: string, approvedBy: string): boolean {
    const application = this.applications.get(applicationId);
    if (!application || application.status !== 'testing') return false;

    application.status = 'approved';

    // Add certificate info
    application.testResults.forEach(result => {
      if (result.result === 'pass') {
        result.certificateNumber = certificateNumber;
        result.expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
      }
    });

    // Add timeline entry
    application.timeline.push({
      date: new Date(),
      event: 'approved',
      description: `Certification approved with certificate number: ${certificateNumber}`,
      actor: approvedBy
    });

    application.modified = new Date();
    return true;
  }

  rejectCertificationApplication(applicationId: string, reason: string, rejectedBy: string): boolean {
    const application = this.applications.get(applicationId);
    if (!application) return false;

    application.status = 'rejected';

    // Add timeline entry
    application.timeline.push({
      date: new Date(),
      event: 'rejected',
      description: `Certification rejected: ${reason}`,
      actor: rejectedBy
    });

    application.modified = new Date();
    return true;
  }

  addDeficiency(applicationId: string, deficiency: Omit<CertificationApplication['deficiencies'][0], 'id' | 'status'>): boolean {
    const application = this.applications.get(applicationId);
    if (!application) return false;

    const newDeficiency: CertificationApplication['deficiencies'][0] = {
      ...deficiency,
      id: `def_${Date.now()}`,
      status: 'open'
    };

    application.deficiencies.push(newDeficiency);

    // Add timeline entry
    application.timeline.push({
      date: new Date(),
      event: 'deficiency_added',
      description: `Deficiency added: ${deficiency.description}`,
      actor: 'system'
    });

    application.modified = new Date();
    return true;
  }

  resolveDeficiency(applicationId: string, deficiencyId: string, resolution: string): boolean {
    const application = this.applications.get(applicationId);
    if (!application) return false;

    const deficiency = application.deficiencies.find(d => d.id === deficiencyId);
    if (!deficiency) return false;

    deficiency.status = 'resolved';
    deficiency.resolution = resolution;

    // Add timeline entry
    application.timeline.push({
      date: new Date(),
      event: 'deficiency_resolved',
      description: `Deficiency resolved: ${deficiency.description}`,
      actor: 'system'
    });

    application.modified = new Date();
    return true;
  }

  conductQualityAudit(qmsId: string, audit: Omit<QualityManagement['audits'][0], 'id'>): boolean {
    const qms = this.qualitySystems.get(qmsId);
    if (!qms) return false;

    const newAudit: QualityManagement['audits'][0] = {
      ...audit,
      id: `audit_${Date.now()}`
    };

    qms.audits.push(newAudit);
    qms.modified = new Date();

    return true;
  }

  recordNonConformity(qmsId: string, nc: Omit<QualityManagement['nonConformities'][0], 'id' | 'status'>): boolean {
    const qms = this.qualitySystems.get(qmsId);
    if (!qms) return false;

    const newNC: QualityManagement['nonConformities'][0] = {
      ...nc,
      id: `nc_${Date.now()}`,
      status: 'open'
    };

    qms.nonConformities.push(newNC);
    qms.modified = new Date();

    return true;
  }

  closeNonConformity(qmsId: string, ncId: string, correctiveAction: string, preventiveAction: string): boolean {
    const qms = this.qualitySystems.get(qmsId);
    if (!qms) return false;

    const nc = qms.nonConformities.find(n => n.id === ncId);
    if (!nc) return false;

    nc.correctiveAction = correctiveAction;
    nc.preventiveAction = preventiveAction;
    nc.status = 'closed';

    qms.modified = new Date();
    return true;
  }

  addContinuousImprovementInitiative(qmsId: string, initiative: Omit<QualityManagement['continuousImprovement'][0], 'id' | 'status'>): boolean {
    const qms = this.qualitySystems.get(qmsId);
    if (!qms) return false;

    const newInitiative: QualityManagement['continuousImprovement'][0] = {
      ...initiative,
      id: `ci_${Date.now()}`,
      status: 'planned'
    };

    qms.continuousImprovement.push(newInitiative);
    qms.modified = new Date();

    return true;
  }

  generateCertificationReport(applicationId: string): string {
    const application = this.applications.get(applicationId);
    if (!application) throw new Error('Certification application not found');

    const workflow = this.workflows.get(application.workflowId);
    if (!workflow) throw new Error('Certification workflow not found');

    const report = {
      application,
      workflow,
      generatedAt: new Date(),
      summary: {
        status: application.status,
        currentPhase: workflow.phases.find(p => p.id === application.currentPhase)?.name,
        progress: `${application.progress.completedPhases.length}/${workflow.phases.length} phases completed`,
        deficiencies: application.deficiencies.filter(d => d.status === 'open').length,
        testResults: application.testResults.length
      },
      timeline: application.timeline,
      recommendations: this.generateCertificationRecommendations(application, workflow)
    };

    return JSON.stringify(report, null, 2);
  }

  private generateCertificationRecommendations(application: CertificationApplication, workflow: CertificationWorkflow): string[] {
    const recommendations: string[] = [];

    // Check for open deficiencies
    const openDeficiencies = application.deficiencies.filter(d => d.status === 'open');
    if (openDeficiencies.length > 0) {
      recommendations.push(`Address ${openDeficiencies.length} open deficiencies before proceeding`);
    }

    // Check testing status
    const failedTests = application.testResults.filter(t => t.result === 'fail');
    if (failedTests.length > 0) {
      recommendations.push(`Retest ${failedTests.length} failed test requirements`);
    }

    // Check documentation completeness
    const requiredDocs = workflow.requiredDocuments.filter(d => d.mandatory);
    const submittedDocs = application.documents.filter(d => d.status === 'submitted' || d.status === 'approved');
    const missingDocs = requiredDocs.length - submittedDocs.length;

    if (missingDocs > 0) {
      recommendations.push(`Submit ${missingDocs} missing required documents`);
    }

    // Check fees
    if (application.fees.outstanding > 0) {
      recommendations.push(`Pay outstanding fees: $${application.fees.outstanding}`);
    }

    return recommendations;
  }

  generateQualityReport(qmsId: string, period: { start: Date; end: Date }): string {
    const qms = this.qualitySystems.get(qmsId);
    if (!qms) throw new Error('Quality management system not found');

    const periodAudits = qms.audits.filter(a => a.date >= period.start && a.date <= period.end);
    const periodNCs = qms.nonConformities.filter(nc => nc.date >= period.start && nc.date <= period.end);

    const report = {
      qms,
      period,
      generatedAt: new Date(),
      summary: {
        auditsConducted: periodAudits.length,
        averageAuditScore: periodAudits.length > 0 ?
          periodAudits.reduce((sum, a) => sum + a.score, 0) / periodAudits.length : 0,
        nonConformities: periodNCs.length,
        closedNCs: periodNCs.filter(nc => nc.status === 'closed').length,
        trainingCompleted: qms.training.filter(t => t.completionDate >= period.start && t.completionDate <= period.end).length,
        improvementInitiatives: qms.continuousImprovement.filter(ci =>
          ci.startDate >= period.start && ci.targetDate <= period.end
        ).length
      },
      metrics: qms.processes.map(process => ({
        processName: process.name,
        metrics: process.metrics
      })),
      recommendations: this.generateQualityRecommendations(qms, period)
    };

    return JSON.stringify(report, null, 2);
  }

  private generateQualityRecommendations(qms: QualityManagement, period: { start: Date; end: Date }): string[] {
    const recommendations: string[] = [];

    // Check audit scores
    const recentAudits = qms.audits.filter(a => a.date >= period.start && a.date <= period.end);
    const avgScore = recentAudits.length > 0 ?
      recentAudits.reduce((sum, a) => sum + a.score, 0) / recentAudits.length : 100;

    if (avgScore < 85) {
      recommendations.push('Improve audit scores through additional training and process improvements');
    }

    // Check non-conformities
    const openNCs = qms.nonConformities.filter(nc => nc.status === 'open');
    if (openNCs.length > 5) {
      recommendations.push('Address backlog of open non-conformities');
    }

    // Check training completion
    const requiredTraining = qms.training.length;
    const completedTraining = qms.training.filter(t => t.completionDate >= period.start).length;
    const completionRate = requiredTraining > 0 ? (completedTraining / requiredTraining) * 100 : 100;

    if (completionRate < 90) {
      recommendations.push('Increase training completion rates');
    }

    // Check process metrics
    qms.processes.forEach(process => {
      process.metrics.forEach(metric => {
        if (metric.trend === 'declining') {
          recommendations.push(`Address declining trend in ${process.name} - ${metric.name}`);
        }
      });
    });

    return recommendations;
  }

  getCertificationWorkflow(id: string): CertificationWorkflow | undefined {
    return this.workflows.get(id);
  }

  getCertificationApplication(id: string): CertificationApplication | undefined {
    return this.applications.get(id);
  }

  getQualityManagementSystem(id: string): QualityManagement | undefined {
    return this.qualitySystems.get(id);
  }

  getWorkflowsByCategory(category: CertificationWorkflow['category']): CertificationWorkflow[] {
    return Array.from(this.workflows.values()).filter(w => w.category === category);
  }

  getApplicationsByStatus(status: CertificationApplication['status']): CertificationApplication[] {
    return Array.from(this.applications.values()).filter(a => a.status === status);
  }

  getApplicationsByProduct(productId: string): CertificationApplication[] {
    return Array.from(this.applications.values()).filter(a => a.productId === productId);
  }

  getQualitySystemsByOrganization(orgId: string): QualityManagement[] {
    return Array.from(this.qualitySystems.values()).filter(q => q.organizationId === orgId);
  }

  updateCertificationWorkflow(id: string, updates: Partial<CertificationWorkflow>): boolean {
    const workflow = this.workflows.get(id);
    if (!workflow) return false;

    Object.assign(workflow, updates);
    workflow.modified = new Date();
    return true;
  }

  updateCertificationApplication(id: string, updates: Partial<CertificationApplication>): boolean {
    const application = this.applications.get(id);
    if (!application) return false;

    Object.assign(application, updates);
    application.modified = new Date();
    return true;
  }

  updateQualityManagementSystem(id: string, updates: Partial<QualityManagement>): boolean {
    const qms = this.qualitySystems.get(id);
    if (!qms) return false;

    Object.assign(qms, updates);
    qms.modified = new Date();
    return true;
  }
}

export const certificationWorkflowManager = new CertificationWorkflowManager();