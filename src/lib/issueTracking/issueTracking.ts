import { Component } from '../../types';

export interface Issue {
  id: string;
  title: string;
  description: string;
  type: 'bug' | 'feature' | 'enhancement' | 'task' | 'epic' | 'story' | 'subtask' | 'incident' | 'problem' | 'change_request';
  priority: 'lowest' | 'low' | 'medium' | 'high' | 'highest' | 'critical';
  severity: 'trivial' | 'minor' | 'major' | 'critical' | 'blocker';
  status: 'open' | 'in_progress' | 'review' | 'testing' | 'resolved' | 'closed' | 'reopened' | 'blocked' | 'on_hold';
  resolution?: 'fixed' | 'wont_fix' | 'duplicate' | 'incomplete' | 'cannot_reproduce' | 'works_as_designed' | 'obsolete';
  assignee?: string;
  reporter: string;
  created: Date;
  updated: Date;
  dueDate?: Date;
  estimatedHours?: number;
  actualHours?: number;
  labels: string[];
  components: string[];
  affectsVersions: string[];
  fixVersions: string[];
  environment?: string;
  attachments: Array<{
    id: string;
    name: string;
    url: string;
    uploadedBy: string;
    uploadedAt: Date;
  }>;
  comments: Array<{
    id: string;
    author: string;
    content: string;
    created: Date;
    updated?: Date;
    attachments?: string[];
  }>;
  linkedIssues: Array<{
    id: string;
    type: 'blocks' | 'blocked_by' | 'relates_to' | 'duplicates' | 'duplicated_by' | 'parent_of' | 'child_of' | 'causes' | 'caused_by';
  }>;
  customFields: Record<string, unknown>;
  watchers: string[];
  votes: number;
  timeTracking: {
    originalEstimate?: number;
    remainingEstimate?: number;
    timeSpent?: number;
  };
  sprint?: string;
  epic?: string;
  storyPoints?: number;
  acceptanceCriteria?: string[];
  testCases?: string[];
  metadata: {
    project: string;
    tags: string[];
    externalId?: string;
    source?: string;
  };
}

export interface IssueFilter {
  id: string;
  name: string;
  query: {
    assignee?: string[];
    reporter?: string[];
    status?: string[];
    priority?: string[];
    type?: string[];
    labels?: string[];
    components?: string[];
    project?: string[];
    createdAfter?: Date;
    createdBefore?: Date;
    updatedAfter?: Date;
    updatedBefore?: Date;
    dueAfter?: Date;
    dueBefore?: Date;
    customFields?: Record<string, unknown>;
  };
  sortBy?: {
    field: string;
    order: 'asc' | 'desc';
  };
  groupBy?: string;
  columns?: string[];
  shared: boolean;
  owner: string;
  created: Date;
  updated: Date;
}

export interface IssueWorkflow {
  id: string;
  name: string;
  description: string;
  states: Array<{
    id: string;
    name: string;
    category: 'todo' | 'in_progress' | 'done';
    properties: {
      issueEditable: boolean;
      subtaskCreation: boolean;
      resolutionRequired: boolean;
    };
  }>;
  transitions: Array<{
    id: string;
    name: string;
    fromState: string;
    toState: string;
    conditions: Array<{
      type: 'user_permission' | 'field_value' | 'issue_status' | 'custom';
      value: unknown;
    }>;
    validators: Array<{
      type: 'required_field' | 'field_value' | 'custom';
      field?: string;
      value?: unknown;
    }>;
    postFunctions: Array<{
      type: 'update_field' | 'add_comment' | 'send_notification' | 'custom';
      config: Record<string, unknown>;
    }>;
  }>;
  properties: {
    allowCircularTransitions: boolean;
    requireAssignee: boolean;
    autoAssign: boolean;
    defaultAssignee?: string;
  };
}

export interface IssueBoard {
  id: string;
  name: string;
  type: 'scrum' | 'kanban' | 'custom';
  project: string;
  columns: Array<{
    id: string;
    name: string;
    status: string[];
    wipLimit?: number;
    color?: string;
  }>;
  swimlanes?: Array<{
    id: string;
    name: string;
    query: string;
    color?: string;
  }>;
  quickFilters?: Array<{
    id: string;
    name: string;
    query: string;
    color?: string;
  }>;
  cardLayout: {
    fields: string[];
    avatar: boolean;
    badges: string[];
    labels: boolean;
  };
  settings: {
    estimation: 'story_points' | 'hours' | 'days' | 't_shirt_sizes';
    timeTracking: boolean;
    subTasks: boolean;
    epics: boolean;
    sprints: boolean;
  };
}

export interface IssueSprint {
  id: string;
  name: string;
  goal?: string;
  state: 'future' | 'active' | 'closed';
  startDate?: Date;
  endDate?: Date;
  completeDate?: Date;
  boardId: string;
  issues: string[];
  committed: {
    storyPoints: number;
    issues: number;
  };
  completed: {
    storyPoints: number;
    issues: number;
  };
  metrics: {
    velocity: number;
    commitmentReliability: number;
    burndown: Array<{
      date: Date;
      remaining: number;
      ideal: number;
    }>;
    burnup: Array<{
      date: Date;
      completed: number;
      scope: number;
    }>;
  };
  retrospective?: {
    whatWentWell: string[];
    whatCouldBeImproved: string[];
    actionItems: Array<{
      description: string;
      owner: string;
      dueDate: Date;
    }>;
  };
}

export interface IssueReport {
  id: string;
  name: string;
  type: 'created_vs_resolved' | 'resolution_time' | 'workload' | 'velocity' | 'burndown' | 'burnup' | 'control_chart' | 'pie_chart' | 'histogram' | 'custom';
  description?: string;
  filters: IssueFilter['query'];
  groupBy?: string[];
  metrics: Array<{
    name: string;
    field: string;
    aggregation: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'median';
  }>;
  chart: {
    type: 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'histogram';
    xAxis: string;
    yAxis: string;
    series?: string[];
    colors?: Record<string, string>;
  };
  schedule?: {
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
    recipients: string[];
    format: 'pdf' | 'excel' | 'email';
  };
  created: Date;
  lastRun?: Date;
  owner: string;
}

export interface IssueNotification {
  id: string;
  name: string;
  description?: string;
  trigger: {
    events: Array<'issue_created' | 'issue_updated' | 'issue_deleted' | 'comment_added' | 'status_changed' | 'assignee_changed' | 'due_date_approaching' | 'sla_breached'>;
    filters: IssueFilter['query'];
  };
  recipients: Array<{
    type: 'user' | 'group' | 'email' | 'webhook';
    value: string;
    conditions?: Record<string, unknown>;
  }>;
  template: {
    subject: string;
    body: string;
    format: 'text' | 'html' | 'markdown';
  };
  schedule?: {
    immediate: boolean;
    batch: boolean;
    batchInterval?: number; // minutes
    quietHours?: {
      start: string; // HH:MM
      end: string; // HH:MM
    };
  };
  enabled: boolean;
  created: Date;
  updated: Date;
}

export class IssueTrackingManager {
  private issues: Map<string, Issue> = new Map();
  private filters: Map<string, IssueFilter> = new Map();
  private workflows: Map<string, IssueWorkflow> = new Map();
  private boards: Map<string, IssueBoard> = new Map();
  private sprints: Map<string, IssueSprint> = new Map();
  private reports: Map<string, IssueReport> = new Map();
  private notifications: Map<string, IssueNotification> = new Map();

  createIssue(issue: Omit<Issue, 'id' | 'created' | 'updated'>): Issue {
    const newIssue: Issue = {
      ...issue,
      id: `issue_${Date.now()}`,
      created: new Date(),
      updated: new Date()
    };

    this.issues.set(newIssue.id, newIssue);
    return newIssue;
  }

  createIssueFilter(filter: Omit<IssueFilter, 'id' | 'created' | 'updated'>): IssueFilter {
    const newFilter: IssueFilter = {
      ...filter,
      id: `filter_${Date.now()}`,
      created: new Date(),
      updated: new Date()
    };

    this.filters.set(newFilter.id, newFilter);
    return newFilter;
  }

  createIssueWorkflow(workflow: Omit<IssueWorkflow, 'id'>): IssueWorkflow {
    const newWorkflow: IssueWorkflow = {
      ...workflow,
      id: `workflow_${Date.now()}`
    };

    this.workflows.set(newWorkflow.id, newWorkflow);
    return newWorkflow;
  }

  createIssueBoard(board: Omit<IssueBoard, 'id'>): IssueBoard {
    const newBoard: IssueBoard = {
      ...board,
      id: `board_${Date.now()}`
    };

    this.boards.set(newBoard.id, newBoard);
    return newBoard;
  }

  createIssueSprint(sprint: Omit<IssueSprint, 'id'>): IssueSprint {
    const newSprint: IssueSprint = {
      ...sprint,
      id: `sprint_${Date.now()}`
    };

    this.sprints.set(newSprint.id, newSprint);
    return newSprint;
  }

  createIssueReport(report: Omit<IssueReport, 'id' | 'created'>): IssueReport {
    const newReport: IssueReport = {
      ...report,
      id: `report_${Date.now()}`,
      created: new Date()
    };

    this.reports.set(newReport.id, newReport);
    return newReport;
  }

  createIssueNotification(notification: Omit<IssueNotification, 'id' | 'created' | 'updated'>): IssueNotification {
    const newNotification: IssueNotification = {
      ...notification,
      id: `notification_${Date.now()}`,
      created: new Date(),
      updated: new Date()
    };

    this.notifications.set(newNotification.id, newNotification);
    return newNotification;
  }

  updateIssueStatus(issueId: string, status: Issue['status'], userId: string): Promise<TransitionResult> {
    return new Promise((resolve) => {
      const issue = this.issues.get(issueId);
      if (!issue) {
        resolve({ success: false, error: 'Issue not found' });
        return;
      }

      // Simulate workflow validation
      setTimeout(() => {
        const result = this.validateTransition(issue, status, userId);

        if (result.valid) {
          issue.status = status;
          issue.updated = new Date();

          // Add status change comment
          issue.comments.push({
            id: `comment_${Date.now()}`,
            author: userId,
            content: `Status changed to ${status}`,
            created: new Date()
          });
        }

        resolve({
          success: result.valid,
          issueId,
          fromStatus: issue.status,
          toStatus: status,
          valid: result.valid,
          errors: result.errors,
          transitionTime: Date.now()
        });
      }, 200 + Math.random() * 500); // 0.2-0.7 seconds
    });
  }

  private validateTransition(issue: Issue, newStatus: Issue['status'], userId: string): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Basic validation
    if (issue.status === newStatus) {
      errors.push('Issue is already in this status');
    }

    // Check assignee requirement
    if (newStatus === 'in_progress' && !issue.assignee) {
      errors.push('Issue must be assigned before moving to in progress');
    }

    // Check resolution requirement
    if (newStatus === 'closed' && !issue.resolution) {
      errors.push('Resolution must be set before closing issue');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  assignIssue(issueId: string, assigneeId: string, userId: string): Promise<AssignmentResult> {
    return new Promise((resolve) => {
      const issue = this.issues.get(issueId);
      if (!issue) {
        resolve({ success: false, error: 'Issue not found' });
        return;
      }

      // Simulate assignment
      setTimeout(() => {
        const previousAssignee = issue.assignee;
        issue.assignee = assigneeId;
        issue.updated = new Date();

        // Add assignment comment
        issue.comments.push({
          id: `comment_${Date.now()}`,
          author: userId,
          content: `Assigned to ${assigneeId}`,
          created: new Date()
        });

        resolve({
          success: true,
          issueId,
          assignee: assigneeId,
          previousAssignee,
          assignedBy: userId,
          assignmentTime: Date.now()
        });
      }, 100 + Math.random() * 200); // 0.1-0.3 seconds
    });
  }

  addIssueComment(issueId: string, comment: Omit<Issue['comments'][0], 'id' | 'created'>): Promise<CommentResult> {
    return new Promise((resolve) => {
      const issue = this.issues.get(issueId);
      if (!issue) {
        resolve({ success: false, error: 'Issue not found' });
        return;
      }

      // Simulate adding comment
      setTimeout(() => {
        const newComment: Issue['comments'][0] = {
          ...comment,
          id: `comment_${Date.now()}`,
          created: new Date()
        };

        issue.comments.push(newComment);
        issue.updated = new Date();

        resolve({
          success: true,
          issueId,
          commentId: newComment.id,
          author: comment.author,
          commentTime: Date.now()
        });
      }, 50 + Math.random() * 100); // 0.05-0.15 seconds
    });
  }

  searchIssues(query: IssueFilter['query'], sortBy?: IssueFilter['sortBy'], limit?: number): Promise<SearchResult> {
    return new Promise((resolve) => {
      // Simulate search
      setTimeout(() => {
        const results = this.performIssueSearch(query, sortBy, limit);

        resolve({
          success: true,
          query,
          results: results.issues,
          total: results.total,
          page: 1,
          pageSize: limit || 50,
          sortBy,
          searchTime: Date.now()
        });
      }, 100 + Math.random() * 300); // 0.1-0.4 seconds
    });
  }

  private performIssueSearch(query: IssueFilter['query'], sortBy?: IssueFilter['sortBy'], limit?: number): {
    issues: Issue[];
    total: number;
  } {
    let issues = Array.from(this.issues.values());

    // Apply filters
    if (query.assignee?.length) {
      issues = issues.filter(issue => issue.assignee && query.assignee!.includes(issue.assignee));
    }

    if (query.status?.length) {
      issues = issues.filter(issue => query.status!.includes(issue.status));
    }

    if (query.priority?.length) {
      issues = issues.filter(issue => query.priority!.includes(issue.priority));
    }

    if (query.type?.length) {
      issues = issues.filter(issue => query.type!.includes(issue.type));
    }

    if (query.labels?.length) {
      issues = issues.filter(issue => issue.labels.some(label => query.labels!.includes(label)));
    }

    // Apply sorting
    if (sortBy) {
      issues.sort((a, b) => {
        const aValue = (a as any)[sortBy.field];
        const bValue = (b as any)[sortBy.field];

        if (sortBy.order === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
    }

    const total = issues.length;
    const limitedIssues = limit ? issues.slice(0, limit) : issues;

    return { issues: limitedIssues, total };
  }

  generateBurndownChart(sprintId: string): Promise<BurndownResult> {
    return new Promise((resolve) => {
      const sprint = this.sprints.get(sprintId);
      if (!sprint) {
        resolve({ success: false, error: 'Sprint not found' });
        return;
      }

      // Simulate burndown generation
      setTimeout(() => {
        const result = this.calculateBurndown(sprint);

        resolve({
          success: true,
          sprintId,
          burndown: result.burndown,
          ideal: result.ideal,
          remaining: result.remaining,
          completed: result.completed,
          generationTime: Date.now()
        });
      }, 300 + Math.random() * 500); // 0.3-0.8 seconds
    });
  }

  private calculateBurndown(sprint: IssueSprint): {
    burndown: Array<{ date: Date; remaining: number }>;
    ideal: Array<{ date: Date; remaining: number }>;
    remaining: number;
    completed: number;
  } {
    const burndown: Array<{ date: Date; remaining: number }> = [];
    const ideal: Array<{ date: Date; remaining: number }> = [];

    if (!sprint.startDate || !sprint.endDate) {
      return { burndown, ideal, remaining: sprint.committed.storyPoints, completed: sprint.completed.storyPoints };
    }

    const totalDays = Math.ceil((sprint.endDate.getTime() - sprint.startDate.getTime()) / (1000 * 60 * 60 * 24));
    const totalPoints = sprint.committed.storyPoints;

    // Generate ideal burndown
    for (let i = 0; i <= totalDays; i++) {
      const date = new Date(sprint.startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const remaining = totalPoints * (1 - i / totalDays);
      ideal.push({ date, remaining });
    }

    // Generate actual burndown (simulated)
    let remainingPoints = totalPoints;
    for (let i = 0; i <= totalDays; i++) {
      const date = new Date(sprint.startDate.getTime() + i * 24 * 60 * 60 * 1000);
      // Simulate some progress
      if (i > 0) {
        const progress = (Math.random() * 0.3 + 0.1) * totalPoints / totalDays; // 10-40% daily progress
        remainingPoints = Math.max(0, remainingPoints - progress);
      }
      burndown.push({ date, remaining: remainingPoints });
    }

    return {
      burndown,
      ideal,
      remaining: remainingPoints,
      completed: totalPoints - remainingPoints
    };
  }

  runIssueReport(reportId: string): Promise<ReportResult> {
    return new Promise((resolve) => {
      const report = this.reports.get(reportId);
      if (!report) {
        resolve({ success: false, error: 'Report not found' });
        return;
      }

      // Simulate report generation
      setTimeout(() => {
        const result = this.generateReportData(report);

        report.lastRun = new Date();

        resolve({
          success: true,
          reportId,
          data: result.data,
          chart: result.chart,
          summary: result.summary,
          generatedAt: new Date(),
          generationTime: Date.now()
        });
      }, 1000 + Math.random() * 2000); // 1-3 seconds
    });
  }

  private generateReportData(report: IssueReport): {
    data: Array<Record<string, unknown>>;
    chart: Record<string, unknown>;
    summary: Record<string, unknown>;
  } {
    // Simulate report data generation
    const data: Array<Record<string, unknown>> = [];
    const issues = Array.from(this.issues.values());

    // Group and aggregate data
    const groupedData = new Map<string, number>();

    issues.forEach(issue => {
      const key = report.groupBy ? (issue as any)[report.groupBy[0]] : 'all';
      groupedData.set(key, (groupedData.get(key) || 0) + 1);
    });

    groupedData.forEach((count, key) => {
      data.push({ group: key, count });
    });

    const chart: Record<string, unknown> = {
      type: report.chart.type,
      data: data,
      xAxis: report.chart.xAxis,
      yAxis: report.chart.yAxis
    };

    const summary: Record<string, unknown> = {
      totalIssues: issues.length,
      openIssues: issues.filter(i => i.status === 'open').length,
      closedIssues: issues.filter(i => i.status === 'closed').length,
      averageResolutionTime: 5.2, // days
      generatedAt: new Date()
    };

    return { data, chart, summary };
  }

  getIssue(id: string): Issue | undefined {
    return this.issues.get(id);
  }

  getIssueFilter(id: string): IssueFilter | undefined {
    return this.filters.get(id);
  }

  getIssueWorkflow(id: string): IssueWorkflow | undefined {
    return this.workflows.get(id);
  }

  getIssueBoard(id: string): IssueBoard | undefined {
    return this.boards.get(id);
  }

  getIssueSprint(id: string): IssueSprint | undefined {
    return this.sprints.get(id);
  }

  getIssueReport(id: string): IssueReport | undefined {
    return this.reports.get(id);
  }

  getIssueNotification(id: string): IssueNotification | undefined {
    return this.notifications.get(id);
  }

  getAllIssues(): Issue[] {
    return Array.from(this.issues.values());
  }

  getAllIssueFilters(): IssueFilter[] {
    return Array.from(this.filters.values());
  }

  getAllIssueWorkflows(): IssueWorkflow[] {
    return Array.from(this.workflows.values());
  }

  getAllIssueBoards(): IssueBoard[] {
    return Array.from(this.boards.values());
  }

  getAllIssueSprints(): IssueSprint[] {
    return Array.from(this.sprints.values());
  }

  getAllIssueReports(): IssueReport[] {
    return Array.from(this.reports.values());
  }

  getAllIssueNotifications(): IssueNotification[] {
    return Array.from(this.notifications.values());
  }

  updateIssue(id: string, updates: Partial<Issue>): boolean {
    const issue = this.issues.get(id);
    if (!issue) return false;

    Object.assign(issue, updates);
    issue.updated = new Date();
    return true;
  }

  deleteIssue(id: string): boolean {
    return this.issues.delete(id);
  }

  exportIssueTrackingConfiguration(): Record<string, unknown> {
    return {
      issues: Array.from(this.issues.values()),
      filters: Array.from(this.filters.values()),
      workflows: Array.from(this.workflows.values()),
      boards: Array.from(this.boards.values()),
      sprints: Array.from(this.sprints.values()),
      reports: Array.from(this.reports.values()),
      notifications: Array.from(this.notifications.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface TransitionResult {
  success: boolean;
  error?: string;
  issueId?: string;
  fromStatus?: string;
  toStatus?: string;
  valid?: boolean;
  errors?: string[];
  transitionTime?: number;
}

interface AssignmentResult {
  success: boolean;
  error?: string;
  issueId?: string;
  assignee?: string;
  previousAssignee?: string;
  assignedBy?: string;
  assignmentTime?: number;
}

interface CommentResult {
  success: boolean;
  error?: string;
  issueId?: string;
  commentId?: string;
  author?: string;
  commentTime?: number;
}

interface SearchResult {
  success: boolean;
  error?: string;
  query?: IssueFilter['query'];
  results?: Issue[];
  total?: number;
  page?: number;
  pageSize?: number;
  sortBy?: IssueFilter['sortBy'];
  searchTime?: number;
}

interface BurndownResult {
  success: boolean;
  error?: string;
  sprintId?: string;
  burndown?: Array<{ date: Date; remaining: number }>;
  ideal?: Array<{ date: Date; remaining: number }>;
  remaining?: number;
  completed?: number;
  generationTime?: number;
}

interface ReportResult {
  success: boolean;
  error?: string;
  reportId?: string;
  data?: Array<Record<string, unknown>>;
  chart?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  generatedAt?: Date;
  generationTime?: number;
}

export const issueTrackingManager = new IssueTrackingManager();