import { Component } from '../../types';

export interface ComplianceStandard {
  id: string;
  name: string;
  version: string;
  category: 'safety' | 'environmental' | 'quality' | 'regulatory' | 'industry';
  description: string;
  authority: string; // e.g., 'IEC', 'ISO', 'UL', 'FCC'
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    mandatory: boolean;
    category: string;
    checkFunction: (context: ComplianceCheckContext) => ComplianceCheckResult;
    remediation?: string;
    references?: string[];
  }>;
  effectiveDate: Date;
  reviewDate?: Date;
  status: 'active' | 'deprecated' | 'superseded';
  supersededBy?: string;
}

export interface ComplianceCheckContext {
  project: any;
  components: Component[];
  schematics: any[];
  simulations: any[];
  manufacturing?: any;
  environment: {
    temperature: number;
    humidity: number;
    altitude: number;
    vibration: number;
  };
  usage: {
    application: string;
    environment: 'indoor' | 'outdoor' | 'industrial' | 'automotive' | 'medical' | 'aerospace';
    safetyLevel: 'low' | 'medium' | 'high' | 'critical';
    expectedLifetime: number; // hours
  };
  regulatory: {
    regions: string[];
    certifications: string[];
    standards: string[];
  };
}

export interface ComplianceCheckResult {
  requirementId: string;
  status: 'pass' | 'fail' | 'not_applicable' | 'manual_review';
  score: number; // 0-100
  message: string;
  evidence: string[];
  violations: Array<{
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    location?: string;
    suggestion: string;
  }>;
  recommendations: string[];
  metadata: {
    checkedAt: Date;
    checkedBy: string;
    automated: boolean;
    confidence: number;
  };
}

export interface ComplianceAssessment {
  id: string;
  standardId: string;
  projectId: string;
  assessedAt: Date;
  assessedBy: string;
  context: ComplianceCheckContext;
  results: ComplianceCheckResult[];
  summary: {
    overallScore: number;
    passCount: number;
    failCount: number;
    manualReviewCount: number;
    notApplicableCount: number;
    criticalViolations: number;
    complianceLevel: 'non_compliant' | 'partial' | 'compliant' | 'exemplary';
  };
  report: {
    executiveSummary: string;
    detailedFindings: string;
    recommendations: string[];
    nextSteps: string[];
    attachments: Array<{
      name: string;
      type: string;
      url: string;
    }>;
  };
  status: 'draft' | 'review' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: Date;
  validUntil?: Date;
}

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  standardId: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  condition: {
    type: 'component' | 'circuit' | 'simulation' | 'manufacturing' | 'environmental';
    operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'regex' | 'custom';
    value: any;
    customFunction?: string;
  };
  action: {
    type: 'flag' | 'block' | 'warn' | 'auto_fix';
    message: string;
    suggestion?: string;
    autoFixFunction?: string;
  };
  enabled: boolean;
  created: Date;
  modified: Date;
}

export class ComplianceManager {
  private standards: Map<string, ComplianceStandard> = new Map();
  private assessments: Map<string, ComplianceAssessment> = new Map();
  private rules: Map<string, ComplianceRule> = new Map();

  createComplianceStandard(standard: Omit<ComplianceStandard, 'id'>): ComplianceStandard {
    const complianceStandard: ComplianceStandard = {
      ...standard,
      id: `standard_${Date.now()}`
    };

    this.standards.set(complianceStandard.id, complianceStandard);
    return complianceStandard;
  }

  createComplianceRule(rule: Omit<ComplianceRule, 'id' | 'created' | 'modified'>): ComplianceRule {
    const complianceRule: ComplianceRule = {
      ...rule,
      id: `rule_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.rules.set(complianceRule.id, complianceRule);
    return complianceRule;
  }

  async performComplianceCheck(standardId: string, context: ComplianceCheckContext): Promise<ComplianceCheckResult[]> {
    const standard = this.standards.get(standardId);
    if (!standard) {
      throw new Error('Compliance standard not found');
    }

    const results: ComplianceCheckResult[] = [];

    for (const requirement of standard.requirements) {
      try {
        const result = requirement.checkFunction(context);
        results.push({
          ...result,
          requirementId: requirement.id,
          metadata: {
            checkedAt: new Date(),
            checkedBy: 'system',
            automated: true,
            confidence: 0.95
          }
        });
      } catch (error) {
        // If automated check fails, mark for manual review
        results.push({
          requirementId: requirement.id,
          status: 'manual_review',
          score: 0,
          message: `Automated check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          evidence: [],
          violations: [],
          recommendations: ['Manual review required'],
          metadata: {
            checkedAt: new Date(),
            checkedBy: 'system',
            automated: false,
            confidence: 0
          }
        });
      }
    }

    return results;
  }

  async assessCompliance(standardId: string, projectId: string, context: ComplianceCheckContext, assessedBy: string): Promise<ComplianceAssessment> {
    const results = await this.performComplianceCheck(standardId, context);

    const passCount = results.filter(r => r.status === 'pass').length;
    const failCount = results.filter(r => r.status === 'fail').length;
    const manualReviewCount = results.filter(r => r.status === 'manual_review').length;
    const notApplicableCount = results.filter(r => r.status === 'not_applicable').length;
    const totalApplicable = results.length - notApplicableCount;

    const overallScore = totalApplicable > 0 ? (passCount / totalApplicable) * 100 : 0;
    const criticalViolations = results
      .filter(r => r.status === 'fail')
      .reduce((count, r) => count + r.violations.filter(v => v.severity === 'critical').length, 0);

    let complianceLevel: ComplianceAssessment['summary']['complianceLevel'];
    if (overallScore >= 95 && criticalViolations === 0) {
      complianceLevel = 'exemplary';
    } else if (overallScore >= 80) {
      complianceLevel = 'compliant';
    } else if (overallScore >= 60) {
      complianceLevel = 'partial';
    } else {
      complianceLevel = 'non_compliant';
    }

    const assessment: ComplianceAssessment = {
      id: `assessment_${Date.now()}`,
      standardId,
      projectId,
      assessedAt: new Date(),
      assessedBy,
      context,
      results,
      summary: {
        overallScore,
        passCount,
        failCount,
        manualReviewCount,
        notApplicableCount,
        criticalViolations,
        complianceLevel
      },
      report: {
        executiveSummary: this.generateExecutiveSummary(results, complianceLevel),
        detailedFindings: this.generateDetailedFindings(results),
        recommendations: this.generateRecommendations(results),
        nextSteps: this.generateNextSteps(results, complianceLevel),
        attachments: []
      },
      status: 'draft'
    };

    this.assessments.set(assessment.id, assessment);
    return assessment;
  }

  private generateExecutiveSummary(results: ComplianceCheckResult[], complianceLevel: string): string {
    const totalChecks = results.length;
    const passed = results.filter(r => r.status === 'pass').length;
    const failed = results.filter(r => r.status === 'fail').length;
    const criticalIssues = results
      .filter(r => r.status === 'fail')
      .reduce((count, r) => count + r.violations.filter(v => v.severity === 'critical').length, 0);

    return `Compliance assessment completed with ${passed}/${totalChecks} checks passing. ` +
           `Compliance level: ${complianceLevel}. ` +
           `${failed} checks failed with ${criticalIssues} critical violations. ` +
           `Overall compliance score: ${Math.round((passed / totalChecks) * 100)}%.`;
  }

  private generateDetailedFindings(results: ComplianceCheckResult[]): string {
    let findings = '# Detailed Findings\n\n';

    const failedResults = results.filter(r => r.status === 'fail');
    if (failedResults.length > 0) {
      findings += '## Failed Checks\n\n';
      failedResults.forEach(result => {
        findings += `### ${result.requirementId}\n`;
        findings += `${result.message}\n\n`;
        if (result.violations.length > 0) {
          findings += '**Violations:**\n';
          result.violations.forEach(violation => {
            findings += `- ${violation.severity.toUpperCase()}: ${violation.description}\n`;
          });
          findings += '\n';
        }
      });
    }

    const manualResults = results.filter(r => r.status === 'manual_review');
    if (manualResults.length > 0) {
      findings += '## Manual Review Required\n\n';
      manualResults.forEach(result => {
        findings += `- ${result.requirementId}: ${result.message}\n`;
      });
      findings += '\n';
    }

    return findings;
  }

  private generateRecommendations(results: ComplianceCheckResult[]): string[] {
    const recommendations: string[] = [];

    results.forEach(result => {
      recommendations.push(...result.recommendations);
      result.violations.forEach(violation => {
        if (violation.suggestion) {
          recommendations.push(violation.suggestion);
        }
      });
    });

    // Remove duplicates and sort by priority
    return [...new Set(recommendations)].sort();
  }

  private generateNextSteps(results: ComplianceCheckResult[], complianceLevel: string): string[] {
    const nextSteps: string[] = [];

    if (complianceLevel === 'non_compliant') {
      nextSteps.push('Address all critical violations immediately');
      nextSteps.push('Schedule follow-up assessment after remediation');
      nextSteps.push('Consider engaging compliance experts');
    } else if (complianceLevel === 'partial') {
      nextSteps.push('Address remaining compliance gaps');
      nextSteps.push('Implement recommended improvements');
      nextSteps.push('Schedule regular compliance reviews');
    } else {
      nextSteps.push('Maintain current compliance practices');
      nextSteps.push('Schedule annual compliance assessment');
      nextSteps.push('Monitor for changes in regulatory requirements');
    }

    const manualReviews = results.filter(r => r.status === 'manual_review').length;
    if (manualReviews > 0) {
      nextSteps.push(`Complete manual review of ${manualReviews} items`);
    }

    return nextSteps;
  }

  createDefaultStandards(): void {
    // IEC 61010-1 Safety Standard
    this.createComplianceStandard({
      name: 'IEC 61010-1 Safety Requirements',
      version: '3.0',
      category: 'safety',
      description: 'Safety requirements for electrical equipment for measurement, control and laboratory use',
      authority: 'IEC',
      requirements: [
        {
          id: 'iec_61010_1_1',
          title: 'Protection Against Electric Shock',
          description: 'Equipment shall provide protection against electric shock',
          mandatory: true,
          category: 'electrical_safety',
          checkFunction: (context) => this.checkElectricShockProtection(context),
          remediation: 'Implement proper insulation and grounding'
        },
        {
          id: 'iec_61010_1_2',
          title: 'Protection Against Mechanical Hazards',
          description: 'Equipment shall provide protection against mechanical hazards',
          mandatory: true,
          category: 'mechanical_safety',
          checkFunction: (context) => this.checkMechanicalProtection(context),
          remediation: 'Add mechanical guards and enclosures'
        },
        {
          id: 'iec_61010_1_3',
          title: 'Protection Against Thermal Hazards',
          description: 'Equipment shall provide protection against thermal hazards',
          mandatory: true,
          category: 'thermal_safety',
          checkFunction: (context) => this.checkThermalProtection(context),
          remediation: 'Implement thermal management and protection'
        }
      ],
      effectiveDate: new Date('2010-01-01'),
      status: 'active'
    });

    // ISO 9001 Quality Management
    this.createComplianceStandard({
      name: 'ISO 9001 Quality Management Systems',
      version: '2015',
      category: 'quality',
      description: 'Quality management systems - Requirements',
      authority: 'ISO',
      requirements: [
        {
          id: 'iso_9001_1',
          title: 'Context of the Organization',
          description: 'Understanding the organization and its context',
          mandatory: true,
          category: 'management',
          checkFunction: (context) => this.checkOrganizationalContext(context),
          remediation: 'Document organizational context and interested parties'
        },
        {
          id: 'iso_9001_2',
          title: 'Leadership and Commitment',
          description: 'Leadership and commitment to quality management',
          mandatory: true,
          category: 'leadership',
          checkFunction: (context) => this.checkLeadershipCommitment(context),
          remediation: 'Demonstrate leadership commitment to quality'
        }
      ],
      effectiveDate: new Date('2015-09-15'),
      status: 'active'
    });

    // FCC Part 15 EMC Requirements
    this.createComplianceStandard({
      name: 'FCC Part 15 Electromagnetic Compatibility',
      version: '2020',
      category: 'regulatory',
      description: 'Federal Communications Commission EMC requirements',
      authority: 'FCC',
      requirements: [
        {
          id: 'fcc_15_1',
          title: 'Conducted Emissions',
          description: 'Equipment shall not cause harmful conducted emissions',
          mandatory: true,
          category: 'emc',
          checkFunction: (context) => this.checkConductedEmissions(context),
          remediation: 'Implement EMI filters and shielding'
        },
        {
          id: 'fcc_15_2',
          title: 'Radiated Emissions',
          description: 'Equipment shall not cause harmful radiated emissions',
          mandatory: true,
          category: 'emc',
          checkFunction: (context) => this.checkRadiatedEmissions(context),
          remediation: 'Add shielding and improve grounding'
        }
      ],
      effectiveDate: new Date('2020-01-01'),
      status: 'active'
    });

    // RoHS Environmental Compliance
    this.createComplianceStandard({
      name: 'RoHS Directive 2011/65/EU',
      version: '2015',
      category: 'environmental',
      description: 'Restriction of Hazardous Substances in electrical equipment',
      authority: 'EU',
      requirements: [
        {
          id: 'rohs_1',
          title: 'Lead Content',
          description: 'Restriction of lead and lead compounds',
          mandatory: true,
          category: 'materials',
          checkFunction: (context) => this.checkLeadContent(context),
          remediation: 'Use lead-free components and solder'
        },
        {
          id: 'rohs_2',
          title: 'Mercury Content',
          description: 'Restriction of mercury and mercury compounds',
          mandatory: true,
          category: 'materials',
          checkFunction: (context) => this.checkMercuryContent(context),
          remediation: 'Use mercury-free components'
        }
      ],
      effectiveDate: new Date('2015-06-01'),
      status: 'active'
    });
  }

  private checkElectricShockProtection(context: ComplianceCheckContext): ComplianceCheckResult {
    // Check for proper insulation, grounding, and protection
    const violations: ComplianceCheckResult['violations'] = [];
    let score = 100;

    // Check components for proper voltage ratings
    context.components.forEach(component => {
      if (component.properties.voltage_rating < context.usage.safetyLevel === 'high' ? 1000 : 500) {
        violations.push({
          severity: 'high',
          description: `Component ${component.name} voltage rating too low`,
          suggestion: 'Use components with higher voltage ratings'
        });
        score -= 20;
      }
    });

    return {
      requirementId: 'iec_61010_1_1',
      status: violations.length === 0 ? 'pass' : 'fail',
      score,
      message: violations.length === 0 ? 'Electric shock protection requirements met' : `${violations.length} violations found`,
      evidence: ['Component voltage ratings checked'],
      violations,
      recommendations: violations.map(v => v.suggestion)
    };
  }

  private checkMechanicalProtection(context: ComplianceCheckContext): ComplianceCheckResult {
    // Check for mechanical hazards and protection
    const violations: ComplianceCheckResult['violations'] = [];
    let score = 100;

    // Check for sharp edges, moving parts, etc.
    if (context.usage.environment === 'industrial') {
      violations.push({
        severity: 'medium',
        description: 'Industrial environment requires additional mechanical protection',
        suggestion: 'Add protective enclosures and guards'
      });
      score -= 15;
    }

    return {
      requirementId: 'iec_61010_1_2',
      status: violations.length === 0 ? 'pass' : 'fail',
      score,
      message: violations.length === 0 ? 'Mechanical protection requirements met' : `${violations.length} violations found`,
      evidence: ['Mechanical hazard assessment completed'],
      violations,
      recommendations: violations.map(v => v.suggestion)
    };
  }

  private checkThermalProtection(context: ComplianceCheckContext): ComplianceCheckResult {
    // Check for thermal hazards and protection
    const violations: ComplianceCheckResult['violations'] = [];
    let score = 100;

    // Check operating temperature ranges
    if (context.environment.temperature > 60) {
      violations.push({
        severity: 'high',
        description: 'Operating temperature exceeds safe limits',
        suggestion: 'Implement active cooling or reduce operating temperature'
      });
      score -= 25;
    }

    return {
      requirementId: 'iec_61010_1_3',
      status: violations.length === 0 ? 'pass' : 'fail',
      score,
      message: violations.length === 0 ? 'Thermal protection requirements met' : `${violations.length} violations found`,
      evidence: ['Thermal analysis completed'],
      violations,
      recommendations: violations.map(v => v.suggestion)
    };
  }

  private checkOrganizationalContext(context: ComplianceCheckContext): ComplianceCheckResult {
    // Check if organizational context is documented
    return {
      requirementId: 'iso_9001_1',
      status: 'manual_review',
      score: 50,
      message: 'Manual review required for organizational context documentation',
      evidence: [],
      violations: [],
      recommendations: ['Document organizational context and interested parties']
    };
  }

  private checkLeadershipCommitment(context: ComplianceCheckContext): ComplianceCheckResult {
    // Check for leadership commitment evidence
    return {
      requirementId: 'iso_9001_2',
      status: 'manual_review',
      score: 50,
      message: 'Manual review required for leadership commitment',
      evidence: [],
      violations: [],
      recommendations: ['Demonstrate leadership commitment to quality management']
    };
  }

  private checkConductedEmissions(context: ComplianceCheckContext): ComplianceCheckResult {
    // Check for conducted emissions compliance
    const violations: ComplianceCheckResult['violations'] = [];
    let score = 100;

    // Check for EMI filters
    const hasFilters = context.components.some(c => c.category === 'filter');
    if (!hasFilters) {
      violations.push({
        severity: 'medium',
        description: 'No EMI filters detected in design',
        suggestion: 'Add EMI filters to power inputs'
      });
      score -= 20;
    }

    return {
      requirementId: 'fcc_15_1',
      status: violations.length === 0 ? 'pass' : 'fail',
      score,
      message: violations.length === 0 ? 'Conducted emissions requirements met' : `${violations.length} violations found`,
      evidence: ['EMI filter analysis completed'],
      violations,
      recommendations: violations.map(v => v.suggestion)
    };
  }

  private checkRadiatedEmissions(context: ComplianceCheckContext): ComplianceCheckResult {
    // Check for radiated emissions compliance
    const violations: ComplianceCheckResult['violations'] = [];
    let score = 100;

    // Check for shielding
    if (!context.schematics.some(s => s.metadata?.shielding)) {
      violations.push({
        severity: 'medium',
        description: 'No shielding detected in design',
        suggestion: 'Add electromagnetic shielding to enclosure'
      });
      score -= 20;
    }

    return {
      requirementId: 'fcc_15_2',
      status: violations.length === 0 ? 'pass' : 'fail',
      score,
      message: violations.length === 0 ? 'Radiated emissions requirements met' : `${violations.length} violations found`,
      evidence: ['Shielding analysis completed'],
      violations,
      recommendations: violations.map(v => v.suggestion)
    };
  }

  private checkLeadContent(context: ComplianceCheckContext): ComplianceCheckResult {
    // Check for lead content in components
    const violations: ComplianceCheckResult['violations'] = [];
    let score = 100;

    // Check components for lead content
    context.components.forEach(component => {
      if (component.properties.contains_lead) {
        violations.push({
          severity: 'high',
          description: `Component ${component.name} contains lead`,
          suggestion: 'Replace with lead-free alternative'
        });
        score -= 30;
      }
    });

    return {
      requirementId: 'rohs_1',
      status: violations.length === 0 ? 'pass' : 'fail',
      score,
      message: violations.length === 0 ? 'Lead content requirements met' : `${violations.length} violations found`,
      evidence: ['Component materials analysis completed'],
      violations,
      recommendations: violations.map(v => v.suggestion)
    };
  }

  private checkMercuryContent(context: ComplianceCheckContext): ComplianceCheckResult {
    // Check for mercury content in components
    const violations: ComplianceCheckResult['violations'] = [];
    let score = 100;

    // Check components for mercury content
    context.components.forEach(component => {
      if (component.properties.contains_mercury) {
        violations.push({
          severity: 'high',
          description: `Component ${component.name} contains mercury`,
          suggestion: 'Replace with mercury-free alternative'
        });
        score -= 30;
      }
    });

    return {
      requirementId: 'rohs_2',
      status: violations.length === 0 ? 'pass' : 'fail',
      score,
      message: violations.length === 0 ? 'Mercury content requirements met' : `${violations.length} violations found`,
      evidence: ['Component materials analysis completed'],
      violations,
      recommendations: violations.map(v => v.suggestion)
    };
  }

  getComplianceStandard(id: string): ComplianceStandard | undefined {
    return this.standards.get(id);
  }

  getComplianceAssessment(id: string): ComplianceAssessment | undefined {
    return this.assessments.get(id);
  }

  getComplianceRule(id: string): ComplianceRule | undefined {
    return this.rules.get(id);
  }

  getAllComplianceStandards(): ComplianceStandard[] {
    return Array.from(this.standards.values());
  }

  getAllComplianceAssessments(): ComplianceAssessment[] {
    return Array.from(this.assessments.values());
  }

  getAllComplianceRules(): ComplianceRule[] {
    return Array.from(this.rules.values());
  }

  getStandardsByCategory(category: ComplianceStandard['category']): ComplianceStandard[] {
    return this.getAllComplianceStandards().filter(s => s.category === category);
  }

  getAssessmentsByProject(projectId: string): ComplianceAssessment[] {
    return this.getAllComplianceAssessments().filter(a => a.projectId === projectId);
  }

  getRulesByStandard(standardId: string): ComplianceRule[] {
    return this.getAllComplianceRules().filter(r => r.standardId === standardId);
  }

  updateComplianceAssessmentStatus(id: string, status: ComplianceAssessment['status'], approvedBy?: string): boolean {
    const assessment = this.assessments.get(id);
    if (!assessment) return false;

    assessment.status = status;
    if (status === 'approved' && approvedBy) {
      assessment.approvedBy = approvedBy;
      assessment.approvedAt = new Date();
    }

    return true;
  }

  exportComplianceReport(assessmentId: string, format: 'pdf' | 'html' | 'json' = 'pdf'): Promise<string> {
    const assessment = this.assessments.get(assessmentId);
    if (!assessment) {
      throw new Error('Compliance assessment not found');
    }

    // Generate report content
    const reportContent = {
      assessment,
      generatedAt: new Date(),
      format
    };

    // In practice, this would generate the actual file
    return Promise.resolve(JSON.stringify(reportContent));
  }
}

export const complianceManager = new ComplianceManager();