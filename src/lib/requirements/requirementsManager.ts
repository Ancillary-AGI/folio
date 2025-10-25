import { Component } from '../../types';

export interface Requirement {
  id: string;
  title: string;
  description: string;
  type: 'functional' | 'performance' | 'interface' | 'constraint' | 'safety' | 'security' | 'regulatory';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'draft' | 'approved' | 'implemented' | 'verified' | 'rejected';
  category: string;
  tags: string[];
  acceptanceCriteria: string[];
  dependencies: string[]; // Requirement IDs
  parent?: string; // Parent requirement ID
  children: string[]; // Child requirement IDs
  verificationMethod: 'test' | 'analysis' | 'inspection' | 'demonstration';
  verificationStatus: 'not_started' | 'in_progress' | 'passed' | 'failed';
  created: Date;
  modified: Date;
  author: string;
  assignedTo?: string;
  estimatedEffort: number; // hours
  actualEffort?: number; // hours
  riskLevel: 'low' | 'medium' | 'high';
  compliance: string[]; // Standards/regulations this requirement addresses
}

export interface RequirementsTraceability {
  requirementId: string;
  designElements: string[]; // Component/block IDs
  testCases: string[]; // Test case IDs
  verificationResults: Array<{
    method: string;
    status: 'passed' | 'failed' | 'not_tested';
    date: Date;
    evidence: string;
  }>;
}

export interface RequirementsBaseline {
  id: string;
  name: string;
  version: string;
  requirements: Requirement[];
  created: Date;
  approvedBy?: string;
  status: 'draft' | 'baseline' | 'superseded';
}

export class RequirementsManager {
  private requirements: Map<string, Requirement> = new Map();
  private baselines: Map<string, RequirementsBaseline> = new Map();
  private traceability: Map<string, RequirementsTraceability> = new Map();

  createRequirement(req: Omit<Requirement, 'id' | 'created' | 'modified' | 'children'>): Requirement {
    const requirement: Requirement = {
      ...req,
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      created: new Date(),
      modified: new Date(),
      children: []
    };

    this.requirements.set(requirement.id, requirement);

    // Update parent-child relationships
    if (req.parent) {
      const parent = this.requirements.get(req.parent);
      if (parent) {
        parent.children.push(requirement.id);
        parent.modified = new Date();
      }
    }

    // Initialize traceability
    this.traceability.set(requirement.id, {
      requirementId: requirement.id,
      designElements: [],
      testCases: [],
      verificationResults: []
    });

    return requirement;
  }

  updateRequirement(id: string, updates: Partial<Requirement>): Requirement | null {
    const requirement = this.requirements.get(id);
    if (!requirement) return null;

    Object.assign(requirement, updates, { modified: new Date() });
    return requirement;
  }

  deleteRequirement(id: string): boolean {
    const requirement = this.requirements.get(id);
    if (!requirement) return false;

    // Remove from parent
    if (requirement.parent) {
      const parent = this.requirements.get(requirement.parent);
      if (parent) {
        parent.children = parent.children.filter(childId => childId !== id);
        parent.modified = new Date();
      }
    }

    // Remove children
    requirement.children.forEach(childId => {
      this.deleteRequirement(childId);
    });

    // Remove traceability
    this.traceability.delete(id);

    return this.requirements.delete(id);
  }

  getRequirement(id: string): Requirement | undefined {
    return this.requirements.get(id);
  }

  getAllRequirements(): Requirement[] {
    return Array.from(this.requirements.values());
  }

  getRequirementsByType(type: Requirement['type']): Requirement[] {
    return this.getAllRequirements().filter(req => req.type === type);
  }

  getRequirementsByStatus(status: Requirement['status']): Requirement[] {
    return this.getAllRequirements().filter(req => req.status === status);
  }

  getRequirementsByPriority(priority: Requirement['priority']): Requirement[] {
    return this.getAllRequirements().filter(req => req.priority === priority);
  }

  getRequirementsHierarchy(): Requirement[] {
    // Return only root requirements (no parent)
    return this.getAllRequirements().filter(req => !req.parent);
  }

  createBaseline(name: string, requirements: Requirement[]): RequirementsBaseline {
    const baseline: RequirementsBaseline = {
      id: `baseline_${Date.now()}`,
      name,
      version: '1.0',
      requirements: [...requirements], // Deep copy
      created: new Date(),
      status: 'draft'
    };

    this.baselines.set(baseline.id, baseline);
    return baseline;
  }

  approveBaseline(baselineId: string, approvedBy: string): boolean {
    const baseline = this.baselines.get(baselineId);
    if (!baseline) return false;

    baseline.status = 'baseline';
    baseline.approvedBy = approvedBy;
    return true;
  }

  linkRequirementToDesign(requirementId: string, designElementId: string): boolean {
    const trace = this.traceability.get(requirementId);
    if (!trace) return false;

    if (!trace.designElements.includes(designElementId)) {
      trace.designElements.push(designElementId);
    }
    return true;
  }

  linkRequirementToTest(requirementId: string, testCaseId: string): boolean {
    const trace = this.traceability.get(requirementId);
    if (!trace) return false;

    if (!trace.testCases.includes(testCaseId)) {
      trace.testCases.push(testCaseId);
    }
    return true;
  }

  recordVerificationResult(requirementId: string, result: RequirementsTraceability['verificationResults'][0]): boolean {
    const trace = this.traceability.get(requirementId);
    if (!trace) return false;

    trace.verificationResults.push(result);

    // Update requirement status
    const requirement = this.requirements.get(requirementId);
    if (requirement) {
      if (result.status === 'passed') {
        requirement.verificationStatus = 'passed';
        if (requirement.status === 'implemented') {
          requirement.status = 'verified';
        }
      } else if (result.status === 'failed') {
        requirement.verificationStatus = 'failed';
      }
      requirement.modified = new Date();
    }

    return true;
  }

  getTraceabilityMatrix(): Array<{
    requirement: Requirement;
    designElements: string[];
    testCases: string[];
    verificationStatus: string;
  }> {
    return Array.from(this.traceability.entries()).map(([reqId, trace]) => {
      const requirement = this.requirements.get(reqId);
      return {
        requirement: requirement!,
        designElements: trace.designElements,
        testCases: trace.testCases,
        verificationStatus: requirement?.verificationStatus || 'not_started'
      };
    });
  }

  generateRequirementsReport(): {
    summary: {
      total: number;
      byType: Record<string, number>;
      byStatus: Record<string, number>;
      byPriority: Record<string, number>;
      verificationProgress: number;
    };
    issues: Array<{
      type: 'missing_traceability' | 'failed_verification' | 'overdue';
      requirement: Requirement;
      description: string;
    }>;
  } {
    const allReqs = this.getAllRequirements();

    const summary = {
      total: allReqs.length,
      byType: this.groupBy(allReqs, 'type'),
      byStatus: this.groupBy(allReqs, 'status'),
      byPriority: this.groupBy(allReqs, 'priority'),
      verificationProgress: this.calculateVerificationProgress(allReqs)
    };

    const issues = this.identifyIssues(allReqs);

    return { summary, issues };
  }

  private groupBy<T>(items: T[], key: keyof T): Record<string, number> {
    return items.reduce((acc, item) => {
      const value = String(item[key]);
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  private calculateVerificationProgress(requirements: Requirement[]): number {
    if (requirements.length === 0) return 0;

    const verified = requirements.filter(req =>
      req.verificationStatus === 'passed'
    ).length;

    return (verified / requirements.length) * 100;
  }

  private identifyIssues(requirements: Requirement[]): Array<{
    type: string;
    requirement: Requirement;
    description: string;
  }> {
    const issues = [];

    for (const req of requirements) {
      const trace = this.traceability.get(req.id);

      // Check for missing traceability
      if (!trace || (trace.designElements.length === 0 && trace.testCases.length === 0)) {
        issues.push({
          type: 'missing_traceability',
          requirement: req,
          description: 'Requirement has no design elements or test cases linked'
        });
      }

      // Check for failed verification
      if (req.verificationStatus === 'failed') {
        issues.push({
          type: 'failed_verification',
          requirement: req,
          description: 'Requirement verification has failed'
        });
      }

      // Check for overdue requirements (simplified - could be based on due dates)
      if (req.status === 'approved' && req.verificationStatus === 'not_started') {
        const daysSinceCreation = (Date.now() - req.created.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceCreation > 30) { // More than 30 days
          issues.push({
            type: 'overdue',
            requirement: req,
            description: `Requirement has been approved for ${Math.floor(daysSinceCreation)} days without verification`
          });
        }
      }
    }

    return issues;
  }

  importRequirements(requirements: Omit<Requirement, 'id' | 'created' | 'modified' | 'children'>[]): Requirement[] {
    return requirements.map(req => this.createRequirement(req));
  }

  exportRequirements(format: 'json' | 'csv' | 'xml' = 'json'): string {
    const requirements = this.getAllRequirements();

    switch (format) {
      case 'json':
        return JSON.stringify(requirements, null, 2);

      case 'csv':
        const headers = ['id', 'title', 'type', 'priority', 'status', 'author', 'created'];
        const rows = requirements.map(req => [
          req.id,
          req.title,
          req.type,
          req.priority,
          req.status,
          req.author,
          req.created.toISOString()
        ]);
        return [headers, ...rows].map(row => row.join(',')).join('\n');

      case 'xml':
        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<requirements>\n';
        requirements.forEach(req => {
          xml += `  <requirement id="${req.id}">\n`;
          xml += `    <title>${req.title}</title>\n`;
          xml += `    <type>${req.type}</type>\n`;
          xml += `    <status>${req.status}</status>\n`;
          xml += `  </requirement>\n`;
        });
        xml += '</requirements>\n';
        return xml;

      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  validateRequirements(): {
    valid: boolean;
    errors: Array<{
      requirement: Requirement;
      error: string;
    }>;
  } {
    const errors = [];
    const requirements = this.getAllRequirements();

    for (const req of requirements) {
      // Check required fields
      if (!req.title || req.title.trim() === '') {
        errors.push({
          requirement: req,
          error: 'Title is required'
        });
      }

      if (!req.description || req.description.trim() === '') {
        errors.push({
          requirement: req,
          error: 'Description is required'
        });
      }

      // Check acceptance criteria
      if (!req.acceptanceCriteria || req.acceptanceCriteria.length === 0) {
        errors.push({
          requirement: req,
          error: 'Acceptance criteria are required'
        });
      }

      // Check parent-child relationships
      if (req.parent && !this.requirements.has(req.parent)) {
        errors.push({
          requirement: req,
          error: `Parent requirement ${req.parent} does not exist`
        });
      }

      // Check dependencies
      for (const depId of req.dependencies) {
        if (!this.requirements.has(depId)) {
          errors.push({
            requirement: req,
            error: `Dependency ${depId} does not exist`
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export const requirementsManager = new RequirementsManager();