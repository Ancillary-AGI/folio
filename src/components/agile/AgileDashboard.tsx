import React, { useState, useEffect } from 'react';
import { agileManager, Task, Sprint, KanbanBoard, GanttChart, AgileMetrics } from '../../lib/agile/agileManager';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export const AgileDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [charts, setCharts] = useState<GanttChart[]>([]);
  const [metrics, setMetrics] = useState<AgileMetrics | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setTasks(agileManager.getAllTasks());
    setSprints(agileManager.getAllSprints());
    setBoards(agileManager.getAllBoards());
    setCharts(agileManager.getAllGanttCharts());

    // Calculate metrics for all sprints
    const sprintIds = agileManager.getAllSprints().map(s => s.id);
    if (sprintIds.length > 0) {
      setMetrics(agileManager.calculateMetrics(sprintIds));
    }
  };

  const createTask = () => {
    agileManager.createTask({
      title: 'New Task',
      description: 'Task description',
      status: 'todo',
      priority: 'medium',
      tags: [],
      dependencies: [],
      subtasks: []
    });
    loadData();
  };

  const createSprint = () => {
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14); // 2 weeks

    agileManager.createSprint({
      name: 'New Sprint',
      goal: 'Sprint goal',
      startDate,
      endDate,
      status: 'planned',
      tasks: []
    });
    loadData();
  };

  const createKanbanBoard = () => {
    agileManager.createKanbanBoard({
      name: 'New Board',
      columns: [
        { id: 'todo', name: 'To Do', taskIds: [], color: '#ef4444' },
        { id: 'in-progress', name: 'In Progress', taskIds: [], color: '#f59e0b' },
        { id: 'done', name: 'Done', taskIds: [], color: '#10b981' }
      ],
      wipLimits: { 'in-progress': 5 }
    });
    loadData();
  };

  const createGanttChart = () => {
    agileManager.createGanttChart({
      name: 'New Project',
      tasks: [],
      dependencies: [],
      milestones: []
    });
    loadData();
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'todo': return 'bg-gray-500';
      case 'in-progress': return 'bg-blue-500';
      case 'done': return 'bg-green-500';
      case 'blocked': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getPriorityColor = (priority: Task['priority']) => {
    switch (priority) {
      case 'low': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'urgent': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="w-full h-full p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Agile Project Management</h1>
        <div className="flex gap-2">
          <Button onClick={createTask}>New Task</Button>
          <Button onClick={createSprint}>New Sprint</Button>
          <Button onClick={createKanbanBoard}>New Kanban Board</Button>
          <Button onClick={createGanttChart}>New Gantt Chart</Button>
        </div>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.velocity.toFixed(1)}</div>
              <div className="text-sm text-muted-foreground">Velocity</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.cycleTime.toFixed(1)}d</div>
              <div className="text-sm text-muted-foreground">Cycle Time</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.throughput.toFixed(1)}</div>
              <div className="text-sm text-muted-foreground">Throughput</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.workInProgress}</div>
              <div className="text-sm text-muted-foreground">WIP</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="border-b border-gray-200 mb-4">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'tasks'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Tasks
          </button>
          <button
            onClick={() => setActiveTab('sprints')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'sprints'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Sprints
          </button>
          <button
            onClick={() => setActiveTab('kanban')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'kanban'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Kanban
          </button>
          <button
            onClick={() => setActiveTab('gantt')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'gantt'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Gantt
          </button>
        </nav>
      </div>

      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="grid gap-4">
            {tasks.map(task => (
              <Card key={task.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(task.status)}`} />
                      <div>
                        <h3 className="font-semibold">{task.title}</h3>
                        <p className="text-sm text-muted-foreground">{task.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs ${getPriorityColor(task.priority)}`}>
                        {task.priority}
                      </span>
                      {task.storyPoints && (
                        <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                          {task.storyPoints} pts
                        </span>
                      )}
                    </div>
                  </div>
                  {task.subtasks.length > 0 && (
                    <div className="mt-3">
                      <div className="text-sm text-muted-foreground mb-2">
                        Subtasks: {task.subtasks.filter(st => st.completed).length}/{task.subtasks.length}
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${(task.subtasks.filter(st => st.completed).length / task.subtasks.length) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {activeTab === 'sprints' && (
          <div className="grid gap-4">
            {sprints.map(sprint => (
              <Card key={sprint.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{sprint.name}</h3>
                      <p className="text-sm text-muted-foreground">{sprint.goal}</p>
                      <p className="text-xs text-muted-foreground">
                        {sprint.startDate.toLocaleDateString()} - {sprint.endDate.toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs ${sprint.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {sprint.status}
                      </span>
                      {sprint.velocity && (
                        <span className="px-2 py-1 bg-blue-100 rounded text-xs">
                          {sprint.velocity} pts
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-sm text-muted-foreground mb-2">
                      Tasks: {sprint.tasks.length}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {activeTab === 'kanban' && (
          <div className="grid gap-4">
            {boards.map(board => (
              <Card key={board.id}>
                <CardHeader>
                  <CardTitle>{board.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    {board.columns.map(column => (
                      <div key={column.id} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium">{column.name}</h4>
                          <span className="px-2 py-1 bg-gray-100 rounded text-xs">{column.taskIds.length}</span>
                        </div>
                        <div className="space-y-2">
                          {column.taskIds.slice(0, 3).map(taskId => {
                            const task = tasks.find(t => t.id === taskId);
                            return task ? (
                              <div key={taskId} className="p-2 bg-gray-50 rounded text-sm">
                                {task.title}
                              </div>
                            ) : null;
                          })}
                          {column.taskIds.length > 3 && (
                            <div className="text-xs text-muted-foreground">
                              +{column.taskIds.length - 3} more
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {activeTab === 'gantt' && (
          <div className="grid gap-4">
            {charts.map(chart => (
              <Card key={chart.id}>
                <CardHeader>
                  <CardTitle>{chart.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Tasks</h4>
                      <div className="space-y-2">
                        {chart.tasks.map(task => (
                          <div key={task.id} className="flex items-center gap-4">
                            <div className="flex-1">
                              <div className="font-medium">{task.name}</div>
                              <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                                <div
                                  className="bg-blue-600 h-2 rounded-full"
                                  style={{ width: `${task.progress}%` }}
                                />
                              </div>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {task.progress}%
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {chart.milestones.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Milestones</h4>
                        <div className="space-y-2">
                          {chart.milestones.map(milestone => (
                            <div key={milestone.id} className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${milestone.completed ? 'bg-green-500' : 'bg-gray-300'}`} />
                              <span className={milestone.completed ? 'line-through' : ''}>
                                {milestone.name}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
};
    </div>
  );
};