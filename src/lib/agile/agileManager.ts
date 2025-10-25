export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee?: string;
  storyPoints?: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  dueDate?: Date;
  dependencies: string[];
  subtasks: SubTask[];
}

export interface SubTask {
  id: string;
  title: string;
  completed: boolean;
  assignee?: string;
}

export interface Sprint {
  id: string;
  name: string;
  goal: string;
  startDate: Date;
  endDate: Date;
  status: 'planned' | 'active' | 'completed' | 'cancelled';
  tasks: string[]; // Task IDs
  velocity?: number;
  burndownData: BurndownPoint[];
}

export interface BurndownPoint {
  date: Date;
  remainingPoints: number;
  idealPoints: number;
}

export interface KanbanBoard {
  id: string;
  name: string;
  columns: KanbanColumn[];
  wipLimits: Record<string, number>; // columnId -> limit
}

export interface KanbanColumn {
  id: string;
  name: string;
  taskIds: string[];
  color?: string;
}

export interface GanttChart {
  id: string;
  name: string;
  tasks: GanttTask[];
  dependencies: GanttDependency[];
  milestones: Milestone[];
}

export interface GanttTask {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  progress: number; // 0-100
  assignee?: string;
  color?: string;
}

export interface GanttDependency {
  from: string; // task id
  to: string; // task id
  type: 'finish-to-start' | 'start-to-start' | 'finish-to-finish' | 'start-to-finish';
}

export interface Milestone {
  id: string;
  name: string;
  date: Date;
  completed: boolean;
}

export interface AgileMetrics {
  velocity: number;
  burndownTrend: 'improving' | 'stable' | 'declining';
  cycleTime: number;
  throughput: number;
  leadTime: number;
  workInProgress: number;
}

export class AgileManager {
  private tasks: Map<string, Task> = new Map();
  private sprints: Map<string, Sprint> = new Map();
  private boards: Map<string, KanbanBoard> = new Map();
  private ganttCharts: Map<string, GanttChart> = new Map();

  constructor() {}

  // Task Management
  createTask(taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const task: Task = {
      ...taskData,
      id: `task-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.tasks.set(task.id, task);
    return task;
  }

  updateTask(taskId: string, updates: Partial<Task>): Task | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const updatedTask = { ...task, ...updates, updatedAt: new Date() };
    this.tasks.set(taskId, updatedTask);
    return updatedTask;
  }

  deleteTask(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  getTasksByStatus(status: Task['status']): Task[] {
    return this.getAllTasks().filter(task => task.status === status);
  }

  getTasksByAssignee(assignee: string): Task[] {
    return this.getAllTasks().filter(task => task.assignee === assignee);
  }

  // Sprint Management
  createSprint(sprintData: Omit<Sprint, 'id' | 'burndownData'>): Sprint {
    const sprint: Sprint = {
      ...sprintData,
      id: `sprint-${Date.now()}`,
      burndownData: []
    };

    this.sprints.set(sprint.id, sprint);
    return sprint;
  }

  startSprint(sprintId: string): boolean {
    const sprint = this.sprints.get(sprintId);
    if (!sprint || sprint.status !== 'planned') return false;

    sprint.status = 'active';
    this.updateBurndownData(sprintId);
    return true;
  }

  completeSprint(sprintId: string): boolean {
    const sprint = this.sprints.get(sprintId);
    if (!sprint || sprint.status !== 'active') return false;

    sprint.status = 'completed';
    sprint.velocity = this.calculateVelocity(sprintId);
    return true;
  }

  updateBurndownData(sprintId: string): void {
    const sprint = this.sprints.get(sprintId);
    if (!sprint) return;

    const remainingPoints = this.calculateRemainingPoints(sprint.tasks);
    const totalDays = Math.ceil((sprint.endDate.getTime() - sprint.startDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysElapsed = Math.ceil((new Date().getTime() - sprint.startDate.getTime()) / (1000 * 60 * 60 * 24));
    const idealPoints = (totalDays - daysElapsed) * (this.getTotalStoryPoints(sprint.tasks) / totalDays);

    sprint.burndownData.push({
      date: new Date(),
      remainingPoints,
      idealPoints: Math.max(0, idealPoints)
    });
  }

  private calculateRemainingPoints(taskIds: string[]): number {
    return taskIds.reduce((total, taskId) => {
      const task = this.tasks.get(taskId);
      if (task && task.status !== 'done') {
        return total + (task.storyPoints || 0);
      }
      return total;
    }, 0);
  }

  private getTotalStoryPoints(taskIds: string[]): number {
    return taskIds.reduce((total, taskId) => {
      const task = this.tasks.get(taskId);
      return total + (task?.storyPoints || 0);
    }, 0);
  }

  private calculateVelocity(sprintId: string): number {
    const sprint = this.sprints.get(sprintId);
    if (!sprint) return 0;

    const completedTasks = sprint.tasks.filter(taskId => {
      const task = this.tasks.get(taskId);
      return task?.status === 'done';
    });

    return completedTasks.reduce((total, taskId) => {
      const task = this.tasks.get(taskId);
      return total + (task?.storyPoints || 0);
    }, 0);
  }

  // Kanban Board Management
  createKanbanBoard(boardData: Omit<KanbanBoard, 'id'>): KanbanBoard {
    const board: KanbanBoard = {
      ...boardData,
      id: `board-${Date.now()}`
    };

    this.boards.set(board.id, board);
    return board;
  }

  addTaskToColumn(boardId: string, columnId: string, taskId: string): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    const column = board.columns.find(col => col.id === columnId);
    if (!column) return false;

    // Check WIP limit
    const wipLimit = board.wipLimits[columnId];
    if (wipLimit && column.taskIds.length >= wipLimit) {
      return false; // WIP limit exceeded
    }

    column.taskIds.push(taskId);
    return true;
  }

  moveTask(boardId: string, taskId: string, fromColumnId: string, toColumnId: string): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    const fromColumn = board.columns.find(col => col.id === fromColumnId);
    const toColumn = board.columns.find(col => col.id === toColumnId);

    if (!fromColumn || !toColumn) return false;

    // Check WIP limit for target column
    const wipLimit = board.wipLimits[toColumnId];
    if (wipLimit && toColumn.taskIds.length >= wipLimit) {
      return false; // WIP limit exceeded
    }

    // Remove from source column
    const taskIndex = fromColumn.taskIds.indexOf(taskId);
    if (taskIndex === -1) return false;
    fromColumn.taskIds.splice(taskIndex, 1);

    // Add to target column
    toColumn.taskIds.push(taskId);

    // Update task status based on column
    this.updateTaskStatusFromColumn(taskId, toColumnId);

    return true;
  }

  private updateTaskStatusFromColumn(taskId: string, columnId: string): void {
    const statusMap: Record<string, Task['status']> = {
      'todo': 'todo',
      'in-progress': 'in-progress',
      'done': 'done'
    };

    const status = statusMap[columnId];
    if (status) {
      this.updateTask(taskId, { status });
    }
  }

  // Gantt Chart Management
  createGanttChart(chartData: Omit<GanttChart, 'id'>): GanttChart {
    const chart: GanttChart = {
      ...chartData,
      id: `gantt-${Date.now()}`
    };

    this.ganttCharts.set(chart.id, chart);
    return chart;
  }

  updateTaskProgress(chartId: string, taskId: string, progress: number): boolean {
    const chart = this.ganttCharts.get(chartId);
    if (!chart) return false;

    const task = chart.tasks.find(t => t.id === taskId);
    if (!task) return false;

    task.progress = Math.max(0, Math.min(100, progress));
    return true;
  }

  addDependency(chartId: string, dependency: GanttDependency): boolean {
    const chart = this.ganttCharts.get(chartId);
    if (!chart) return false;

    // Check for circular dependencies
    if (this.hasCircularDependency(chart, dependency)) {
      return false;
    }

    chart.dependencies.push(dependency);
    return true;
  }

  private hasCircularDependency(chart: GanttChart, newDependency: GanttDependency): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = (taskId: string): boolean => {
      if (recursionStack.has(taskId)) return true;
      if (visited.has(taskId)) return false;

      visited.add(taskId);
      recursionStack.add(taskId);

      const dependencies = chart.dependencies.filter(dep => dep.from === taskId);
      for (const dep of dependencies) {
        if (hasCycle(dep.to)) return true;
      }

      recursionStack.delete(taskId);
      return false;
    };

    return hasCycle(newDependency.from);
  }

  // Metrics and Analytics
  calculateMetrics(sprintIds: string[]): AgileMetrics {
    const sprints = sprintIds.map(id => this.sprints.get(id)).filter(Boolean) as Sprint[];
    const completedSprints = sprints.filter(s => s.status === 'completed');

    const velocity = completedSprints.length > 0
      ? completedSprints.reduce((sum, sprint) => sum + (sprint.velocity || 0), 0) / completedSprints.length
      : 0;

    const allTasks = this.getAllTasks();
    const completedTasks = allTasks.filter(task => task.status === 'done');
    const inProgressTasks = allTasks.filter(task => task.status === 'in-progress');

    const cycleTime = completedTasks.length > 0
      ? completedTasks.reduce((sum, task) => {
          const cycleTime = task.updatedAt.getTime() - task.createdAt.getTime();
          return sum + cycleTime;
        }, 0) / completedTasks.length / (1000 * 60 * 60 * 24) // Convert to days
      : 0;

    const throughput = completedTasks.length / 30; // Tasks per month (rough estimate)
    const leadTime = cycleTime; // Simplified
    const workInProgress = inProgressTasks.length;

    // Calculate burndown trend
    let burndownTrend: 'improving' | 'stable' | 'declining' = 'stable';
    if (completedSprints.length >= 2) {
      const recentVelocities = completedSprints.slice(-3).map(s => s.velocity || 0);
      const avgRecent = recentVelocities.reduce((a, b) => a + b, 0) / recentVelocities.length;
      const avgEarlier = completedSprints.slice(0, -3).length > 0
        ? completedSprints.slice(0, -3).reduce((sum, s) => sum + (s.velocity || 0), 0) / completedSprints.slice(0, -3).length
        : avgRecent;

      if (avgRecent > avgEarlier * 1.1) burndownTrend = 'improving';
      else if (avgRecent < avgEarlier * 0.9) burndownTrend = 'declining';
    }

    return {
      velocity,
      burndownTrend,
      cycleTime,
      throughput,
      leadTime,
      workInProgress
    };
  }

  // Getters
  getSprint(sprintId: string): Sprint | undefined {
    return this.sprints.get(sprintId);
  }

  getAllSprints(): Sprint[] {
    return Array.from(this.sprints.values());
  }

  getKanbanBoard(boardId: string): KanbanBoard | undefined {
    return this.boards.get(boardId);
  }

  getAllBoards(): KanbanBoard[] {
    return Array.from(this.boards.values());
  }

  getGanttChart(chartId: string): GanttChart | undefined {
    return this.ganttCharts.get(chartId);
  }

  getAllGanttCharts(): GanttChart[] {
    return Array.from(this.ganttCharts.values());
  }
}

export const agileManager = new AgileManager();