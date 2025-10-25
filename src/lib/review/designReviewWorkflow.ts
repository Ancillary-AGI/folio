import { Component } from '../../types';

export interface DesignReview {
  id: string;
  title: string;
  description: string;
  type: 'preliminary' | 'critical' | 'final' | 'peer' | 'expert' | 'customer';
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  projectId: string;
  reviewItems: Array<{
    id: string;
    type: 'requirement' | 'design' | 'implementation' | 'test' | 'documentation';
    itemId: string;
    name: string;
    description: string;
    criteria: string[];
  }>;
  reviewers: Array<{
    userId: string;
    name: string;
    role: string;
    expertise: string[];
    assignedDate: Date;
    completedDate?: Date;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
  checklist: Array<{
    id: string;
    category: string;
    question: string;
    required: boolean;
    response?: 'yes' | 'no' | 'n/a';
    comments?: string;
    reviewerId?: string;
  }>;
  findings: Array<{
    id: string;
    type: 'issue' | 'recommendation' | 'approval';
    severity: 'minor' | 'major' | 'critical';
    category: 'functional' | 'performance' | 'safety' | 'reliability' | 'manufacturability' | 'cost';
    description: string;
    evidence: string;
    recommendation: string;
    assignedTo?: string;
    status: 'open' | 'addressed' | 'closed';
    dueDate?: Date;
  }>;
  schedule: {
    plannedStart: Date;
    plannedEnd: Date;
    actualStart?: Date;
    actualEnd?: Date;
  };
  outcome: {
    result: 'approved' | 'approved_with_conditions' | 'rejected' | 'deferred';
    summary: string;
    actionItems: Array<{
      description: string;
      assignedTo: string;
      dueDate: Date;
      priority: 'low' | 'medium' | 'high';
    }>;
  };
  created: Date;
  modified: Date;
}

export interface ReviewTemplate {
  id: string;
  name: string;
  type: DesignReview['type'];
  description: string;
  checklist: Array<{
    category: string;
    question: string;
    required: boolean;
  }>;
  criteria: Array<{
    category: string;
    requirements: string[];
  }>;
  reviewers: Array<{
    role: string;
    expertise: string[];
    required: boolean;
  }>;
}

export interface ReviewMetrics {
  id: string;
  reviewId: string;
  metrics: {
    totalFindings: number;
    criticalFindings: number;
    majorFindings: number;
    minorFindings: number;
    openFindings: number;
    closedFindings: number;
    reviewDuration: number; // hours
    reviewerParticipation: number; // percentage
    checklistCompletion: number; // percentage
  };
  qualityScore: number; // 1-10
  efficiencyScore: number; // 1-10
  recommendations: string[];
}

export class DesignReviewWorkflow {
  private reviews: Map<string, DesignReview> = new Map();
  private templates: Map<string, ReviewTemplate> = new Map();
  private metrics: Map<string, ReviewMetrics> = new Map();

  createReview(reviewData: Omit<DesignReview, 'id' | 'created' | 'modified' | 'outcome'>): DesignReview {
    const review: DesignReview = {
      ...reviewData,
      id: `review_${Date.now()}`,
      created: new Date(),
      modified: new Date(),
      outcome: {
        result: 'approved',
        summary: '',
        actionItems: []
      }
    };

    this.reviews.set(review.id, review);
    return review;
  }

  createReviewFromTemplate(templateId: string, projectId: string, customizations?: Partial<DesignReview>): DesignReview {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error('Review template not found');
    }

    const checklist = template.checklist.map(item => ({
      id: `check_${Date.now()}_${Math.random()}`,
      category: item.category,
      question: item.question,
      required: item.required
    }));

    const reviewData: Omit<DesignReview, 'id' | 'created' | 'modified' | 'outcome'> = {
      title: `${template.name} Review`,
      description: template.description,
      type: template.type,
      status: 'planned',
      projectId,
      reviewItems: [],
      reviewers: [],
      checklist,
      findings: [],
      schedule: {
        plannedStart: new Date(),
        plannedEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
      },
      ...customizations
    };

    return this.createReview(reviewData);
  }

  createReviewTemplate(template: Omit<ReviewTemplate, 'id'>): ReviewTemplate {
    const reviewTemplate: ReviewTemplate = {
      ...template,
      id: `template_${Date.now()}`
    };

    this.templates.set(reviewTemplate.id, reviewTemplate);
    return reviewTemplate;
  }

  assignReviewer(reviewId: string, reviewer: Omit<DesignReview['reviewers'][0], 'assignedDate' | 'status'>): boolean {
    const review = this.reviews.get(reviewId);
    if (!review) return false;

    review.reviewers.push({
      ...reviewer,
      assignedDate: new Date(),
      status: 'pending'
    });

    review.modified = new Date();
    return true;
  }

  submitReviewResponse(reviewId: string, reviewerId: string, responses: Array<{
    checklistId: string;
    response: 'yes' | 'no' | 'n/a';
    comments?: string;
  }>, findings: Array<Omit<DesignReview['findings'][0], 'id' | 'status'>>): boolean {
    const review = this.reviews.get(reviewId);
    if (!review) return false;

    const reviewer = review.reviewers.find(r => r.userId === reviewerId);
    if (!reviewer) return false;

    // Update checklist responses
    responses.forEach(response => {
      const checklistItem = review.checklist.find(item => item.id === response.checklistId);
      if (checklistItem) {
        checklistItem.response = response.response;
        checklistItem.comments = response.comments;
        checklistItem.reviewerId = reviewerId;
      }
    });

    // Add findings
    findings.forEach(finding => {
      review.findings.push({
        ...finding,
        id: `finding_${Date.now()}_${Math.random()}`,
        status: 'open'
      });
    });

    // Update reviewer status
    reviewer.status = 'completed';
    reviewer.completedDate = new Date();

    review.modified = new Date();
    return true;
  }

  completeReview(reviewId: string, outcome: DesignReview['outcome']): boolean {
    const review = this.reviews.get(reviewId);
    if (!review) return false;

    review.status = 'completed';
    review.outcome = outcome;
    review.schedule.actualEnd = new Date();
    review.modified = new Date();

    return true;
  }

  generateReviewReport(reviewId: string): any {
    const review = this.reviews.get(reviewId);
    if (!review) {
      throw new Error('Review not found');
    }

    const metrics = this.calculateReviewMetrics(review);

    return {
      review,
      metrics,
      summary: {
        totalReviewers: review.reviewers.length,
        completedReviews: review.reviewers.filter(r => r.status === 'completed').length,
        totalFindings: review.findings.length,
        criticalFindings: review.findings.filter(f => f.severity === 'critical').length,
        openFindings: review.findings.filter(f => f.status === 'open').length,
        checklistCompletion: this.calculateChecklistCompletion(review)
      },
      recommendations: this.generateReviewRecommendations(review, metrics)
    };
  }

  private calculateReviewMetrics(review: DesignReview): ReviewMetrics['metrics'] {
    const totalFindings = review.findings.length;
    const criticalFindings = review.findings.filter(f => f.severity === 'critical').length;
    const majorFindings = review.findings.filter(f => f.severity === 'major').length;
    const minorFindings = review.findings.filter(f => f.severity === 'minor').length;
    const openFindings = review.findings.filter(f => f.status === 'open').length;
    const closedFindings = totalFindings - openFindings;

    const reviewDuration = review.schedule.actualEnd && review.schedule.actualStart ?
      (review.schedule.actualEnd.getTime() - review.schedule.actualStart.getTime()) / (1000 * 60 * 60) : 0;

    const reviewerParticipation = review.reviewers.length > 0 ?
      (review.reviewers.filter(r => r.status === 'completed').length / review.reviewers.length) * 100 : 0;

    const checklistCompletion = this.calculateChecklistCompletion(review);

    return {
      totalFindings,
      criticalFindings,
      majorFindings,
      minorFindings,
      openFindings,
      closedFindings,
      reviewDuration,
      reviewerParticipation,
      checklistCompletion
    };
  }

  private calculateChecklistCompletion(review: DesignReview): number {
    const totalItems = review.checklist.length;
    const completedItems = review.checklist.filter(item => item.response !== undefined).length;

    return totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
  }

  private generateReviewRecommendations(review: DesignReview, metrics: ReviewMetrics['metrics']): string[] {
    const recommendations = [];

    if (metrics.criticalFindings > 0) {
      recommendations.push('Address all critical findings before proceeding');
    }

    if (metrics.reviewerParticipation < 80) {
      recommendations.push('Improve reviewer participation in future reviews');
    }

    if (metrics.checklistCompletion < 90) {
      recommendations.push('Ensure complete checklist coverage in future reviews');
    }

    if (review.outcome.result === 'approved_with_conditions') {
      recommendations.push('Monitor implementation of conditional approval requirements');
    }

    recommendations.push('Schedule regular follow-up reviews to track finding resolution');

    return recommendations;
  }

  createDefaultTemplates(): void {
    // Preliminary Design Review Template
    this.createReviewTemplate({
      name: 'Preliminary Design Review',
      type: 'preliminary',
      description: 'Review of initial design concepts and requirements compliance',
      checklist: [
        { category: 'Requirements', question: 'Are all requirements clearly defined and traceable?', required: true },
        { category: 'Requirements', question: 'Is the design approach feasible?', required: true },
        { category: 'Design', question: 'Are design constraints properly identified?', required: true },
        { category: 'Design', question: 'Is the proposed architecture appropriate?', required: true },
        { category: 'Risk', question: 'Have major risks been identified and mitigation planned?', required: true },
        { category: 'Schedule', question: 'Is the development schedule realistic?', required: true }
      ],
      criteria: [
        {
          category: 'Requirements',
          requirements: [
            'All requirements are documented and approved',
            'Requirements are clear, complete, and testable',
            'Design satisfies all requirements'
          ]
        },
        {
          category: 'Design',
          requirements: [
            'Design approach is sound and innovative',
            'Design meets performance requirements',
            'Design considers manufacturability and testability'
          ]
        }
      ],
      reviewers: [
        { role: 'Design Engineer', expertise: ['design', 'requirements'], required: true },
        { role: 'Project Manager', expertise: ['schedule', 'resources'], required: true },
        { role: 'Quality Engineer', expertise: ['quality', 'standards'], required: false }
      ]
    });

    // Critical Design Review Template
    this.createReviewTemplate({
      name: 'Critical Design Review',
      type: 'critical',
      description: 'Review of detailed design implementation',
      checklist: [
        { category: 'Design', question: 'Is the detailed design complete and correct?', required: true },
        { category: 'Implementation', question: 'Are implementation details adequate?', required: true },
        { category: 'Testing', question: 'Is the test approach comprehensive?', required: true },
        { category: 'Safety', question: 'Have safety requirements been addressed?', required: true },
        { category: 'Performance', question: 'Will the design meet performance requirements?', required: true },
        { category: 'Manufacturing', question: 'Is the design manufacturable?', required: true }
      ],
      criteria: [
        {
          category: 'Technical',
          requirements: [
            'Design is complete and detailed',
            'All interfaces are defined',
            'Design margins are adequate'
          ]
        },
        {
          category: 'Quality',
          requirements: [
            'Design follows applicable standards',
            'Design is verifiable and testable',
            'Design risks are acceptable'
          ]
        }
      ],
      reviewers: [
        { role: 'Lead Engineer', expertise: ['design', 'implementation'], required: true },
        { role: 'Test Engineer', expertise: ['testing', 'verification'], required: true },
        { role: 'Manufacturing Engineer', expertise: ['manufacturing', 'DFM'], required: true },
        { role: 'Safety Engineer', expertise: ['safety', 'reliability'], required: false }
      ]
    });

    // Final Design Review Template
    this.createReviewTemplate({
      name: 'Final Design Review',
      type: 'final',
      description: 'Final review before release to manufacturing',
      checklist: [
        { category: 'Verification', question: 'Has all verification testing been completed?', required: true },
        { category: 'Validation', question: 'Does the design meet all requirements?', required: true },
        { category: 'Documentation', question: 'Is all documentation complete and accurate?', required: true },
        { category: 'Manufacturing', question: 'Are manufacturing processes ready?', required: true },
        { category: 'Quality', question: 'Has quality assurance been completed?', required: true },
        { category: 'Release', question: 'Is the design ready for release?', required: true }
      ],
      criteria: [
        {
          category: 'Readiness',
          requirements: [
            'All testing is complete and passed',
            'All documentation is approved',
            'Manufacturing processes are qualified',
            'Training is complete'
          ]
        },
        {
          category: 'Compliance',
          requirements: [
            'Design meets all regulatory requirements',
            'Design follows company standards',
            'Change control is complete'
          ]
        }
      ],
      reviewers: [
        { role: 'Project Manager', expertise: ['project', 'schedule'], required: true },
        { role: 'Quality Manager', expertise: ['quality', 'compliance'], required: true },
        { role: 'Manufacturing Manager', expertise: ['manufacturing', 'production'], required: true },
        { role: 'Customer Representative', expertise: ['requirements', 'acceptance'], required: false }
      ]
    });
  }

  getReview(id: string): DesignReview | undefined {
    return this.reviews.get(id);
  }

  getReviewTemplate(id: string): ReviewTemplate | undefined {
    return this.templates.get(id);
  }

  getReviewMetrics(id: string): ReviewMetrics | undefined {
    return this.metrics.get(id);
  }

  getAllReviews(): DesignReview[] {
    return Array.from(this.reviews.values());
  }

  getAllTemplates(): ReviewTemplate[] {
    return Array.from(this.templates.values());
  }

  getReviewsByStatus(status: DesignReview['status']): DesignReview[] {
    return this.getAllReviews().filter(review => review.status === status);
  }

  getReviewsByType(type: DesignReview['type']): DesignReview[] {
    return this.getAllReviews().filter(review => review.type === type);
  }

  getOverdueReviews(): DesignReview[] {
    const now = new Date();
    return this.getAllReviews().filter(review =>
      review.schedule.plannedEnd < now && review.status !== 'completed'
    );
  }
}

export const designReviewWorkflow = new DesignReviewWorkflow();