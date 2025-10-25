import { Component } from '../../types';

export interface ApprovalWorkflow {
  id: string;
  name: string;
  description: string;
  type: 'design' | 'change' | 'release' | 'procurement' | 'quality';
  trigger: {
    event: string;
    conditions: Record<string, any>;
  };
  stages: Array<{
    id: string;
    name: string;
    order: number;
    approvers: Array<{
      userId: string;
      name: string;
      role: string;
      required: boolean;
      alternateApprovers?: string[];
    }>;
    criteria: Array<{
      type: 'document' | 'test' | 'review' | 'signoff';
      name: string;
      required: boolean;
      completed: boolean;
    }>;
    timeout: number; // hours
    escalation: {
      enabled: boolean;
      afterHours: number;
      escalateTo: string[];
    };
  }>;
  notifications: {
    onStart: boolean;
    onStageComplete: boolean;
    onApproval: boolean;
    onRejection: boolean;
    onTimeout: boolean;
    reminderInterval: number; // hours
  };
  created: Date;
  modified: Date;
}

export interface ApprovalRequest {
  id: string;
  workflowId: string;
  title: string;
  description: string;
  requester: {
    userId: string;
    name: string;
    department: string;
  };
  item: {
    type: string;
    id: string;
    name: string;
    version?: string;
  };
  attachments: Array<{
    name: string;
    type: string;
    url: string;
  }>;
  currentStage: number;
  status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'cancelled' | 'timed_out';
  stageApprovals: Array<{
    stageId: string;
    stageName: string;
    requiredApprovers: number;
    currentApprovals: number;
    approvals: Array<{
      userId: string;
      name: string;
      decision: 'approved' | 'rejected' | 'pending';
      comments?: string;
      timestamp: Date;
    }>;
    status: 'pending' | 'approved' | 'rejected' | 'timed_out';
    started: Date;
    completed?: Date;
  }>;
  overallResult?: {
    decision: 'approved' | 'approved_with_conditions' | 'rejected';
    summary: string;
    conditions?: string[];
    approvedBy: string[];
    rejectedBy: string[];
  };
  created: Date;
  modified: Date;
  dueDate?: Date;
}

export interface ApprovalMetrics {
  id: string;
  workflowId: string;
  period: {
    start: Date;
    end: Date;
  };
  metrics: {
    totalRequests: number;
    approvedRequests: number;
    rejectedRequests: number;
    averageApprovalTime: number; // hours
    averageStageTime: number; // hours
    bottleneckStages: Array<{
      stageId: string;
      stageName: string;
      averageTime: number;
      frequency: number;
    }>;
    commonRejectionReasons: Array<{
      reason: string;
      count: number;
    }>;
  };
  recommendations: string[];
}

export class ApprovalWorkflowManager {
  private workflows: Map<string, ApprovalWorkflow> = new Map();
  private requests: Map<string, ApprovalRequest> = new Map();
  private metrics: Map<string, ApprovalMetrics> = new Map();

  createWorkflow(workflow: Omit<ApprovalWorkflow, 'id' | 'created' | 'modified'>): ApprovalWorkflow {
    const approvalWorkflow: ApprovalWorkflow = {
      ...workflow,
      id: `workflow_${Date.now()}`,
      created: new Date(),
      modified: new Date()
    };

    this.workflows.set(approvalWorkflow.id, approvalWorkflow);
    return approvalWorkflow;
  }

  createApprovalRequest(workflowId: string, requestData: Omit<ApprovalRequest, 'id' | 'workflowId' | 'currentStage' | 'status' | 'stageApprovals' | 'created' | 'modified'>): ApprovalRequest {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const request: ApprovalRequest = {
      ...requestData,
      id: `request_${Date.now()}`,
      workflowId,
      currentStage: 0,
      status: 'pending',
      stageApprovals: workflow.stages.map(stage => ({
        stageId: stage.id,
        stageName: stage.name,
        requiredApprovers: stage.approvers.filter(a => a.required).length,
        currentApprovals: 0,
        approvals: stage.approvers.map(approver => ({
          userId: approver.userId,
          name: approver.name,
          decision: 'pending' as const,
          timestamp: new Date()
        })),
        status: 'pending',
        started: new Date()
      })),
      created: new Date(),
      modified: new Date()
    };

    this.requests.set(request.id, request);

    // Start the workflow
    this.startWorkflow(request.id);

    return request;
  }

  private startWorkflow(requestId: string): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    request.status = 'in_progress';
    request.modified = new Date();

    // Send notifications
    this.sendNotifications(request, 'started');

    // Start first stage
    this.startStage(requestId, 0);
  }

  private startStage(requestId: string, stageIndex: number): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    const stageApproval = request.stageApprovals[stageIndex];
    if (!stageApproval) return;

    stageApproval.status = 'pending';
    stageApproval.started = new Date();

    request.currentStage = stageIndex;
    request.modified = new Date();

    // Send notifications to stage approvers
    this.sendStageNotifications(request, stageApproval);

    // Set timeout if configured
    const workflow = this.workflows.get(request.workflowId);
    if (workflow) {
      const stage = workflow.stages[stageIndex];
      if (stage.timeout > 0) {
        setTimeout(() => {
          this.handleStageTimeout(requestId, stageIndex);
        }, stage.timeout * 60 * 60 * 1000); // Convert hours to milliseconds
      }
    }
  }

  submitApproval(requestId: string, userId: string, stageIndex: number, decision: 'approved' | 'rejected', comments?: string): boolean {
    const request = this.requests.get(requestId);
    if (!request) return false;

    const stageApproval = request.stageApprovals[stageIndex];
    if (!stageApproval) return false;

    const approval = stageApproval.approvals.find(a => a.userId === userId);
    if (!approval) return false;

    approval.decision = decision;
    approval.comments = comments;
    approval.timestamp = new Date();

    // Update stage status
    const approvedCount = stageApproval.approvals.filter(a => a.decision === 'approved').length;
    const rejectedCount = stageApproval.approvals.filter(a => a.decision === 'rejected').length;

    stageApproval.currentApprovals = approvedCount;

    if (rejectedCount > 0) {
      stageApproval.status = 'rejected';
      stageApproval.completed = new Date();
      this.handleStageRejection(requestId, stageIndex);
    } else if (approvedCount >= stageApproval.requiredApprovers) {
      stageApproval.status = 'approved';
      stageApproval.completed = new Date();
      this.handleStageApproval(requestId, stageIndex);
    }

    request.modified = new Date();
    return true;
  }

  private handleStageApproval(requestId: string, stageIndex: number): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    const workflow = this.workflows.get(request.workflowId);
    if (!workflow) return;

    // Send stage completion notifications
    this.sendNotifications(request, 'stage_completed');

    // Move to next stage or complete workflow
    const nextStageIndex = stageIndex + 1;
    if (nextStageIndex < workflow.stages.length) {
      this.startStage(requestId, nextStageIndex);
    } else {
      this.completeWorkflow(requestId, 'approved');
    }
  }

  private handleStageRejection(requestId: string, stageIndex: number): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    // Complete workflow with rejection
    this.completeWorkflow(requestId, 'rejected');
  }

  private handleStageTimeout(requestId: string, stageIndex: number): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    const stageApproval = request.stageApprovals[stageIndex];
    if (stageApproval.status === 'pending') {
      stageApproval.status = 'timed_out';

      const workflow = this.workflows.get(request.workflowId);
      if (workflow) {
        const stage = workflow.stages[stageIndex];
        if (stage.escalation.enabled) {
          // Escalate to designated users
          this.escalateApproval(requestId, stageIndex, stage.escalation.escalateTo);
        } else {
          // Complete workflow with timeout
          this.completeWorkflow(requestId, 'timed_out');
        }
      }
    }
  }

  private escalateApproval(requestId: string, stageIndex: number, escalateTo: string[]): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    // Add escalated approvers to the stage
    const stageApproval = request.stageApprovals[stageIndex];
    escalateTo.forEach(userId => {
      if (!stageApproval.approvals.find(a => a.userId === userId)) {
        stageApproval.approvals.push({
          userId,
          name: `Escalated Approver (${userId})`,
          decision: 'pending',
          timestamp: new Date()
        });
      }
    });

    // Send escalation notifications
    this.sendEscalationNotifications(request, stageIndex, escalateTo);
  }

  private completeWorkflow(requestId: string, result: 'approved' | 'rejected' | 'timed_out'): void {
    const request = this.requests.get(requestId);
    if (!request) return;

    request.status = result;

    // Calculate overall result
    const approvedStages = request.stageApprovals.filter(s => s.status === 'approved').length;
    const rejectedStages = request.stageApprovals.filter(s => s.status === 'rejected').length;

    let overallDecision: ApprovalRequest['overallResult']['decision'] = 'approved';
    if (rejectedStages > 0) {
      overallDecision = 'rejected';
    }

    const approvedBy = request.stageApprovals
      .flatMap(s => s.approvals.filter(a => a.decision === 'approved').map(a => a.name));

    const rejectedBy = request.stageApprovals
      .flatMap(s => s.approvals.filter(a => a.decision === 'rejected').map(a => a.name));

    request.overallResult = {
      decision: overallDecision,
      summary: `Workflow completed with ${approvedStages} approved and ${rejectedStages} rejected stages`,
      approvedBy: [...new Set(approvedBy)],
      rejectedBy: [...new Set(rejectedBy)]
    };

    request.modified = new Date();

    // Send final notifications
    this.sendNotifications(request, result);
  }

  private sendNotifications(request: ApprovalRequest, event: string): void {
    // Implementation would send actual notifications
    console.log(`Sending ${event} notification for request ${request.id}`);
  }

  private sendStageNotifications(request: ApprovalRequest, stageApproval: ApprovalRequest['stageApprovals'][0]): void {
    // Implementation would send notifications to stage approvers
    console.log(`Sending stage notifications for request ${request.id}, stage ${stageApproval.stageName}`);
  }

  private sendEscalationNotifications(request: ApprovalRequest, stageIndex: number, escalateTo: string[]): void {
    // Implementation would send escalation notifications
    console.log(`Sending escalation notifications for request ${request.id}, stage ${stageIndex}`);
  }

  createDefaultWorkflows(): void {
    // Design Review Approval Workflow
    this.createWorkflow({
      name: 'Design Review Approval',
      description: 'Approval workflow for design review results',
      type: 'design',
      trigger: {
        event: 'design_review_completed',
        conditions: { reviewType: 'critical' }
      },
      stages: [
        {
          id: 'peer_review',
          name: 'Peer Review',
          order: 1,
          approvers: [
            { userId: 'eng1', name: 'Senior Engineer', role: 'Engineer', required: true },
            { userId: 'eng2', name: 'Lead Engineer', role: 'Engineer', required: false }
          ],
          criteria: [
            { type: 'review', name: 'Technical review completed', required: true, completed: false },
            { type: 'document', name: 'Review minutes documented', required: true, completed: false }
          ],
          timeout: 48,
          escalation: {
            enabled: true,
            afterHours: 24,
            escalateTo: ['eng_manager']
          }
        },
        {
          id: 'management_approval',
          name: 'Management Approval',
          order: 2,
          approvers: [
            { userId: 'eng_manager', name: 'Engineering Manager', role: 'Manager', required: true }
          ],
          criteria: [
            { type: 'signoff', name: 'Management signoff obtained', required: true, completed: false }
          ],
          timeout: 72,
          escalation: {
            enabled: true,
            afterHours: 48,
            escalateTo: ['vp_engineering']
          }
        }
      ],
      notifications: {
        onStart: true,
        onStageComplete: true,
        onApproval: true,
        onRejection: true,
        onTimeout: true,
        reminderInterval: 24
      }
    });

    // Change Request Approval Workflow
    this.createWorkflow({
      name: 'Change Request Approval',
      description: 'Approval workflow for engineering change requests',
      type: 'change',
      trigger: {
        event: 'change_request_submitted',
        conditions: { priority: 'high' }
      },
      stages: [
        {
          id: 'impact_assessment',
          name: 'Impact Assessment',
          order: 1,
          approvers: [
            { userId: 'change_board', name: 'Change Control Board', role: 'Board', required: true }
          ],
          criteria: [
            { type: 'document', name: 'Impact analysis completed', required: true, completed: false },
            { type: 'review', name: 'Risk assessment reviewed', required: true, completed: false }
          ],
          timeout: 72,
          escalation: {
            enabled: false,
            afterHours: 0,
            escalateTo: []
          }
        },
        {
          id: 'final_approval',
          name: 'Final Approval',
          order: 2,
          approvers: [
            { userId: 'vp_engineering', name: 'VP Engineering', role: 'Executive', required: true },
            { userId: 'vp_operations', name: 'VP Operations', role: 'Executive', required: false }
          ],
          criteria: [
            { type: 'signoff', name: 'Executive signoff obtained', required: true, completed: false }
          ],
          timeout: 120,
          escalation: {
            enabled: true,
            afterHours: 96,
            escalateTo: ['ceo']
          }
        }
      ],
      notifications: {
        onStart: true,
        onStageComplete: true,
        onApproval: true,
        onRejection: true,
        onTimeout: true,
        reminderInterval: 48
      }
    });
  }

  generateApprovalMetrics(workflowId: string, startDate: Date, endDate: Date): ApprovalMetrics {
    const requests = Array.from(this.requests.values())
      .filter(r => r.workflowId === workflowId &&
                   r.created >= startDate &&
                   r.created <= endDate);

    const totalRequests = requests.length;
    const approvedRequests = requests.filter(r => r.status === 'approved').length;
    const rejectedRequests = requests.filter(r => r.status === 'rejected').length;

    const completionTimes = requests
      .filter(r => r.overallResult)
      .map(r => (r.modified.getTime() - r.created.getTime()) / (1000 * 60 * 60)); // hours

    const averageApprovalTime = completionTimes.length > 0 ?
      completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length : 0;

    // Calculate stage bottlenecks
    const stageTimes = new Map<string, number[]>();
    requests.forEach(request => {
      request.stageApprovals.forEach(stage => {
        if (stage.completed) {
          const time = (stage.completed.getTime() - stage.started.getTime()) / (1000 * 60 * 60);
          if (!stageTimes.has(stage.stageId)) {
            stageTimes.set(stage.stageId, []);
          }
          stageTimes.get(stage.stageId)!.push(time);
        }
      });
    });

    const bottleneckStages = Array.from(stageTimes.entries())
      .map(([stageId, times]) => ({
        stageId,
        stageName: stageId, // Would look up actual name
        averageTime: times.reduce((a, b) => a + b, 0) / times.length,
        frequency: times.length
      }))
      .sort((a, b) => b.averageTime - a.averageTime)
      .slice(0, 3);

    const metrics: ApprovalMetrics = {
      id: `metrics_${Date.now()}`,
      workflowId,
      period: { start: startDate, end: endDate },
      metrics: {
        totalRequests,
        approvedRequests,
        rejectedRequests,
        averageApprovalTime,
        averageStageTime: bottleneckStages.length > 0 ? bottleneckStages[0].averageTime : 0,
        bottleneckStages,
        commonRejectionReasons: [] // Would analyze actual rejection comments
      },
      recommendations: this.generateMetricsRecommendations(metrics)
    };

    this.metrics.set(metrics.id, metrics);
    return metrics;
  }

  private generateMetricsRecommendations(metrics: ApprovalMetrics): string[] {
    const recommendations = [];

    if (metrics.metrics.averageApprovalTime > 168) { // More than 1 week
      recommendations.push('Consider streamlining the approval process to reduce cycle time');
    }

    if (metrics.metrics.bottleneckStages.length > 0) {
      recommendations.push(`Address bottlenecks in stage: ${metrics.metrics.bottleneckStages[0].stageName}`);
    }

    if (metrics.metrics.rejectedRequests / metrics.metrics.totalRequests > 0.3) {
      recommendations.push('High rejection rate - review approval criteria and training');
    }

    recommendations.push('Implement automated approval for low-risk changes');
    recommendations.push('Regular review of approval workflows for continuous improvement');

    return recommendations;
  }

  getWorkflow(id: string): ApprovalWorkflow | undefined {
    return this.workflows.get(id);
  }

  getApprovalRequest(id: string): ApprovalRequest | undefined {
    return this.requests.get(id);
  }

  getApprovalMetrics(id: string): ApprovalMetrics | undefined {
    return this.metrics.get(id);
  }

  getAllWorkflows(): ApprovalWorkflow[] {
    return Array.from(this.workflows.values());
  }

  getAllRequests(): ApprovalRequest[] {
    return Array.from(this.requests.values());
  }

  getRequestsByStatus(status: ApprovalRequest['status']): ApprovalRequest[] {
    return this.getAllRequests().filter(request => request.status === status);
  }

  getRequestsByWorkflow(workflowId: string): ApprovalRequest[] {
    return this.getAllRequests().filter(request => request.workflowId === workflowId);
  }

  getOverdueRequests(): ApprovalRequest[] {
    const now = new Date();
    return this.getAllRequests().filter(request =>
      request.dueDate && request.dueDate < now && request.status === 'in_progress'
    );
  }
}

export const approvalWorkflowManager = new ApprovalWorkflowManager();