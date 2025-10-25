export interface KanbanColumn {
  id: string;
  title: string;
  color: string;
  limit?: number;
  tasks: KanbanTask[];
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  assignee?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  labels: string[];
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  attachments: string[];
  comments: KanbanComment[];
  subtasks: KanbanSubtask[];
}

export interface KanbanComment {
  id: string;
  author: string;
  content: string;
  createdAt: Date;
  attachments?: string[];
}

export interface KanbanSubtask {
  id: string;
  title: string;
  completed: boolean;
  assignee?: string;
}

export interface KanbanBoard {
  id: string;
  name: string;
  description?: string;
  columns: KanbanColumn[];
  members: string[];
  createdAt: Date;
  updatedAt: Date;
  settings: KanbanBoardSettings;
}

export interface KanbanBoardSettings {
  allowTaskAssignment: boolean;
  allowComments: boolean;
  allowAttachments: boolean;
  allowSubtasks: boolean;
  showDueDates: boolean;
  showPriority: boolean;
  showAssignee: boolean;
  autoArchiveCompleted: boolean;
  archiveAfterDays: number;
}

export class KanbanBoardManager {
  private boards: Map<string, KanbanBoard> = new Map();

  createBoard(boardData: Omit<KanbanBoard, 'id' | 'createdAt' | 'updatedAt'>): KanbanBoard {
    const board: KanbanBoard = {
      id: `kanban-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...boardData
    };

    this.boards.set(board.id, board);
    return board;
  }

  getBoard(boardId: string): KanbanBoard | undefined {
    return this.boards.get(boardId);
  }

  updateBoard(boardId: string, updates: Partial<KanbanBoard>): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    Object.assign(board, updates);
    board.updatedAt = new Date();
    return true;
  }

  deleteBoard(boardId: string): boolean {
    return this.boards.delete(boardId);
  }

  addColumn(boardId: string, column: Omit<KanbanColumn, 'tasks'>): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    const newColumn: KanbanColumn = {
      ...column,
      tasks: []
    };

    board.columns.push(newColumn);
    board.updatedAt = new Date();
    return true;
  }

  updateColumn(boardId: string, columnId: string, updates: Partial<KanbanColumn>): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    const column = board.columns.find(col => col.id === columnId);
    if (!column) return false;

    Object.assign(column, updates);
    board.updatedAt = new Date();
    return true;
  }

  deleteColumn(boardId: string, columnId: string): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    const index = board.columns.findIndex(col => col.id === columnId);
    if (index === -1) return false;

    board.columns.splice(index, 1);
    board.updatedAt = new Date();
    return true;
  }

  addTask(boardId: string, columnId: string, task: Omit<KanbanTask, 'id' | 'createdAt' | 'updatedAt'>): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    const column = board.columns.find(col => col.id === columnId);
    if (!column) return false;

    // Check column limit
    if (column.limit && column.tasks.length >= column.limit) {
      return false;
    }

    const newTask: KanbanTask = {
      id: `task-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...task
    };

    column.tasks.push(newTask);
    board.updatedAt = new Date();
    return true;
  }

  updateTask(boardId: string, taskId: string, updates: Partial<KanbanTask>): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    for (const column of board.columns) {
      const task = column.tasks.find(t => t.id === taskId);
      if (task) {
        Object.assign(task, updates);
        task.updatedAt = new Date();
        board.updatedAt = new Date();
        return true;
      }
    }

    return false;
  }

  moveTask(boardId: string, taskId: string, fromColumnId: string, toColumnId: string, newIndex?: number): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    const fromColumn = board.columns.find(col => col.id === fromColumnId);
    const toColumn = board.columns.find(col => col.id === toColumnId);

    if (!fromColumn || !toColumn) return false;

    const taskIndex = fromColumn.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return false;

    const [task] = fromColumn.tasks.splice(taskIndex, 1);

    // Check target column limit
    if (toColumn.limit && toColumn.tasks.length >= toColumn.limit) {
      // Put task back
      fromColumn.tasks.splice(taskIndex, 0, task);
      return false;
    }

    // Insert at specific index or at end
    const insertIndex = newIndex !== undefined ? Math.min(newIndex, toColumn.tasks.length) : toColumn.tasks.length;
    toColumn.tasks.splice(insertIndex, 0, task);

    board.updatedAt = new Date();
    return true;
  }

  deleteTask(boardId: string, taskId: string): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    for (const column of board.columns) {
      const index = column.tasks.findIndex(t => t.id === taskId);
      if (index !== -1) {
        column.tasks.splice(index, 1);
        board.updatedAt = new Date();
        return true;
      }
    }

    return false;
  }

  addComment(boardId: string, taskId: string, comment: Omit<KanbanComment, 'id' | 'createdAt'>): boolean {
    const board = this.boards.get(boardId);
    if (!board || !board.settings.allowComments) return false;

    for (const column of board.columns) {
      const task = column.tasks.find(t => t.id === taskId);
      if (task) {
        const newComment: KanbanComment = {
          id: `comment-${Date.now()}`,
          createdAt: new Date(),
          ...comment
        };
        task.comments.push(newComment);
        task.updatedAt = new Date();
        board.updatedAt = new Date();
        return true;
      }
    }

    return false;
  }

  addSubtask(boardId: string, taskId: string, subtask: Omit<KanbanSubtask, 'id'>): boolean {
    const board = this.boards.get(boardId);
    if (!board || !board.settings.allowSubtasks) return false;

    for (const column of board.columns) {
      const task = column.tasks.find(t => t.id === taskId);
      if (task) {
        const newSubtask: KanbanSubtask = {
          id: `subtask-${Date.now()}`,
          ...subtask
        };
        task.subtasks.push(newSubtask);
        task.updatedAt = new Date();
        board.updatedAt = new Date();
        return true;
      }
    }

    return false;
  }

  updateSubtask(boardId: string, taskId: string, subtaskId: string, updates: Partial<KanbanSubtask>): boolean {
    const board = this.boards.get(boardId);
    if (!board) return false;

    for (const column of board.columns) {
      const task = column.tasks.find(t => t.id === taskId);
      if (task) {
        const subtask = task.subtasks.find(st => st.id === subtaskId);
        if (subtask) {
          Object.assign(subtask, updates);
          task.updatedAt = new Date();
          board.updatedAt = new Date();
          return true;
        }
      }
    }

    return false;
  }

  getBoardStats(boardId: string): {
    totalTasks: number;
    completedTasks: number;
    overdueTasks: number;
    tasksByPriority: Record<string, number>;
    tasksByAssignee: Record<string, number>;
  } | null {
    const board = this.boards.get(boardId);
    if (!board) return null;

    let totalTasks = 0;
    let completedTasks = 0;
    let overdueTasks = 0;
    const tasksByPriority: Record<string, number> = { low: 0, medium: 0, high: 0, urgent: 0 };
    const tasksByAssignee: Record<string, number> = {};

    const now = new Date();

    for (const column of board.columns) {
      for (const task of column.tasks) {
        totalTasks++;

        // Count by priority
        tasksByPriority[task.priority]++;

        // Count by assignee
        if (task.assignee) {
          tasksByAssignee[task.assignee] = (tasksByAssignee[task.assignee] || 0) + 1;
        }

        // Check if overdue
        if (task.dueDate && task.dueDate < now) {
          overdueTasks++;
        }

        // Check if completed (assuming last column is "Done")
        const isLastColumn = board.columns.indexOf(column) === board.columns.length - 1;
        if (isLastColumn) {
          completedTasks++;
        }
      }
    }

    return {
      totalTasks,
      completedTasks,
      overdueTasks,
      tasksByPriority,
      tasksByAssignee
    };
  }

  getAllBoards(): KanbanBoard[] {
    return Array.from(this.boards.values());
  }

  exportBoard(boardId: string): string | null {
    const board = this.boards.get(boardId);
    if (!board) return null;

    return JSON.stringify(board, null, 2);
  }

  importBoard(boardData: string): KanbanBoard | null {
    try {
      const board = JSON.parse(boardData) as KanbanBoard;
      // Validate structure
      if (!board.id || !board.name || !Array.isArray(board.columns)) {
        return null;
      }

      this.boards.set(board.id, board);
      return board;
    } catch {
      return null;
    }
  }
}

export const kanbanManager = new KanbanBoardManager();