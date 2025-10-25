import { Component } from '../../types';

export interface ChangeRequest {
  id: string;
  title: string;
  description: string;
  type: 'enhancement' | 'bug_fix' | 'documentation' | 'process' | 'emergency';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'implemented' | 'closed';
  requester: string;
  assignee?: string;
  reviewers: string[];
  affectedItems: Array<{
    type: 'component' | 'schematic' | 'pcb' | 'documentation' | 'test';
    id: string;
    name: string;
    impact: 'low' | 'medium' | 'high';
  }>;
  proposedChanges: Array<{
    description: string;
    rationale: string;
    risk: 'low' | 'medium' | 'high';
    effort: number; // hours
  }>;
  impact: {
    cost: number;
    schedule: number; // days
    performance: 'none' | 'minor' | 'moderate' | 'major';
    risk: 'low' | 'medium' | 'high';
  };
  attachments: string[];
  comments: Array<{
    author: string;
    content: string;
    timestamp: Date;
    type: 'comment' | 'approval' | 'rejection';
  }>;
  created: Date;
  modified: Date;
  dueDate?: Date;
  implementedDate?: Date;
}

export interface ChangeOrder {
  id: string;
  changeRequestId: string;
  title: string;
  description: string;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  implementationPlan: Array<{
    step: number;
    description: string;
    assignee: string;
    estimatedHours: number;
    dependencies: string[]; // step IDs
    startDate?: Date;
    endDate?: Date;
  }>;
  validationPlan: Array<{
    test: string;
    criteria: string;
    responsible: string;
  }>;
  rollbackPlan?: {
    steps: string[];
    estimatedTime: number;
  };
  created: Date;
  modified: Date;
  completedDate?: Date;
}

export interface ChangeImpactAnalysis {
  id: string;
  changeRequestId: string;
  affectedSystems: Array<{
    system: string;
    impact: 'low' | 'medium' | 'high';
    description: string;
  }>;
  riskAssessment: {
    technicalRisk: number; // 1-10
    scheduleRisk: number; // 1-10
    costRisk: number; // 1-10
    overallRisk: number; // 1-10
  };
  mitigationStrategies: Array<{
    risk: string;
    strategy: string;
    effectiveness: 'low' | 'medium' | 'high';
  }>;
  alternatives: Array<{
    description: string;
    pros: string[];
    cons: string[];
    cost: number;
    schedule: number;
  }>;
  recommendations: string[];
}

export class ChangeManager {
  private changeRequests: Map<string, ChangeRequest> = new Map();
  private changeOrders: Map<string, ChangeOrder> = new Map();
  private impactAnalyses: Map<string, ChangeImpactAnalysis> = new Map();

  createChangeRequest(request: Omit<ChangeRequest, 'id' | 'created' | 'modified' | 'comments'>): ChangeRequest {
    const changeRequest: ChangeRequest = {
      ...request,
      id: `cr_${Date.now()}`,
      created: new Date(),
      modified: new Date(),
      comments: []
    };

    this.changeRequests.set(changeRequest.id, changeRequest);
    return changeRequest;
  }

  updateChangeRequest(id: string, updates: Partial<ChangeRequest>): ChangeRequest | null {
    const request = this.changeRequests.get(id);
    if (!request) return null;

    Object.assign(request, updates, { modified: new Date() });
    return request;
  }

  addComment(changeRequestId: string, comment: Omit<ChangeRequest['comments'][0], 'timestamp'>): boolean {
    const request = this.changeRequests.get(changeRequestId);
    if (!request) return false;

    request.comments.push({
      ...comment,
      timestamp: new Date()
    });

    request.modified = new Date();
    return true;
  }

  approveChangeRequest(id: string, approver: string, comments?: string): boolean {
    const request = this.changeRequests.get(id);
    if (!request) return false;

    request.status = 'approved';
    request.modified = new Date();

    this.addComment(id, {
      author: approver,
      content: comments || 'Change request approved',
      type: 'approval'
    });

    return true;
  }

  rejectChangeRequest(id: string, rejector: string, reason: string): boolean {
    const request = this.changeRequests.get(id);
    if (!request) return false;

    request.status = 'rejected';
    request.modified = new Date();

    this.addComment(id, {
      author: rejector,
      content: `Change request rejected: ${reason}`,
      type: 'rejection'
    });

    return true;
  }

  createChangeOrder(changeRequestId: string, implementationPlan: ChangeOrder['implementationPlan']): ChangeOrder {
    const request = this.changeRequests.get(changeRequestId);
    if (!request) {
      throw new Error('Change request not found');
    }

    const changeOrder: ChangeOrder = {
      id: `co_${Date.now()}`,
      changeRequestId,
      title: `Implementation of ${request.title}`,
      description: request.description,
      status: 'planned',
      implementationPlan,
      validationPlan: this.generateValidationPlan(request),
      created: new Date(),
      modified: new Date()
    };

    this.changeOrders.set(changeOrder.id, changeOrder);
    return changeOrder;
  }

  private generateValidationPlan(request: ChangeRequest): ChangeOrder['validationPlan'] {
    const validationPlan = [];

    request.affectedItems.forEach(item => {
      validationPlan.push({
        test: `Verify ${item.name} functionality`,
        criteria: `No regression in ${item.type} ${item.name}`,
        responsible: request.assignee || 'TBD'
      });
    });

    // Add general validation tests
    validationPlan.push({
      test: 'System integration test',
      criteria: 'All affected systems work together correctly',
      responsible: request.assignee || 'TBD'
    });

    validationPlan.push({
      test: 'Performance validation',
      criteria: 'Performance meets requirements',
      responsible: request.assignee || 'TBD'
    });

    return validationPlan;
  }

  performImpactAnalysis(changeRequestId: string): ChangeImpactAnalysis {
    const request = this.changeRequests.get(changeRequestId);
    if (!request) {
      throw new Error('Change request not found');
    }

    const affectedSystems = this.identifyAffectedSystems(request);
    const riskAssessment = this.assessChangeRisk(request);
    const mitigationStrategies = this.generateMitigationStrategies(riskAssessment);
    const alternatives = this.generateAlternatives(request);
    const recommendations = this.generateRecommendations(request, riskAssessment);

    const analysis: ChangeImpactAnalysis = {
      id: `ia_${Date.now()}`,
      changeRequestId,
      affectedSystems,
      riskAssessment,
      mitigationStrategies,
      alternatives,
      recommendations
    };

    this.impactAnalyses.set(analysis.id, analysis);
    return analysis;
  }

  private identifyAffectedSystems(request: ChangeRequest): ChangeImpactAnalysis['affectedSystems'] {
    const affectedSystems = [];

    // Identify systems based on affected items
    const systemMap = new Map<string, string[]>();

    request.affectedItems.forEach(item => {
      const system = this.mapItemToSystem(item);
      if (!systemMap.has(system)) {
        systemMap.set(system, []);
      }
      systemMap.get(system)!.push(item.name);
    });

    systemMap.forEach((items, system) => {
      const impact = this.determineSystemImpact(system, items.length);
      affectedSystems.push({
        system,
        impact,
        description: `Affects ${items.length} items: ${items.join(', ')}`
      });
    });

    return affectedSystems;
  }

  private mapItemToSystem(item: ChangeRequest['affectedItems'][0]): string {
    switch (item.type) {
      case 'component':
        return 'Hardware Design';
      case 'schematic':
        return 'Schematic Design';
      case 'pcb':
        return 'PCB Design';
      case 'documentation':
        return 'Documentation';
      case 'test':
        return 'Testing';
      default:
        return 'Unknown System';
    }
  }

  private determineSystemImpact(system: string, itemCount: number): 'low' | 'medium' | 'high' {
    if (itemCount > 10) return 'high';
    if (itemCount > 5) return 'medium';
    return 'low';
  }

  private assessChangeRisk(request: ChangeRequest): ChangeImpactAnalysis['riskAssessment'] {
    let technicalRisk = 1;
    let scheduleRisk = 1;
    let costRisk = 1;

    // Assess based on change type
    switch (request.type) {
      case 'emergency':
        technicalRisk += 3;
        scheduleRisk += 3;
        break;
      case 'enhancement':
        technicalRisk += 2;
        costRisk += 2;
        break;
      case 'bug_fix':
        technicalRisk += 1;
        scheduleRisk += 1;
        break;
    }

    // Assess based on priority
    switch (request.priority) {
      case 'critical':
        technicalRisk += 2;
        scheduleRisk += 2;
        costRisk += 2;
        break;
      case 'high':
        technicalRisk += 1;
        scheduleRisk += 1;
        costRisk += 1;
        break;
    }

    // Assess based on impact
    if (request.impact.performance === 'major') {
      technicalRisk += 2;
    }

    // Assess based on affected items
    const highImpactItems = request.affectedItems.filter(item => item.impact === 'high').length;
    technicalRisk += highImpactItems;
    scheduleRisk += Math.floor(highImpactItems / 2);

    // Cap risks at 10
    technicalRisk = Math.min(technicalRisk, 10);
    scheduleRisk = Math.min(scheduleRisk, 10);
    costRisk = Math.min(costRisk, 10);

    const overallRisk = Math.round((technicalRisk + scheduleRisk + costRisk) / 3);

    return {
      technicalRisk,
      scheduleRisk,
      costRisk,
      overallRisk
    };
  }

  private generateMitigationStrategies(riskAssessment: ChangeImpactAnalysis['riskAssessment']): ChangeImpactAnalysis['mitigationStrategies'] {
    const strategies = [];

    if (riskAssessment.technicalRisk > 7) {
      strategies.push({
        risk: 'High technical risk',
        strategy: 'Conduct thorough design review and additional testing',
        effectiveness: 'high'
      });
    }

    if (riskAssessment.scheduleRisk > 7) {
      strategies.push({
        risk: 'High schedule risk',
        strategy: 'Allocate additional resources and consider parallel development',
        effectiveness: 'medium'
      });
    }

    if (riskAssessment.costRisk > 7) {
      strategies.push({
        risk: 'High cost risk',
        strategy: 'Evaluate cost-benefit ratio and consider phased implementation',
        effectiveness: 'medium'
      });
    }

    strategies.push({
      risk: 'General implementation risk',
      strategy: 'Develop comprehensive test plan and rollback procedures',
      effectiveness: 'high'
    });

    return strategies;
  }

  private generateAlternatives(request: ChangeRequest): ChangeImpactAnalysis['alternatives'] {
    const alternatives = [];

    // Generate alternative approaches
    alternatives.push({
      description: 'Full implementation as proposed',
      pros: ['Complete solution', 'Addresses all requirements'],
      cons: ['Higher risk', 'Longer timeline'],
      cost: request.impact.cost,
      schedule: request.impact.schedule
    });

    alternatives.push({
      description: 'Phased implementation',
      pros: ['Reduced risk', 'Earlier benefits'],
      cons: ['Partial solution initially', 'Additional coordination'],
      cost: Math.round(request.impact.cost * 0.9),
      schedule: Math.round(request.impact.schedule * 1.2)
    });

    alternatives.push({
      description: 'Alternative technical approach',
      pros: ['May reduce complexity', 'Different risk profile'],
      cons: ['Requires additional analysis', 'May not fully meet requirements'],
      cost: Math.round(request.impact.cost * 0.8),
      schedule: Math.round(request.impact.schedule * 0.9)
    });

    return alternatives;
  }

  private generateRecommendations(request: ChangeRequest, riskAssessment: ChangeImpactAnalysis['riskAssessment']): string[] {
    const recommendations = [];

    if (riskAssessment.overallRisk > 8) {
      recommendations.push('High-risk change - consider breaking into smaller changes');
    }

    if (request.affectedItems.length > 10) {
      recommendations.push('Large scope change - ensure adequate testing resources');
    }

    if (request.type === 'emergency') {
      recommendations.push('Emergency change - prioritize over other activities');
    }

    recommendations.push('Conduct peer review before implementation');
    recommendations.push('Document all changes and update relevant documentation');

    return recommendations;
  }

  implementChangeOrder(orderId: string): boolean {
    const order = this.changeOrders.get(orderId);
    if (!order) return false;

    order.status = 'in_progress';
    order.modified = new Date();

    // Mark associated change request as implemented
    const request = this.changeRequests.get(order.changeRequestId);
    if (request) {
      request.status = 'implemented';
      request.implementedDate = new Date();
      request.modified = new Date();
    }

    return true;
  }

  completeChangeOrder(orderId: string): boolean {
    const order = this.changeOrders.get(orderId);
    if (!order) return false;

    order.status = 'completed';
    order.completedDate = new Date();
    order.modified = new Date();

    // Mark associated change request as closed
    const request = this.changeRequests.get(order.changeRequestId);
    if (request) {
      request.status = 'closed';
      request.modified = new Date();
    }

    return true;
  }

  generateChangeReport(changeRequestId: string): any {
    const request = this.changeRequests.get(changeRequestId);
    const order = Array.from(this.changeOrders.values()).find(o => o.changeRequestId === changeRequestId);
    const analysis = Array.from(this.impactAnalyses.values()).find(a => a.changeRequestId === changeRequestId);

    if (!request) {
      throw new Error('Change request not found');
    }

    return {
      changeRequest: request,
      changeOrder: order,
      impactAnalysis: analysis,
      summary: {
        status: request.status,
        totalEffort: request.proposedChanges.reduce((sum, change) => sum + change.effort, 0),
        riskLevel: analysis?.riskAssessment.overallRisk || 'unknown',
        implementationTime: order?.completedDate ?
          (order.completedDate.getTime() - order.created.getTime()) / (1000 * 60 * 60 * 24) : null
      }
    };
  }

  getChangeRequest(id: string): ChangeRequest | undefined {
    return this.changeRequests.get(id);
  }

  getChangeOrder(id: string): ChangeOrder | undefined {
    return this.changeOrders.get(id);
  }

  getImpactAnalysis(id: string): ChangeImpactAnalysis | undefined {
    return this.impactAnalyses.get(id);
  }

  getAllChangeRequests(): ChangeRequest[] {
    return Array.from(this.changeRequests.values());
  }

  getAllChangeOrders(): ChangeOrder[] {
    return Array.from(this.changeOrders.values());
  }

  getAllImpactAnalyses(): ChangeImpactAnalysis[] {
    return Array.from(this.impactAnalyses.values());
  }

  getChangeRequestsByStatus(status: ChangeRequest['status']): ChangeRequest[] {
    return this.getAllChangeRequests().filter(request => request.status === status);
  }

  getChangeRequestsByPriority(priority: ChangeRequest['priority']): ChangeRequest[] {
    return this.getAllChangeRequests().filter(request => request.priority === priority);
  }

  getOverdueChangeRequests(): ChangeRequest[] {
    const now = new Date();
    return this.getAllChangeRequests().filter(request =>
      request.dueDate && request.dueDate < now && request.status !== 'closed'
    );
  }
}

export const changeManager = new ChangeManager();