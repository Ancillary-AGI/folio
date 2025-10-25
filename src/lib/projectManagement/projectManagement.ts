import { Component } from '../../types';

export interface Project {
  id: string;
  name: string;
  description: string;
  type: 'circuit_design' | 'mechanical_design' | 'system_design' | 'embedded_system' | 'iot_solution' | 'robotics' | 'automation';
  status: 'planning' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  owner: string;
  team: Array<{
    userId: string;
    role: 'owner' | 'lead' | 'developer' | 'reviewer' | 'viewer';
    permissions: string[];
    joinedAt: Date;
  }>;
  timeline: {
    startDate: Date;
    endDate?: Date;
    plannedEndDate: Date;
    milestones: Array<{
      id: string;
      name: string;
      description: string;
      dueDate: Date;
      completed: boolean;
      deliverables: string[];
    }>;
  };
  budget?: {
    allocated: number;
    spent: number;
    currency: string;
    categories: Record<string, number>;
  };
  requirements: Array<{
    id: string;
    title: string;
    description: string;
    type: 'functional' | 'non_functional' | 'business' | 'technical' | 'compliance';
    priority: 'must_have' | 'should_have' | 'nice_to_have';
    status: 'draft' | 'approved' | 'implemented' | 'verified' | 'rejected';
    acceptanceCriteria: string[];
    dependencies: string[];
  }>;
  deliverables: Array<{
    id: string;
    name: string;
    type: 'document' | 'design' | 'code' | 'test' | 'prototype' | 'product';
    status: 'planned' | 'in_progress' | 'completed' | 'delivered';
    dueDate: Date;
    assignee?: string;
    reviewers: string[];
  }>;
  risks: Array<{
    id: string;
    description: string;
    probability: 'low' | 'medium' | 'high';
    impact: 'low' | 'medium' | 'high';
    mitigation: string;
    owner: string;
    status: 'open' | 'mitigated' | 'occurred';
  }>;
  issues: Array<{
    id: string;
    title: string;
    description: string;
    type: 'bug' | 'feature_request' | 'improvement' | 'question' | 'task';
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: 'open' | 'in_progress' | 'resolved' | 'closed';
    assignee?: string;
    reporter: string;
    createdAt: Date;
    updatedAt: Date;
    comments: Array<{
      id: string;
      author: string;
      content: string;
      timestamp: Date;
    }>;
  }>;
  communications: Array<{
    id: string;
    type: 'meeting' | 'email' | 'chat' | 'document' | 'presentation';
    title: string;
    participants: string[];
    date: Date;
    summary?: string;
    actionItems: Array<{
      description: string;
      assignee?: string;
      dueDate?: Date;
      completed: boolean;
    }>;
  }>;
  metadata: {
    created: Date;
    lastModified: Date;
    version: string;
    tags: string[];
    category: string;
  };
}

export interface AgileMethodology {
  id: string;
  name: string;
  type: 'scrum' | 'kanban' | 'xp' | 'lean' | 'hybrid';
  projectId: string;
  settings: {
    sprintDuration: number; // days
    workHoursPerDay: number;
    velocityUnit: string;
    estimationMethod: 'story_points' | 'hours' | 't_shirt_sizes';
    burndownChart: boolean;
    velocityTracking: boolean;
  };
  backlog: Array<{
    id: string;
    title: string;
    description: string;
    type: 'epic' | 'story' | 'task' | 'bug' | 'spike';
    priority: 'lowest' | 'low' | 'medium' | 'high' | 'highest';
    estimate?: number;
    status: 'backlog' | 'selected' | 'in_progress' | 'done';
    assignee?: string;
    sprintId?: string;
    epicId?: string;
    acceptanceCriteria: string[];
    dependencies: string[];
    createdAt: Date;
    updatedAt: Date;
  }>;
  sprints: Array<{
    id: string;
    name: string;
    goal: string;
    startDate: Date;
    endDate: Date;
    status: 'planned' | 'active' | 'completed' | 'cancelled';
    capacity: number;
    committedItems: string[]; // backlog item IDs
    completedItems: string[];
    burndownData: Array<{
      date: Date;
      remainingWork: number;
      idealWork: number;
    }>;
    retrospective: {
      whatWentWell: string[];
      whatCouldBeImproved: string[];
      actionItems: string[];
    };
  }>;
  board: {
    columns: Array<{
      id: string;
      name: string;
      wipLimit?: number;
      status: string;
    }>;
    swimlanes: Array<{
      id: string;
      name: string;
      type: 'assignee' | 'epic' | 'priority' | 'custom';
    }>;
  };
  metrics: {
    velocity: number[];
    burndownEfficiency: number;
    cycleTime: number;
    leadTime: number;
    throughput: number;
  };
}

export interface KanbanBoard {
  id: string;
  name: string;
  projectId: string;
  columns: Array<{
    id: string;
    name: string;
    wipLimit?: number;
    color?: string;
    status: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
    policies: Array<{
      type: 'wip_limit' | 'definition_of_ready' | 'definition_of_done';
      condition: string;
      action: string;
    }>;
  }>;
  cards: Array<{
    id: string;
    title: string;
    description: string;
    type: 'task' | 'bug' | 'feature' | 'improvement' | 'research';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    size?: number;
    assignee?: string;
    labels: string[];
    dueDate?: Date;
    createdAt: Date;
    updatedAt: Date;
    columnId: string;
    position: number;
    blocked: boolean;
    blockedReason?: string;
    comments: Array<{
      id: string;
      author: string;
      content: string;
      timestamp: Date;
    }>;
    attachments: Array<{
      id: string;
      name: string;
      type: string;
      url: string;
      uploadedBy: string;
      uploadedAt: Date;
    }>;
  }>;
  swimlanes: Array<{
    id: string;
    name: string;
    type: 'assignee' | 'epic' | 'priority' | 'label';
    value: string;
  }>;
  workflows: Array<{
    id: string;
    name: string;
    trigger: string;
    conditions: string[];
    actions: string[];
  }>;
  analytics: {
    cycleTime: number;
    leadTime: number;
    throughput: number;
    wipDistribution: Record<string, number>;
    bottleneckAnalysis: Array<{
      column: string;
      averageTime: number;
      bottleneckScore: number;
    }>;
  };
}

export interface GanttChart {
  id: string;
  name: string;
  projectId: string;
  tasks: Array<{
    id: string;
    name: string;
    description: string;
    startDate: Date;
    endDate: Date;
    duration: number; // days
    progress: number; // 0-100
    priority: 'low' | 'medium' | 'high' | 'critical';
    type: 'task' | 'milestone' | 'summary' | 'project';
    assignee?: string;
    predecessors: string[]; // task IDs
    successors: string[]; // task IDs
    resources: Array<{
      id: string;
      name: string;
      type: 'human' | 'equipment' | 'material';
      allocation: number; // percentage or units
    }>;
    constraints: Array<{
      type: 'start_no_earlier_than' | 'finish_no_later_than' | 'as_soon_as_possible' | 'as_late_as_possible';
      date?: Date;
      task?: string;
    }>;
    baseline: {
      startDate: Date;
      endDate: Date;
      duration: number;
    };
    actual: {
      startDate?: Date;
      endDate?: Date;
      duration?: number;
    };
  }>;
  dependencies: Array<{
    id: string;
    fromTask: string;
    toTask: string;
    type: 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';
    lag: number; // days
  }>;
  resources: Array<{
    id: string;
    name: string;
    type: 'human' | 'equipment' | 'material';
    capacity: number;
    cost: number;
    availability: Array<{
      startDate: Date;
      endDate: Date;
      available: number;
    }>;
    assignments: string[]; // task IDs
  }>;
  milestones: Array<{
    id: string;
    name: string;
    date: Date;
    completed: boolean;
    deliverables: string[];
  }>;
  criticalPath: string[]; // task IDs
  slack: Record<string, number>; // task ID -> slack days
  view: {
    startDate: Date;
    endDate: Date;
    zoom: 'day' | 'week' | 'month' | 'quarter';
    showDependencies: boolean;
    showResources: boolean;
    showProgress: boolean;
    showBaseline: boolean;
  };
  analytics: {
    projectDuration: number;
    criticalPathLength: number;
    resourceUtilization: number;
    scheduleVariance: number;
    costVariance: number;
  };
}

export interface ResourceAllocation {
  id: string;
  name: string;
  projectId: string;
  resources: Array<{
    id: string;
    name: string;
    type: 'human' | 'equipment' | 'material' | 'budget';
    category: string;
    capacity: number;
    cost: number;
    availability: {
      schedule: Array<{
        startDate: Date;
        endDate: Date;
        available: number;
      }>;
      constraints: string[];
    };
    skills?: string[];
    location?: string;
  }>;
  allocations: Array<{
    id: string;
    resourceId: string;
    taskId: string;
    startDate: Date;
    endDate: Date;
    allocation: number; // percentage or units
    cost: number;
    status: 'planned' | 'confirmed' | 'active' | 'completed';
  }>;
  leveling: {
    enabled: boolean;
    method: 'manual' | 'automatic' | 'priority_based';
    constraints: Array<{
      type: 'max_overallocation' | 'skill_requirement' | 'location_constraint';
      value: number | string;
    }>;
    conflicts: Array<{
      id: string;
      resourceId: string;
      taskIds: string[];
      severity: 'low' | 'medium' | 'high';
      resolution?: string;
    }>;
  };
  optimization: {
    objective: 'minimize_cost' | 'minimize_duration' | 'maximize_utilization' | 'balance_workload';
    constraints: string[];
    algorithm: 'linear_programming' | 'genetic_algorithm' | 'simulated_annealing';
    results: {
      optimizedSchedule: boolean;
      costSavings: number;
      durationReduction: number;
      utilizationImprovement: number;
    };
  };
  analytics: {
    utilization: Record<string, number>; // resource ID -> utilization %
    overallocation: Record<string, number>; // resource ID -> overallocation %
    costEfficiency: number;
    scheduleEfficiency: number;
  };
}

export interface RiskManagement {
  id: string;
  name: string;
  projectId: string;
  riskRegister: Array<{
    id: string;
    title: string;
    description: string;
    category: 'technical' | 'schedule' | 'cost' | 'quality' | 'external' | 'organizational';
    probability: number; // 0-1
    impact: number; // 0-1
    riskScore: number; // probability * impact
    priority: 'low' | 'medium' | 'high' | 'critical';
    status: 'identified' | 'assessed' | 'mitigated' | 'occurred' | 'closed';
    owner: string;
    detectionDate: Date;
    targetDate?: Date;
    triggers: string[];
    consequences: string[];
    mitigation: {
      strategy: 'avoid' | 'mitigate' | 'transfer' | 'accept';
      actions: Array<{
        description: string;
        owner: string;
        dueDate: Date;
        status: 'planned' | 'in_progress' | 'completed';
        effectiveness: number;
      }>;
      contingency: string;
      cost: number;
    };
    monitoring: {
      indicators: string[];
      frequency: 'daily' | 'weekly' | 'monthly';
      responsible: string;
      lastReview: Date;
      nextReview: Date;
    };
  }>;
  riskMatrix: {
    probabilityLevels: Array<{
      level: string;
      range: [number, number];
      description: string;
    }>;
    impactLevels: Array<{
      level: string;
      range: [number, number];
      description: string;
    }>;
    zones: Array<{
      name: string;
      color: string;
      action: string;
      probabilityRange: [number, number];
      impactRange: [number, number];
    }>;
  };
  riskResponse: {
    strategies: Record<string, {
      description: string;
      applicability: string[];
      advantages: string[];
      disadvantages: string[];
    }>;
    templates: Record<string, {
      triggers: string[];
      actions: string[];
      responsibilities: string[];
    }>;
  };
  analytics: {
    totalRisks: number;
    highPriorityRisks: number;
    mitigatedRisks: number;
    riskBurndown: Array<{
      date: Date;
      totalRisks: number;
      highRisks: number;
      mitigatedRisks: number;
    }>;
    riskDistribution: Record<string, number>; // category -> count
    riskTrend: 'improving' | 'stable' | 'worsening';
  };
}

export interface TimeTracking {
  id: string;
  name: string;
  projectId: string;
  entries: Array<{
    id: string;
    userId: string;
    taskId: string;
    description: string;
    startTime: Date;
    endTime?: Date;
    duration: number; // minutes
    billable: boolean;
    category: 'development' | 'design' | 'testing' | 'meeting' | 'documentation' | 'research' | 'other';
    tags: string[];
    location?: string;
    interruptions: Array<{
      startTime: Date;
      endTime: Date;
      reason: string;
    }>;
  }>;
  budgets: Array<{
    id: string;
    name: string;
    allocatedHours: number;
    spentHours: number;
    category: string;
    startDate: Date;
    endDate: Date;
  }>;
  reports: {
    daily: Record<string, {
      userId: string;
      totalHours: number;
      billableHours: number;
      tasks: string[];
    }>;
    weekly: Record<string, {
      weekStart: Date;
      totalHours: number;
      billableHours: number;
      productivity: number;
      overtime: number;
    }>;
    monthly: Record<string, {
      month: string;
      totalHours: number;
      billableHours: number;
      budgetUtilization: number;
      forecastAccuracy: number;
    }>;
  };
  analytics: {
    productivity: number;
    utilization: number;
    overtime: number;
    budgetVariance: number;
    forecasting: {
      accuracy: number;
      confidence: number;
    };
  };
}

export interface ExpenseManagement {
  id: string;
  name: string;
  projectId: string;
  budget: {
    total: number;
    allocated: Record<string, number>; // category -> amount
    spent: Record<string, number>;
    remaining: Record<string, number>;
    currency: string;
  };
  expenses: Array<{
    id: string;
    description: string;
    amount: number;
    currency: string;
    category: 'labor' | 'materials' | 'equipment' | 'software' | 'travel' | 'training' | 'other';
    type: 'planned' | 'actual' | 'forecast';
    date: Date;
    vendor?: string;
    invoice?: string;
    approved: boolean;
    approvedBy?: string;
    approvedAt?: Date;
    reimbursed: boolean;
    reimbursedAt?: Date;
    attachments: Array<{
      id: string;
      name: string;
      type: string;
      url: string;
    }>;
    tags: string[];
  }>;
  approvals: {
    workflow: Array<{
      step: string;
      approver: string;
      condition: string;
      required: boolean;
    }>;
    pending: Array<{
      expenseId: string;
      currentStep: string;
      submittedAt: Date;
    }>;
    history: Array<{
      expenseId: string;
      action: 'approved' | 'rejected' | 'modified';
      actor: string;
      timestamp: Date;
      comments?: string;
    }>;
  };
  forecasting: {
    method: 'linear' | 'exponential' | 'moving_average' | 'regression';
    parameters: Record<string, unknown>;
    predictions: Array<{
      category: string;
      predictedAmount: number;
      confidence: number;
      date: Date;
    }>;
  };
  analytics: {
    burnRate: number;
    budgetUtilization: number;
    costVariance: number;
    forecastAccuracy: number;
    categoryBreakdown: Record<string, number>;
  };
}

export class ProjectManagementManager {
  private projects: Map<string, Project> = new Map();
  private agileMethodologies: Map<string, AgileMethodology> = new Map();
  private kanbanBoards: Map<string, KanbanBoard> = new Map();
  private ganttCharts: Map<string, GanttChart> = new Map();
  private resourceAllocations: Map<string, ResourceAllocation> = new Map();
  private riskManagement: Map<string, RiskManagement> = new Map();
  private timeTracking: Map<string, TimeTracking> = new Map();
  private expenseManagement: Map<string, ExpenseManagement> = new Map();

  createProject(project: Omit<Project, 'id' | 'metadata'>): Project {
    const newProject: Project = {
      ...project,
      id: `proj_${Date.now()}`,
      metadata: {
        created: new Date(),
        lastModified: new Date(),
        version: '1.0.0',
        tags: [],
        category: 'engineering'
      }
    };

    this.projects.set(newProject.id, newProject);
    return newProject;
  }

  createAgileMethodology(methodology: Omit<AgileMethodology, 'id'>): AgileMethodology {
    const agileMethodology: AgileMethodology = {
      ...methodology,
      id: `agile_${Date.now()}`
    };

    this.agileMethodologies.set(agileMethodology.id, agileMethodology);
    return agileMethodology;
  }

  createKanbanBoard(board: Omit<KanbanBoard, 'id' | 'analytics'>): KanbanBoard {
    const kanbanBoard: KanbanBoard = {
      ...board,
      id: `kanban_${Date.now()}`,
      analytics: {
        cycleTime: 0,
        leadTime: 0,
        throughput: 0,
        wipDistribution: {},
        bottleneckAnalysis: []
      }
    };

    this.kanbanBoards.set(kanbanBoard.id, kanbanBoard);
    return kanbanBoard;
  }

  createGanttChart(chart: Omit<GanttChart, 'id' | 'criticalPath' | 'slack' | 'analytics'>): GanttChart {
    const ganttChart: GanttChart = {
      ...chart,
      id: `gantt_${Date.now()}`,
      criticalPath: [],
      slack: {},
      analytics: {
        projectDuration: 0,
        criticalPathLength: 0,
        resourceUtilization: 0,
        scheduleVariance: 0,
        costVariance: 0
      }
    };

    this.ganttCharts.set(ganttChart.id, ganttChart);
    return ganttChart;
  }

  createResourceAllocation(allocation: Omit<ResourceAllocation, 'id' | 'analytics'>): ResourceAllocation {
    const resourceAllocation: ResourceAllocation = {
      ...allocation,
      id: `res_alloc_${Date.now()}`,
      analytics: {
        utilization: {},
        overallocation: {},
        costEfficiency: 0,
        scheduleEfficiency: 0
      }
    };

    this.resourceAllocations.set(resourceAllocation.id, resourceAllocation);
    return resourceAllocation;
  }

  createRiskManagement(riskMgmt: Omit<RiskManagement, 'id' | 'analytics'>): RiskManagement {
    const riskManagement: RiskManagement = {
      ...riskMgmt,
      id: `risk_${Date.now()}`,
      analytics: {
        totalRisks: 0,
        highPriorityRisks: 0,
        mitigatedRisks: 0,
        riskBurndown: [],
        riskDistribution: {},
        riskTrend: 'stable'
      }
    };

    this.riskManagement.set(riskManagement.id, riskManagement);
    return riskManagement;
  }

  createTimeTracking(tracking: Omit<TimeTracking, 'id' | 'reports' | 'analytics'>): TimeTracking {
    const timeTracking: TimeTracking = {
      ...tracking,
      id: `time_${Date.now()}`,
      reports: {
        daily: {},
        weekly: {},
        monthly: {}
      },
      analytics: {
        productivity: 0,
        utilization: 0,
        overtime: 0,
        budgetVariance: 0,
        forecasting: {
          accuracy: 0,
          confidence: 0
        }
      }
    };

    this.timeTracking.set(timeTracking.id, timeTracking);
    return timeTracking;
  }

  createExpenseManagement(expenseMgmt: Omit<ExpenseManagement, 'id' | 'analytics'>): ExpenseManagement {
    const expenseManagement: ExpenseManagement = {
      ...expenseMgmt,
      id: `expense_${Date.now()}`,
      analytics: {
        burnRate: 0,
        budgetUtilization: 0,
        costVariance: 0,
        forecastAccuracy: 0,
        categoryBreakdown: {}
      }
    };

    this.expenseManagement.set(expenseManagement.id, expenseManagement);
    return expenseManagement;
  }

  addTeamMember(projectId: string, userId: string, role: Project['team'][0]['role'], permissions: string[]): boolean {
    const project = this.projects.get(projectId);
    if (!project) return false;

    // Check if user is already in team
    const existingMember = project.team.find(member => member.userId === userId);
    if (existingMember) {
      existingMember.role = role;
      existingMember.permissions = permissions;
      return true;
    }

    project.team.push({
      userId,
      role,
      permissions,
      joinedAt: new Date()
    });

    project.metadata.lastModified = new Date();
    return true;
  }

  createSprint(agileId: string, sprint: Omit<AgileMethodology['sprints'][0], 'id' | 'burndownData' | 'retrospective'>): boolean {
    const methodology = this.agileMethodologies.get(agileId);
    if (!methodology) return false;

    const newSprint: AgileMethodology['sprints'][0] = {
      ...sprint,
      id: `sprint_${Date.now()}`,
      burndownData: [],
      retrospective: {
        whatWentWell: [],
        whatCouldBeImproved: [],
        actionItems: []
      }
    };

    methodology.sprints.push(newSprint);
    return true;
  }

  addBacklogItem(agileId: string, item: Omit<AgileMethodology['backlog'][0], 'id' | 'createdAt' | 'updatedAt'>): boolean {
    const methodology = this.agileMethodologies.get(agileId);
    if (!methodology) return false;

    const newItem: AgileMethodology['backlog'][0] = {
      ...item,
      id: `item_${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    methodology.backlog.push(newItem);
    return true;
  }

  moveKanbanCard(boardId: string, cardId: string, targetColumnId: string, position?: number): boolean {
    const board = this.kanbanBoards.get(boardId);
    if (!board) return false;

    const card = board.cards.find(c => c.id === cardId);
    if (!card) return false;

    const targetColumn = board.columns.find(c => c.id === targetColumnId);
    if (!targetColumn) return false;

    card.columnId = targetColumnId;
    card.position = position || 0;
    card.updatedAt = new Date();

    return true;
  }

  addGanttTask(chartId: string, task: Omit<GanttChart['tasks'][0], 'id' | 'baseline' | 'actual'>): boolean {
    const chart = this.ganttCharts.get(chartId);
    if (!chart) return false;

    const newTask: GanttChart['tasks'][0] = {
      ...task,
      id: `task_${Date.now()}`,
      baseline: {
        startDate: task.startDate,
        endDate: task.endDate,
        duration: task.duration
      },
      actual: {}
    };

    chart.tasks.push(newTask);
    return true;
  }

  allocateResource(allocationId: string, resourceId: string, taskId: string, allocation: Omit<ResourceAllocation['allocations'][0], 'id'>): boolean {
    const resourceAlloc = this.resourceAllocations.get(allocationId);
    if (!resourceAlloc) return false;

    const newAllocation: ResourceAllocation['allocations'][0] = {
      ...allocation,
      id: `alloc_${Date.now()}`,
      resourceId,
      taskId
    };

    resourceAlloc.allocations.push(newAllocation);
    return true;
  }

  addRisk(riskMgmtId: string, risk: Omit<RiskManagement['riskRegister'][0], 'id' | 'riskScore' | 'detectionDate'>): boolean {
    const riskManagement = this.riskManagement.get(riskMgmtId);
    if (!riskManagement) return false;

    const newRisk: RiskManagement['riskRegister'][0] = {
      ...risk,
      id: `risk_${Date.now()}`,
      riskScore: risk.probability * risk.impact,
      detectionDate: new Date()
    };

    riskManagement.riskRegister.push(newRisk);
    return true;
  }

  logTimeEntry(trackingId: string, entry: Omit<TimeTracking['entries'][0], 'id'>): boolean {
    const timeTracking = this.timeTracking.get(trackingId);
    if (!timeTracking) return false;

    const newEntry: TimeTracking['entries'][0] = {
      ...entry,
      id: `entry_${Date.now()}`
    };

    timeTracking.entries.push(newEntry);
    return true;
  }

  submitExpense(expenseMgmtId: string, expense: Omit<ExpenseManagement['expenses'][0], 'id'>): boolean {
    const expenseManagement = this.expenseManagement.get(expenseMgmtId);
    if (!expenseManagement) return false;

    const newExpense: ExpenseManagement['expenses'][0] = {
      ...expense,
      id: `expense_${Date.now()}`
    };

    expenseManagement.expenses.push(newExpense);
    return true;
  }

  calculateCriticalPath(chartId: string): string[] {
    const chart = this.ganttCharts.get(chartId);
    if (!chart) return [];

    // Simplified critical path calculation
    const criticalPath: string[] = [];
    const taskMap = new Map(chart.tasks.map(t => [t.id, t]));

    // Find tasks with no predecessors (start tasks)
    const startTasks = chart.tasks.filter(task =>
      task.predecessors.length === 0
    );

    // Simple forward pass to find longest path
    const taskDurations = new Map<string, number>();

    const calculateDuration = (taskId: string): number => {
      if (taskDurations.has(taskId)) {
        return taskDurations.get(taskId)!;
      }

      const task = taskMap.get(taskId);
      if (!task) return 0;

      const predDurations = task.predecessors.map(predId => calculateDuration(predId));
      const maxPredDuration = predDurations.length > 0 ? Math.max(...predDurations) : 0;
      const duration = maxPredDuration + task.duration;

      taskDurations.set(taskId, duration);
      return duration;
    };

    // Calculate all task durations
    chart.tasks.forEach(task => calculateDuration(task.id));

    // Find the path with maximum duration
    let maxDuration = 0;
    let endTaskId = '';

    taskDurations.forEach((duration, taskId) => {
      if (duration > maxDuration) {
        maxDuration = duration;
        endTaskId = taskId;
      }
    });

    // Backtrack to find critical path
    if (endTaskId) {
      let currentTaskId = endTaskId;
      while (currentTaskId) {
        criticalPath.unshift(currentTaskId);
        const currentTask = taskMap.get(currentTaskId);
        if (!currentTask || currentTask.predecessors.length === 0) break;

        // Find predecessor with maximum duration
        let maxPredDuration = 0;
        let nextTaskId = '';
        currentTask.predecessors.forEach(predId => {
          const predDuration = taskDurations.get(predId) || 0;
          if (predDuration > maxPredDuration) {
            maxPredDuration = predDuration;
            nextTaskId = predId;
          }
        });
        currentTaskId = nextTaskId;
      }
    }

    chart.criticalPath = criticalPath;
    return criticalPath;
  }

  optimizeResourceAllocation(allocationId: string): Promise<OptimizationResult> {
    return new Promise((resolve) => {
      const allocation = this.resourceAllocations.get(allocationId);
      if (!allocation) {
        resolve({ success: false, error: 'Resource allocation not found' });
        return;
      }

      // Simulate optimization
      setTimeout(() => {
        const result = this.performResourceOptimization(allocation);

        allocation.optimization.results = result.results;
        allocation.analytics = result.analytics;

        resolve({
          success: true,
          allocationId,
          optimizedSchedule: result.results.optimizedSchedule,
          costSavings: result.results.costSavings,
          durationReduction: result.results.durationReduction,
          utilizationImprovement: result.results.utilizationImprovement,
          conflictsResolved: result.conflictsResolved,
          optimizationTime: Date.now()
        });
      }, 2000 + Math.random() * 3000); // 2-5 seconds
    });
  }

  private performResourceOptimization(allocation: ResourceAllocation): {
    results: ResourceAllocation['optimization']['results'];
    analytics: ResourceAllocation['analytics'];
    conflictsResolved: number;
  } {
    // Simulate optimization results
    const results: ResourceAllocation['optimization']['results'] = {
      optimizedSchedule: Math.random() > 0.1, // 90% success rate
      costSavings: Math.random() * 0.15, // 0-15% savings
      durationReduction: Math.random() * 0.1, // 0-10% reduction
      utilizationImprovement: 0.05 + Math.random() * 0.15 // 5-20% improvement
    };

    const analytics: ResourceAllocation['analytics'] = {
      utilization: {},
      overallocation: {},
      costEfficiency: 0.85 + Math.random() * 0.1,
      scheduleEfficiency: 0.8 + Math.random() * 0.15
    };

    // Calculate utilization for each resource
    allocation.resources.forEach(resource => {
      analytics.utilization[resource.id] = 0.7 + Math.random() * 0.25; // 70-95%
      analytics.overallocation[resource.id] = Math.random() * 0.1; // 0-10%
    });

    const conflictsResolved = Math.floor(Math.random() * allocation.allocations.length * 0.3);

    return { results, analytics, conflictsResolved };
  }

  generateProjectReport(projectId: string, reportType: 'status' | 'financial' | 'risk' | 'resource' | 'timeline'): Promise<ReportResult> {
    return new Promise((resolve) => {
      const project = this.projects.get(projectId);
      if (!project) {
        resolve({ success: false, error: 'Project not found' });
        return;
      }

      // Simulate report generation
      setTimeout(() => {
        const report = this.generateReport(project, reportType);

        resolve({
          success: true,
          projectId,
          reportType,
          report,
          generatedAt: new Date(),
          generationTime: Date.now()
        });
      }, 1000 + Math.random() * 2000); // 1-3 seconds
    });
  }

  private generateReport(project: Project, reportType: string): Record<string, unknown> {
    switch (reportType) {
      case 'status':
        return {
          projectName: project.name,
          status: project.status,
          progress: this.calculateProjectProgress(project),
          milestones: project.timeline.milestones,
          issues: project.issues.filter(i => i.status !== 'closed').length,
          risks: project.risks.filter(r => r.status === 'open').length
        };
      case 'financial':
        return {
          budget: project.budget,
          expenses: this.calculateTotalExpenses(project.id),
          variance: this.calculateBudgetVariance(project),
          forecast: this.generateFinancialForecast(project)
        };
      case 'risk':
        return {
          totalRisks: project.risks.length,
          highRisks: project.risks.filter(r => r.priority === 'high').length,
          mitigatedRisks: project.risks.filter(r => r.status === 'mitigated').length,
          riskTrend: 'improving'
        };
      case 'resource':
        return {
          teamSize: project.team.length,
          utilization: this.calculateResourceUtilization(project.id),
          allocation: this.calculateResourceAllocation(project.id),
          bottlenecks: this.identifyResourceBottlenecks(project.id)
        };
      case 'timeline':
        return {
          startDate: project.timeline.startDate,
          endDate: project.timeline.endDate,
          progress: this.calculateTimelineProgress(project),
          criticalPath: this.getProjectCriticalPath(project.id),
          delays: this.identifyTimelineDelays(project)
        };
      default:
        return {};
    }
  }

  private calculateProjectProgress(project: Project): number {
    const completedDeliverables = project.deliverables.filter(d => d.status === 'completed').length;
    return project.deliverables.length > 0 ? (completedDeliverables / project.deliverables.length) * 100 : 0;
  }

  private calculateTotalExpenses(projectId: string): number {
    const expenseMgmt = Array.from(this.expenseManagement.values()).find(e => e.projectId === projectId);
    return expenseMgmt ? expenseMgmt.expenses.reduce((sum, exp) => sum + exp.amount, 0) : 0;
  }

  private calculateBudgetVariance(project: Project): number {
    if (!project.budget) return 0;
    return ((project.budget.spent - project.budget.allocated) / project.budget.allocated) * 100;
  }

  private generateFinancialForecast(project: Project): Record<string, unknown> {
    // Simplified forecast
    return {
      projectedTotal: project.budget?.allocated || 0,
      projectedCompletion: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
      confidence: 0.8
    };
  }

  private calculateResourceUtilization(projectId: string): number {
    const allocation = Array.from(this.resourceAllocations.values()).find(a => a.projectId === projectId);
    if (!allocation) return 0;

    const utilizations = Object.values(allocation.analytics.utilization);
    return utilizations.length > 0 ? utilizations.reduce((sum, u) => sum + u, 0) / utilizations.length : 0;
  }

  private calculateResourceAllocation(projectId: string): Record<string, number> {
    const allocation = Array.from(this.resourceAllocations.values()).find(a => a.projectId === projectId);
    return allocation?.analytics.utilization || {};
  }

  private identifyResourceBottlenecks(projectId: string): string[] {
    // Simplified bottleneck identification
    return ['Senior Developer', 'Testing Equipment'];
  }

  private calculateTimelineProgress(project: Project): number {
    const now = new Date();
    const totalDuration = project.timeline.plannedEndDate.getTime() - project.timeline.startDate.getTime();
    const elapsed = now.getTime() - project.timeline.startDate.getTime();
    return Math.min((elapsed / totalDuration) * 100, 100);
  }

  private getProjectCriticalPath(projectId: string): string[] {
    const chart = Array.from(this.ganttCharts.values()).find(c => c.projectId === projectId);
    return chart?.criticalPath || [];
  }

  private identifyTimelineDelays(project: Project): Array<{ task: string; delay: number }> {
    // Simplified delay identification
    return [
      { task: 'Design Review', delay: 5 },
      { task: 'Testing Phase', delay: 3 }
    ];
  }

  getProject(id: string): Project | undefined {
    return this.projects.get(id);
  }

  getAgileMethodology(id: string): AgileMethodology | undefined {
    return this.agileMethodologies.get(id);
  }

  getKanbanBoard(id: string): KanbanBoard | undefined {
    return this.kanbanBoards.get(id);
  }

  getGanttChart(id: string): GanttChart | undefined {
    return this.ganttCharts.get(id);
  }

  getResourceAllocation(id: string): ResourceAllocation | undefined {
    return this.resourceAllocations.get(id);
  }

  getRiskManagement(id: string): RiskManagement | undefined {
    return this.riskManagement.get(id);
  }

  getTimeTracking(id: string): TimeTracking | undefined {
    return this.timeTracking.get(id);
  }

  getExpenseManagement(id: string): ExpenseManagement | undefined {
    return this.expenseManagement.get(id);
  }

  getAllProjects(): Project[] {
    return Array.from(this.projects.values());
  }

  getAllAgileMethodologies(): AgileMethodology[] {
    return Array.from(this.agileMethodologies.values());
  }

  getAllKanbanBoards(): KanbanBoard[] {
    return Array.from(this.kanbanBoards.values());
  }

  getAllGanttCharts(): GanttChart[] {
    return Array.from(this.ganttCharts.values());
  }

  getAllResourceAllocations(): ResourceAllocation[] {
    return Array.from(this.resourceAllocations.values());
  }

  getAllRiskManagement(): RiskManagement[] {
    return Array.from(this.riskManagement.values());
  }

  getAllTimeTracking(): TimeTracking[] {
    return Array.from(this.timeTracking.values());
  }

  getAllExpenseManagement(): ExpenseManagement[] {
    return Array.from(this.expenseManagement.values());
  }

  updateProject(id: string, updates: Partial<Project>): boolean {
    const project = this.projects.get(id);
    if (!project) return false;

    Object.assign(project, updates);
    project.metadata.lastModified = new Date();
    return true;
  }

  deleteProject(id: string): boolean {
    return this.projects.delete(id);
  }

  exportProjectManagementConfiguration(): Record<string, unknown> {
    return {
      projects: Array.from(this.projects.values()),
      agileMethodologies: Array.from(this.agileMethodologies.values()),
      kanbanBoards: Array.from(this.kanbanBoards.values()),
      ganttCharts: Array.from(this.ganttCharts.values()),
      resourceAllocations: Array.from(this.resourceAllocations.values()),
      riskManagement: Array.from(this.riskManagement.values()),
      timeTracking: Array.from(this.timeTracking.values()),
      expenseManagement: Array.from(this.expenseManagement.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface OptimizationResult {
  success: boolean;
  error?: string;
  allocationId?: string;
  optimizedSchedule?: boolean;
  costSavings?: number;
  durationReduction?: number;
  utilizationImprovement?: number;
  conflictsResolved?: number;
  optimizationTime?: number;
}

interface ReportResult {
  success: boolean;
  error?: string;
  projectId?: string;
  reportType?: string;
  report?: Record<string, unknown>;
  generatedAt?: Date;
  generationTime?: number;
}

export const projectManagementManager = new ProjectManagementManager();