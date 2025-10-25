import { Component } from '../../types';

export interface TimeEntry {
  id: string;
  userId: string;
  projectId?: string;
  taskId?: string;
  issueId?: string;
  description: string;
  startTime: Date;
  endTime?: Date;
  duration: number; // minutes
  billable: boolean;
  billableRate?: number;
  costRate?: number;
  category: 'development' | 'design' | 'testing' | 'documentation' | 'meeting' | 'review' | 'maintenance' | 'training' | 'other';
  tags: string[];
  location?: 'office' | 'remote' | 'client_site' | 'travel';
  interruptions: Array<{
    startTime: Date;
    endTime: Date;
    reason: string;
    duration: number;
  }>;
  productivity: {
    focus: number; // 0-100
    efficiency: number; // 0-100
    satisfaction: number; // 0-100
  };
  metadata: {
    device: string;
    ipAddress: string;
    userAgent: string;
    created: Date;
    updated: Date;
  };
}

export interface TimeSheet {
  id: string;
  userId: string;
  period: {
    start: Date;
    end: Date;
    type: 'weekly' | 'biweekly' | 'monthly' | 'custom';
  };
  entries: TimeEntry[];
  summary: {
    totalHours: number;
    billableHours: number;
    nonBillableHours: number;
    overtimeHours: number;
    categories: Record<string, number>;
    projects: Record<string, number>;
  };
  approval: {
    status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'revised';
    submittedAt?: Date;
    approvedAt?: Date;
    approvedBy?: string;
    rejectedAt?: Date;
    rejectedBy?: string;
    rejectionReason?: string;
    revisionRequested?: boolean;
    revisionReason?: string;
  };
  notes?: string;
  created: Date;
  updated: Date;
}

export interface TimeBudget {
  id: string;
  projectId: string;
  taskId?: string;
  allocatedHours: number;
  usedHours: number;
  remainingHours: number;
  budgetType: 'fixed' | 'flexible' | 'unlimited';
  alertThreshold: number; // percentage
  alerts: Array<{
    type: 'warning' | 'critical' | 'exceeded';
    threshold: number;
    triggered: Date;
    acknowledged: boolean;
  }>;
  forecast: {
    estimatedCompletion: Date;
    projectedHours: number;
    variance: number;
    confidence: number;
  };
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
  };
}

export interface TimeTrackingRules {
  id: string;
  organizationId: string;
  rules: {
    workingHours: {
      start: string; // HH:MM
      end: string; // HH:MM
      timezone: string;
      workDays: number[]; // 0-6, 0=Sunday
    };
    overtime: {
      threshold: number; // hours per day
      multiplier: number; // 1.5 for time-and-half
      maxHours: number; // per week
    };
    breaks: {
      required: boolean;
      minimumDuration: number; // minutes
      maximumContinuous: number; // hours
    };
    rounding: {
      enabled: boolean;
      interval: number; // minutes
      rule: 'round' | 'ceil' | 'floor' | 'nearest';
    };
    categories: {
      required: boolean;
      allowed: string[];
      default: string;
    };
    approval: {
      required: boolean;
      autoApproval: boolean;
      maxHoursWithoutApproval: number;
      approvers: string[];
    };
    validation: {
      maxHoursPerDay: number;
      maxHoursPerWeek: number;
      futureEntries: boolean;
      overlappingEntries: boolean;
    };
  };
  exceptions: Array<{
    userId: string;
    rule: string;
    value: unknown;
    startDate: Date;
    endDate?: Date;
  }>;
  created: Date;
  updated: Date;
}

export interface TimeAnalytics {
  id: string;
  userId?: string;
  projectId?: string;
  period: {
    start: Date;
    end: Date;
  };
  metrics: {
    totalHours: number;
    billableHours: number;
    utilization: number; // percentage
    productivity: number;
    efficiency: number;
    overtime: number;
    breaks: number;
    interruptions: number;
  };
  trends: {
    dailyAverage: number[];
    weeklyTotal: number[];
    categoryDistribution: Record<string, number>;
    projectDistribution: Record<string, number>;
    productivityTrend: number[];
  };
  insights: Array<{
    type: 'productivity' | 'efficiency' | 'workload' | 'balance' | 'health';
    title: string;
    description: string;
    recommendation: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  benchmarks: {
    industry: {
      utilization: number;
      productivity: number;
      overtime: number;
    };
    team: {
      utilization: number;
      productivity: number;
      overtime: number;
    };
    personal: {
      bestDay: Date;
      bestWeek: Date;
      improvement: number;
    };
  };
  reports: {
    weekly: boolean;
    monthly: boolean;
    quarterly: boolean;
    custom: boolean;
  };
}

export interface TimeForecasting {
  id: string;
  projectId: string;
  taskId?: string;
  method: 'historical' | 'parametric' | 'expert_judgment' | 'machine_learning';
  parameters: Record<string, unknown>;
  historical: Array<{
    task: string;
    actualHours: number;
    estimatedHours: number;
    complexity: number;
    teamSize: number;
    experience: number;
  }>;
  forecast: Array<{
    taskId: string;
    optimistic: number;
    mostLikely: number;
    pessimistic: number;
    expected: number;
    standardDeviation: number;
    confidence: number;
  }>;
  scenarios: Array<{
    name: string;
    assumptions: Record<string, unknown>;
    forecast: TimeForecasting['forecast'];
    probability: number;
  }>;
  accuracy: {
    mape: number;
    rmse: number;
    lastUpdated: Date;
  };
  adjustments: Array<{
    factor: string;
    multiplier: number;
    reason: string;
    applied: Date;
  }>;
}

export class TimeTrackingManager {
  private entries: Map<string, TimeEntry> = new Map();
  private timesheets: Map<string, TimeSheet> = new Map();
  private budgets: Map<string, TimeBudget> = new Map();
  private rules: Map<string, TimeTrackingRules> = new Map();
  private analytics: Map<string, TimeAnalytics> = new Map();
  private forecasts: Map<string, TimeForecasting> = new Map();

  createTimeEntry(entry: Omit<TimeEntry, 'id' | 'metadata'>): TimeEntry {
    const timeEntry: TimeEntry = {
      ...entry,
      id: `time_${Date.now()}`,
      metadata: {
        device: 'web',
        ipAddress: '127.0.0.1',
        userAgent: 'CircuitCAD/1.0',
        created: new Date(),
        updated: new Date()
      }
    };

    this.entries.set(timeEntry.id, timeEntry);
    return timeEntry;
  }

  createTimeSheet(timesheet: Omit<TimeSheet, 'id' | 'created' | 'updated'>): TimeSheet {
    const timeSheet: TimeSheet = {
      ...timesheet,
      id: `timesheet_${Date.now()}`,
      created: new Date(),
      updated: new Date()
    };

    this.timesheets.set(timeSheet.id, timeSheet);
    return timeSheet;
  }

  createTimeBudget(budget: Omit<TimeBudget, 'id' | 'metadata'>): TimeBudget {
    const timeBudget: TimeBudget = {
      ...budget,
      id: `budget_${Date.now()}`,
      metadata: {
        created: new Date(),
        updated: new Date(),
        createdBy: 'system'
      }
    };

    this.budgets.set(timeBudget.id, timeBudget);
    return timeBudget;
  }

  createTimeTrackingRules(rules: Omit<TimeTrackingRules, 'id' | 'created' | 'updated'>): TimeTrackingRules {
    const timeTrackingRules: TimeTrackingRules = {
      ...rules,
      id: `rules_${Date.now()}`,
      created: new Date(),
      updated: new Date()
    };

    this.rules.set(timeTrackingRules.id, timeTrackingRules);
    return timeTrackingRules;
  }

  createTimeAnalytics(analytics: Omit<TimeAnalytics, 'id'>): TimeAnalytics {
    const timeAnalytics: TimeAnalytics = {
      ...analytics,
      id: `analytics_${Date.now()}`
    };

    this.analytics.set(timeAnalytics.id, timeAnalytics);
    return timeAnalytics;
  }

  createTimeForecasting(forecast: Omit<TimeForecasting, 'id'>): TimeForecasting {
    const timeForecasting: TimeForecasting = {
      ...forecast,
      id: `forecast_${Date.now()}`
    };

    this.forecasts.set(timeForecasting.id, timeForecasting);
    return timeForecasting;
  }

  startTimeTracking(userId: string, description: string, options?: {
    projectId?: string;
    taskId?: string;
    issueId?: string;
    category?: TimeEntry['category'];
    billable?: boolean;
    tags?: string[];
  }): Promise<TimeEntry> {
    return new Promise((resolve) => {
      // Check for existing active entry
      const activeEntry = Array.from(this.entries.values())
        .find(entry => entry.userId === userId && !entry.endTime);

      if (activeEntry) {
        resolve(activeEntry); // Return existing active entry
        return;
      }

      // Create new entry
      const entry = this.createTimeEntry({
        userId,
        description,
        startTime: new Date(),
        duration: 0,
        billable: options?.billable || false,
        category: options?.category || 'other',
        tags: options?.tags || [],
        projectId: options?.projectId,
        taskId: options?.taskId,
        issueId: options?.issueId,
        interruptions: [],
        productivity: {
          focus: 100,
          efficiency: 100,
          satisfaction: 100
        }
      });

      resolve(entry);
    });
  }

  stopTimeTracking(entryId: string, userId: string): Promise<TimeResult> {
    return new Promise((resolve) => {
      const entry = this.entries.get(entryId);
      if (!entry || entry.userId !== userId) {
        resolve({ success: false, error: 'Time entry not found or access denied' });
        return;
      }

      if (entry.endTime) {
        resolve({ success: false, error: 'Time entry already stopped' });
        return;
      }

      // Stop the timer
      entry.endTime = new Date();
      entry.duration = Math.round((entry.endTime.getTime() - entry.startTime.getTime()) / (1000 * 60)); // minutes
      entry.metadata.updated = new Date();

      resolve({
        success: true,
        entryId,
        duration: entry.duration,
        startTime: entry.startTime,
        endTime: entry.endTime,
        stoppedAt: Date.now()
      });
    });
  }

  submitTimeSheet(timesheetId: string, userId: string): Promise<SubmissionResult> {
    return new Promise((resolve) => {
      const timesheet = this.timesheets.get(timesheetId);
      if (!timesheet || timesheet.userId !== userId) {
        resolve({ success: false, error: 'Timesheet not found or access denied' });
        return;
      }

      // Validate timesheet
      const validation = this.validateTimeSheet(timesheet);
      if (!validation.valid) {
        resolve({ success: false, error: 'Timesheet validation failed', errors: validation.errors });
        return;
      }

      // Submit timesheet
      timesheet.approval.status = 'submitted';
      timesheet.approval.submittedAt = new Date();
      timesheet.updated = new Date();

      resolve({
        success: true,
        timesheetId,
        status: 'submitted',
        submittedAt: timesheet.approval.submittedAt,
        submissionTime: Date.now()
      });
    });
  }

  private validateTimeSheet(timesheet: TimeSheet): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check total hours
    if (timesheet.summary.totalHours > 168) { // More than a week
      errors.push('Total hours exceed maximum allowed');
    }

    // Check for overlapping entries
    const entries = timesheet.entries.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const curr = entries[i];
      if (prev.endTime && curr.startTime < prev.endTime) {
        errors.push('Overlapping time entries detected');
        break;
      }
    }

    // Check required fields
    timesheet.entries.forEach((entry, index) => {
      if (!entry.description.trim()) {
        errors.push(`Entry ${index + 1}: Description is required`);
      }
      if (!entry.category) {
        errors.push(`Entry ${index + 1}: Category is required`);
      }
    });

    return { valid: errors.length === 0, errors };
  }

  approveTimeSheet(timesheetId: string, approverId: string, comments?: string): Promise<ApprovalResult> {
    return new Promise((resolve) => {
      const timesheet = this.timesheets.get(timesheetId);
      if (!timesheet) {
        resolve({ success: false, error: 'Timesheet not found' });
        return;
      }

      // Check permissions (simplified)
      if (timesheet.approval.status !== 'submitted') {
        resolve({ success: false, error: 'Timesheet is not in submitted status' });
        return;
      }

      // Approve timesheet
      timesheet.approval.status = 'approved';
      timesheet.approval.approvedAt = new Date();
      timesheet.approval.approvedBy = approverId;
      timesheet.updated = new Date();

      if (comments) {
        timesheet.notes = (timesheet.notes || '') + `\nApproval comments: ${comments}`;
      }

      resolve({
        success: true,
        timesheetId,
        status: 'approved',
        approvedBy: approverId,
        approvedAt: timesheet.approval.approvedAt,
        approvalTime: Date.now()
      });
    });
  }

  generateTimeAnalytics(userId: string, period: { start: Date; end: Date }): Promise<AnalyticsResult> {
    return new Promise((resolve) => {
      // Get time entries for the period
      const entries = Array.from(this.entries.values())
        .filter(entry =>
          entry.userId === userId &&
          entry.startTime >= period.start &&
          entry.startTime <= period.end
        );

      // Calculate metrics
      const totalHours = entries.reduce((sum, entry) => sum + entry.duration, 0) / 60; // Convert to hours
      const billableHours = entries
        .filter(entry => entry.billable)
        .reduce((sum, entry) => sum + entry.duration, 0) / 60;

      const utilization = totalHours > 0 ? (billableHours / totalHours) * 100 : 0;

      // Calculate trends (simplified)
      const dailyHours: number[] = [];
      const categoryDistribution: Record<string, number> = {};

      entries.forEach(entry => {
        const dayIndex = Math.floor((entry.startTime.getTime() - period.start.getTime()) / (1000 * 60 * 60 * 24));
        if (dayIndex >= 0 && dayIndex < 30) { // Assume 30-day period
          dailyHours[dayIndex] = (dailyHours[dayIndex] || 0) + entry.duration / 60;
        }

        categoryDistribution[entry.category] = (categoryDistribution[entry.category] || 0) + entry.duration / 60;
      });

      // Generate insights
      const insights = [];
      if (utilization < 70) {
        insights.push({
          type: 'utilization' as const,
          title: 'Low Billable Utilization',
          description: `Your billable utilization is ${utilization.toFixed(1)}%, below the 70% target.`,
          recommendation: 'Focus on billable work and minimize administrative tasks.',
          severity: 'medium' as const
        });
      }

      if (totalHours > 50) { // More than 50 hours per week
        insights.push({
          type: 'workload' as const,
          title: 'High Workload',
          description: `You've logged ${totalHours.toFixed(1)} hours this period.`,
          recommendation: 'Consider work-life balance and take regular breaks.',
          severity: 'high' as const
        });
      }

      resolve({
        success: true,
        userId,
        period,
        metrics: {
          totalHours,
          billableHours,
          utilization,
          productivity: 85, // Mock value
          efficiency: 90, // Mock value
          overtime: Math.max(0, totalHours - 40), // Assume 40-hour work week
          breaks: 5, // Mock value
          interruptions: 2 // Mock value
        },
        trends: {
          dailyAverage: dailyHours,
          weeklyTotal: [], // Would calculate weekly totals
          categoryDistribution,
          projectDistribution: {}, // Would calculate project distribution
          productivityTrend: [] // Would calculate productivity trend
        },
        insights,
        benchmarks: {
          industry: { utilization: 75, productivity: 80, overtime: 5 },
          team: { utilization: 70, productivity: 75, overtime: 3 },
          personal: {
            bestDay: new Date(),
            bestWeek: new Date(),
            improvement: 5
          }
        },
        generatedAt: Date.now()
      });
    });
  }

  forecastProjectTime(projectId: string): Promise<ForecastResult> {
    return new Promise((resolve) => {
      const forecast = Array.from(this.forecasts.values())
        .find(f => f.projectId === projectId);

      if (!forecast) {
        resolve({ success: false, error: 'Time forecast not found for project' });
        return;
      }

      // Calculate project forecast
      const totalExpected = forecast.forecast.reduce((sum, task) => sum + task.expected, 0);
      const totalOptimistic = forecast.forecast.reduce((sum, task) => sum + task.optimistic, 0);
      const totalPessimistic = forecast.forecast.reduce((sum, task) => sum + task.pessimistic, 0);

      const variance = ((totalPessimistic - totalOptimistic) / (6 * totalExpected)) ** 2;
      const standardDeviation = Math.sqrt(variance);

      resolve({
        success: true,
        projectId,
        totalExpected,
        totalOptimistic,
        totalPessimistic,
        standardDeviation,
        confidence: 0.95,
        tasks: forecast.forecast.length,
        forecastTime: Date.now()
      });
    });
  }

  getTimeEntry(id: string): TimeEntry | undefined {
    return this.entries.get(id);
  }

  getTimeSheet(id: string): TimeSheet | undefined {
    return this.timesheets.get(id);
  }

  getTimeBudget(id: string): TimeBudget | undefined {
    return this.budgets.get(id);
  }

  getTimeTrackingRules(id: string): TimeTrackingRules | undefined {
    return this.rules.get(id);
  }

  getTimeAnalytics(id: string): TimeAnalytics | undefined {
    return this.analytics.get(id);
  }

  getTimeForecasting(id: string): TimeForecasting | undefined {
    return this.forecasts.get(id);
  }

  getAllTimeEntries(): TimeEntry[] {
    return Array.from(this.entries.values());
  }

  getAllTimeSheets(): TimeSheet[] {
    return Array.from(this.timesheets.values());
  }

  getAllTimeBudgets(): TimeBudget[] {
    return Array.from(this.budgets.values());
  }

  getAllTimeTrackingRules(): TimeTrackingRules[] {
    return Array.from(this.rules.values());
  }

  getAllTimeAnalytics(): TimeAnalytics[] {
    return Array.from(this.analytics.values());
  }

  getAllTimeForecastings(): TimeForecasting[] {
    return Array.from(this.forecasts.values());
  }

  updateTimeEntry(id: string, updates: Partial<TimeEntry>): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;

    Object.assign(entry, updates);
    entry.metadata.updated = new Date();
    return true;
  }

  deleteTimeEntry(id: string): boolean {
    return this.entries.delete(id);
  }

  exportTimeTrackingConfiguration(): Record<string, unknown> {
    return {
      entries: Array.from(this.entries.values()),
      timesheets: Array.from(this.timesheets.values()),
      budgets: Array.from(this.budgets.values()),
      rules: Array.from(this.rules.values()),
      analytics: Array.from(this.analytics.values()),
      forecasts: Array.from(this.forecasts.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface TimeResult {
  success: boolean;
  error?: string;
  entryId?: string;
  duration?: number;
  startTime?: Date;
  endTime?: Date;
  stoppedAt?: number;
}

interface SubmissionResult {
  success: boolean;
  error?: string;
  errors?: string[];
  timesheetId?: string;
  status?: string;
  submittedAt?: Date;
  submissionTime?: number;
}

interface ApprovalResult {
  success: boolean;
  error?: string;
  timesheetId?: string;
  status?: string;
  approvedBy?: string;
  approvedAt?: Date;
  approvalTime?: number;
}

interface AnalyticsResult {
  success: boolean;
  error?: string;
  userId?: string;
  period?: { start: Date; end: Date };
  metrics?: {
    totalHours: number;
    billableHours: number;
    utilization: number;
    productivity: number;
    efficiency: number;
    overtime: number;
    breaks: number;
    interruptions: number;
  };
  trends?: {
    dailyAverage: number[];
    weeklyTotal: number[];
    categoryDistribution: Record<string, number>;
    projectDistribution: Record<string, number>;
    productivityTrend: number[];
  };
  insights?: Array<{
    type: string;
    title: string;
    description: string;
    recommendation: string;
    severity: string;
  }>;
  benchmarks?: {
    industry: { utilization: number; productivity: number; overtime: number };
    team: { utilization: number; productivity: number; overtime: number };
    personal: { bestDay: Date; bestWeek: Date; improvement: number };
  };
  generatedAt?: number;
}

interface ForecastResult {
  success: boolean;
  error?: string;
  projectId?: string;
  totalExpected?: number;
  totalOptimistic?: number;
  totalPessimistic?: number;
  standardDeviation?: number;
  confidence?: number;
  tasks?: number;
  forecastTime?: number;
}

export const timeTrackingManager = new TimeTrackingManager();