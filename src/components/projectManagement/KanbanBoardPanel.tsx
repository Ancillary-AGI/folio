import React, { useState, useRef, useEffect } from 'react';
import { KanbanBoardManager, KanbanBoard, KanbanColumn, KanbanTask } from '../../lib/projectManagement/kanbanBoard';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { Plus, Edit, Trash2, Calendar, User, MessageSquare, Paperclip, CheckSquare } from 'lucide-react';

interface KanbanBoardPanelProps {
  onClose?: () => void;
}

export const KanbanBoardPanel: React.FC<KanbanBoardPanelProps> = ({ onClose }) => {
  const [kanbanManager] = useState(() => new KanbanBoardManager());
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<KanbanBoard | null>(null);
  const [showCreateBoard, setShowCreateBoard] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<KanbanTask | null>(null);

  // Form states
  const [newBoard, setNewBoard] = useState({
    name: '',
    description: ''
  });

  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium' as const,
    assignee: '',
    dueDate: '',
    labels: [] as string[]
  });

  const [newColumn, setNewColumn] = useState({
    title: '',
    color: '#3b82f6'
  });

  useEffect(() => {
    // Load existing boards
    setBoards(kanbanManager.getAllBoards());
  }, [kanbanManager]);

  const createBoard = () => {
    if (!newBoard.name.trim()) return;

    const board = kanbanManager.createBoard({
      name: newBoard.name,
      description: newBoard.description,
      columns: [
        { id: 'todo', title: 'To Do', color: '#ef4444', tasks: [] },
        { id: 'in-progress', title: 'In Progress', color: '#f59e0b', tasks: [] },
        { id: 'review', title: 'Review', color: '#3b82f6', tasks: [] },
        { id: 'done', title: 'Done', color: '#10b981', tasks: [] }
      ],
      members: [],
      settings: {
        allowTaskAssignment: true,
        allowComments: true,
        allowAttachments: true,
        allowSubtasks: true,
        showDueDates: true,
        showPriority: true,
        showAssignee: true,
        autoArchiveCompleted: false,
        archiveAfterDays: 30
      }
    });

    setBoards(kanbanManager.getAllBoards());
    setNewBoard({ name: '', description: '' });
    setShowCreateBoard(false);
  };

  const createTask = (columnId: string) => {
    if (!selectedBoard || !newTask.title.trim()) return;

    kanbanManager.addTask(selectedBoard.id, columnId, {
      title: newTask.title,
      description: newTask.description,
      priority: newTask.priority,
      assignee: newTask.assignee || undefined,
      dueDate: newTask.dueDate ? new Date(newTask.dueDate) : undefined,
      labels: newTask.labels,
      attachments: [],
      comments: [],
      subtasks: []
    });

    setBoards(kanbanManager.getAllBoards());
    setSelectedBoard(kanbanManager.getBoard(selectedBoard.id) || null);
    setNewTask({
      title: '',
      description: '',
      priority: 'medium',
      assignee: '',
      dueDate: '',
      labels: []
    });
    setShowCreateTask(null);
  };

  const addColumn = () => {
    if (!selectedBoard || !newColumn.title.trim()) return;

    kanbanManager.addColumn(selectedBoard.id, {
      title: newColumn.title,
      color: newColumn.color
    });

    setBoards(kanbanManager.getAllBoards());
    setSelectedBoard(kanbanManager.getBoard(selectedBoard.id) || null);
    setNewColumn({ title: '', color: '#3b82f6' });
  };

  const onDragEnd = (result: DropResult) => {
    if (!selectedBoard || !result.destination) return;

    const { source, destination, draggableId } = result;

    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    kanbanManager.moveTask(
      selectedBoard.id,
      draggableId,
      source.droppableId,
      destination.droppableId,
      destination.index
    );

    setBoards(kanbanManager.getAllBoards());
    setSelectedBoard(kanbanManager.getBoard(selectedBoard.id) || null);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'urgent': return '🚨';
      case 'high': return '🔴';
      case 'medium': return '🟡';
      case 'low': return '🟢';
      default: return '⚪';
    }
  };

  if (!selectedBoard) {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Kanban Boards
            <div className="flex gap-2">
              <Dialog open={showCreateBoard} onOpenChange={setShowCreateBoard}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    New Board
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Board</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="board-name">Board Name</Label>
                      <Input
                        id="board-name"
                        value={newBoard.name}
                        onChange={(e) => setNewBoard(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Enter board name"
                      />
                    </div>
                    <div>
                      <Label htmlFor="board-description">Description</Label>
                      <Textarea
                        id="board-description"
                        value={newBoard.description}
                        onChange={(e) => setNewBoard(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Enter board description"
                      />
                    </div>
                    <Button onClick={createBoard} className="w-full">
                      Create Board
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              {onClose && (
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {boards.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">No boards created yet.</p>
              <Button onClick={() => setShowCreateBoard(true)}>
                Create Your First Board
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {boards.map(board => (
                <Card key={board.id} className="cursor-pointer hover:shadow-md transition-shadow">
                  <CardHeader>
                    <CardTitle className="text-lg">{board.name}</CardTitle>
                    {board.description && (
                      <p className="text-sm text-muted-foreground">{board.description}</p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">
                        {board.columns.reduce((total, col) => total + col.tasks.length, 0)} tasks
                      </span>
                      <Button onClick={() => setSelectedBoard(board)}>
                        Open Board
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h1 className="text-2xl font-bold">{selectedBoard.name}</h1>
          {selectedBoard.description && (
            <p className="text-muted-foreground">{selectedBoard.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Add Column
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Column</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="column-title">Column Title</Label>
                  <Input
                    id="column-title"
                    value={newColumn.title}
                    onChange={(e) => setNewColumn(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Enter column title"
                  />
                </div>
                <div>
                  <Label htmlFor="column-color">Color</Label>
                  <Input
                    id="column-color"
                    type="color"
                    value={newColumn.color}
                    onChange={(e) => setNewColumn(prev => ({ ...prev, color: e.target.value }))}
                  />
                </div>
                <Button onClick={addColumn} className="w-full">
                  Add Column
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => setSelectedBoard(null)}>
            Back to Boards
          </Button>
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-x-auto p-4">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 h-full">
            {selectedBoard.columns.map((column, columnIndex) => (
              <div key={column.id} className="flex-shrink-0 w-80">
                <div className="bg-gray-50 rounded-lg p-4 h-full">
                  <div className="flex items-center justify-between mb-4">
                    <h3
                      className="font-semibold text-sm uppercase tracking-wide"
                      style={{ color: column.color }}
                    >
                      {column.title}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {column.tasks.length}
                      {column.limit && ` / ${column.limit}`}
                    </span>
                  </div>

                  <Droppable droppableId={column.id}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`space-y-3 min-h-[200px] ${
                          snapshot.isDraggingOver ? 'bg-blue-50 rounded' : ''
                        }`}
                      >
                        {column.tasks.map((task, taskIndex) => (
                          <Draggable key={task.id} draggableId={task.id} index={taskIndex}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`bg-white p-3 rounded shadow-sm border ${
                                  snapshot.isDragging ? 'shadow-lg rotate-3' : 'hover:shadow-md'
                                } transition-shadow`}
                              >
                                <div className="flex items-start justify-between mb-2">
                                  <h4 className="font-medium text-sm">{task.title}</h4>
                                  <span className="text-xs ml-2">
                                    {getPriorityIcon(task.priority)}
                                  </span>
                                </div>

                                {task.description && (
                                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                                    {task.description}
                                  </p>
                                )}

                                <div className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-2">
                                    {task.assignee && (
                                      <div className="flex items-center gap-1">
                                        <User className="w-3 h-3" />
                                        <span>{task.assignee}</span>
                                      </div>
                                    )}
                                    {task.dueDate && (
                                      <div className="flex items-center gap-1">
                                        <Calendar className="w-3 h-3" />
                                        <span>{task.dueDate.toLocaleDateString()}</span>
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex gap-1">
                                    {task.comments.length > 0 && (
                                      <div className="flex items-center gap-1">
                                        <MessageSquare className="w-3 h-3" />
                                        <span>{task.comments.length}</span>
                                      </div>
                                    )}
                                    {task.subtasks.length > 0 && (
                                      <div className="flex items-center gap-1">
                                        <CheckSquare className="w-3 h-3" />
                                        <span>{task.subtasks.filter(st => st.completed).length}/{task.subtasks.length}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {task.labels.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {task.labels.map((label, index) => (
                                      <Badge key={index} variant="secondary" className="text-xs">
                                        {label}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}

                        <Dialog open={showCreateTask === column.id} onOpenChange={(open) => !open && setShowCreateTask(null)}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              className="w-full justify-start text-muted-foreground hover:text-foreground"
                              onClick={() => setShowCreateTask(column.id)}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Add Task
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-md">
                            <DialogHeader>
                              <DialogTitle>Add New Task</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div>
                                <Label htmlFor="task-title">Title</Label>
                                <Input
                                  id="task-title"
                                  value={newTask.title}
                                  onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                                  placeholder="Enter task title"
                                />
                              </div>
                              <div>
                                <Label htmlFor="task-description">Description</Label>
                                <Textarea
                                  id="task-description"
                                  value={newTask.description}
                                  onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                                  placeholder="Enter task description"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <Label htmlFor="task-priority">Priority</Label>
                                  <Select
                                    value={newTask.priority}
                                    onValueChange={(value: any) => setNewTask(prev => ({ ...prev, priority: value }))}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="low">Low</SelectItem>
                                      <SelectItem value="medium">Medium</SelectItem>
                                      <SelectItem value="high">High</SelectItem>
                                      <SelectItem value="urgent">Urgent</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label htmlFor="task-assignee">Assignee</Label>
                                  <Input
                                    id="task-assignee"
                                    value={newTask.assignee}
                                    onChange={(e) => setNewTask(prev => ({ ...prev, assignee: e.target.value }))}
                                    placeholder="Assignee name"
                                  />
                                </div>
                              </div>
                              <div>
                                <Label htmlFor="task-due-date">Due Date</Label>
                                <Input
                                  id="task-due-date"
                                  type="date"
                                  value={newTask.dueDate}
                                  onChange={(e) => setNewTask(prev => ({ ...prev, dueDate: e.target.value }))}
                                />
                              </div>
                              <Button onClick={() => createTask(column.id)} className="w-full">
                                Create Task
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    )}
                  </Droppable>
                </div>
              </div>
            ))}
          </div>
        </DragDropContext>
      </div>
    </div>
  );
};