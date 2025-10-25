import { Component } from '../../types';

export interface Expense {
  id: string;
  userId: string;
  projectId?: string;
  category: 'travel' | 'meals' | 'accommodation' | 'transportation' | 'supplies' | 'equipment' | 'software' | 'training' | 'entertainment' | 'miscellaneous';
  subcategory?: string;
  description: string;
  amount: number;
  currency: string;
  exchangeRate?: number;
  amountBase: number; // Amount in base currency
  date: Date;
  vendor: string;
  paymentMethod: 'cash' | 'credit_card' | 'debit_card' | 'bank_transfer' | 'check' | 'digital_wallet' | 'corporate_card';
  receipt?: {
    id: string;
    filename: string;
    url: string;
    uploadedAt: Date;
    ocrData?: Record<string, unknown>;
  };
  tax: {
    rate: number;
    amount: number;
    category: 'vat' | 'gst' | 'sales_tax' | 'income_tax' | 'other';
    recoverable: boolean;
  };
  mileage?: {
    distance: number;
    unit: 'km' | 'miles';
    rate: number;
    vehicle: string;
  };
  attendees?: Array<{
    name: string;
    role: string;
    attendance: 'full' | 'partial';
  }>;
  approval: {
    status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'reimbursed';
    submittedAt?: Date;
    approvedAt?: Date;
    approvedBy?: string;
    rejectedAt?: Date;
    rejectedBy?: string;
    rejectionReason?: string;
    reimbursedAt?: Date;
    reimbursementMethod: string;
  };
  policy: {
    compliant: boolean;
    violations: string[];
    warnings: string[];
    overrides: Array<{
      rule: string;
      reason: string;
      approvedBy: string;
    }>;
  };
  tags: string[];
  customFields: Record<string, unknown>;
  metadata: {
    created: Date;
    updated: Date;
    source: 'manual' | 'ocr' | 'email' | 'api' | 'mobile';
    ipAddress: string;
    device: string;
  };
}

export interface ExpenseReport {
  id: string;
  userId: string;
  title: string;
  description?: string;
  period: {
    start: Date;
    end: Date;
  };
  expenses: Expense[];
  summary: {
    totalAmount: number;
    totalTax: number;
    reimbursableAmount: number;
    personalAmount: number;
    currency: string;
    categories: Record<string, number>;
    paymentMethods: Record<string, number>;
  };
  approval: {
    status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed';
    submittedAt?: Date;
    approvedAt?: Date;
    approvedBy?: string;
    rejectedAt?: Date;
    rejectedBy?: string;
    rejectionReason?: string;
    processedAt?: Date;
  };
  attachments: Array<{
    id: string;
    name: string;
    type: 'receipt' | 'invoice' | 'report' | 'other';
    url: string;
    uploadedAt: Date;
  }>;
  notes?: string;
  created: Date;
  updated: Date;
}

export interface ExpensePolicy {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  version: string;
  effectiveDate: Date;
  rules: Array<{
    id: string;
    category: string;
    condition: {
      type: 'amount' | 'percentage' | 'count' | 'date' | 'location' | 'vendor' | 'custom';
      operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'between' | 'contains' | 'not_contains';
      value: unknown;
      unit?: 'currency' | 'percentage' | 'count' | 'days';
    };
    action: {
      type: 'approve' | 'reject' | 'flag' | 'require_approval' | 'limit_amount' | 'require_receipt';
      severity: 'error' | 'warning' | 'info';
      message: string;
      limit?: number;
      approver?: string;
    };
    exceptions: Array<{
      condition: string;
      action: string;
    }>;
    enabled: boolean;
  }>;
  limits: {
    daily: Record<string, number>;
    weekly: Record<string, number>;
    monthly: Record<string, number>;
    yearly: Record<string, number>;
    perExpense: Record<string, number>;
  };
  allowedVendors: Array<{
    name: string;
    category: string;
    maxAmount?: number;
    preferred: boolean;
  }>;
  taxRules: Array<{
    category: string;
    rate: number;
    recoverable: boolean;
    jurisdiction: string;
  }>;
  mileageRates: Record<string, number>; // vehicle type -> rate per unit
  approvalWorkflow: Array<{
    level: number;
    condition: string; // amount threshold or rule
    approvers: string[];
    required: number; // number of approvals needed
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    approvedBy?: string;
  };
}

export interface ExpenseBudget {
  id: string;
  projectId?: string;
  departmentId?: string;
  userId?: string;
  period: {
    start: Date;
    end: Date;
    type: 'monthly' | 'quarterly' | 'yearly' | 'custom';
  };
  budget: {
    total: number;
    categories: Record<string, number>;
    currency: string;
  };
  actual: {
    total: number;
    categories: Record<string, number>;
    lastUpdated: Date;
  };
  forecast: {
    total: number;
    categories: Record<string, number>;
    confidence: number;
  };
  variance: {
    total: number;
    percentage: number;
    categories: Record<string, number>;
  };
  alerts: Array<{
    type: 'warning' | 'critical' | 'exceeded';
    category?: string;
    threshold: number;
    current: number;
    message: string;
    triggered: Date;
    acknowledged: boolean;
  }>;
  controls: Array<{
    type: 'hard_limit' | 'soft_limit' | 'approval_required' | 'notification';
    category?: string;
    threshold: number;
    action: string;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
  };
}

export interface ExpenseAnalytics {
  id: string;
  scope: 'organization' | 'department' | 'project' | 'user';
  scopeId?: string;
  period: {
    start: Date;
    end: Date;
  };
  metrics: {
    totalExpenses: number;
    averageExpense: number;
    expenseCount: number;
    reimbursementRate: number;
    policyCompliance: number;
    topCategories: Array<{ category: string; amount: number; percentage: number }>;
    topVendors: Array<{ vendor: string; amount: number; count: number }>;
    spendingTrends: Array<{ date: Date; amount: number }>;
    categoryTrends: Record<string, Array<{ date: Date; amount: number }>>;
  };
  benchmarks: {
    industry: {
      averageExpense: number;
      topCategories: string[];
      complianceRate: number;
    };
    internal: {
      averageExpense: number;
      topCategories: string[];
      complianceRate: number;
    };
  };
  insights: Array<{
    type: 'saving_opportunity' | 'policy_violation' | 'trend' | 'anomaly' | 'benchmark';
    title: string;
    description: string;
    impact: number;
    recommendation: string;
    priority: 'low' | 'medium' | 'high';
  }>;
  reports: {
    generated: Date;
    frequency: 'weekly' | 'monthly' | 'quarterly';
    recipients: string[];
    format: 'dashboard' | 'pdf' | 'excel' | 'email';
  };
}

export interface ExpenseIntegration {
  id: string;
  type: 'credit_card' | 'bank_account' | 'erp' | 'travel_booking' | 'receipt_scanner' | 'tax_service';
  provider: string;
  config: Record<string, unknown>;
  status: 'active' | 'inactive' | 'error';
  lastSync?: Date;
  syncFrequency: 'real_time' | 'hourly' | 'daily' | 'weekly';
  mappings: {
    categories: Record<string, string>;
    vendors: Record<string, string>;
    accounts: Record<string, string>;
  };
  webhooks: Array<{
    event: string;
    url: string;
    secret: string;
  }>;
  metadata: {
    connected: Date;
    lastUsed: Date;
    apiVersion: string;
  };
}

export class ExpenseManagementManager {
  private expenses: Map<string, Expense> = new Map();
  private reports: Map<string, ExpenseReport> = new Map();
  private policies: Map<string, ExpensePolicy> = new Map();
  private budgets: Map<string, ExpenseBudget> = new Map();
  private analytics: Map<string, ExpenseAnalytics> = new Map();
  private integrations: Map<string, ExpenseIntegration> = new Map();

  createExpense(expense: Omit<Expense, 'id' | 'metadata'>): Expense {
    const newExpense: Expense = {
      ...expense,
      id: `expense_${Date.now()}`,
      metadata: {
        created: new Date(),
        updated: new Date(),
        source: 'manual',
        ipAddress: '127.0.0.1',
        device: 'web'
      }
    };

    this.expenses.set(newExpense.id, newExpense);
    return newExpense;
  }

  createExpenseReport(report: Omit<ExpenseReport, 'id' | 'created' | 'updated'>): ExpenseReport {
    const newReport: ExpenseReport = {
      ...report,
      id: `report_${Date.now()}`,
      created: new Date(),
      updated: new Date()
    };

    this.reports.set(newReport.id, newReport);
    return newReport;
  }

  createExpensePolicy(policy: Omit<ExpensePolicy, 'id' | 'metadata'>): ExpensePolicy {
    const newPolicy: ExpensePolicy = {
      ...policy,
      id: `policy_${Date.now()}`,
      metadata: {
        created: new Date(),
        updated: new Date(),
        createdBy: 'system'
      }
    };

    this.policies.set(newPolicy.id, newPolicy);
    return newPolicy;
  }

  createExpenseBudget(budget: Omit<ExpenseBudget, 'id' | 'metadata'>): ExpenseBudget {
    const newBudget: ExpenseBudget = {
      ...budget,
      id: `budget_${Date.now()}`,
      metadata: {
        created: new Date(),
        updated: new Date(),
        createdBy: 'system'
      }
    };

    this.budgets.set(newBudget.id, newBudget);
    return newBudget;
  }

  createExpenseAnalytics(analytics: Omit<ExpenseAnalytics, 'id'>): ExpenseAnalytics {
    const newAnalytics: ExpenseAnalytics = {
      ...analytics,
      id: `analytics_${Date.now()}`
    };

    this.analytics.set(newAnalytics.id, newAnalytics);
    return newAnalytics;
  }

  createExpenseIntegration(integration: Omit<ExpenseIntegration, 'id' | 'metadata'>): ExpenseIntegration {
    const newIntegration: ExpenseIntegration = {
      ...integration,
      id: `integration_${Date.now()}`,
      metadata: {
        connected: new Date(),
        lastUsed: new Date(),
        apiVersion: '1.0'
      }
    };

    this.integrations.set(newIntegration.id, newIntegration);
    return newIntegration;
  }

  submitExpenseReport(reportId: string, userId: string): Promise<SubmissionResult> {
    return new Promise((resolve) => {
      const report = this.reports.get(reportId);
      if (!report || report.userId !== userId) {
        resolve({ success: false, error: 'Report not found or access denied' });
        return;
      }

      // Validate report
      const validation = this.validateExpenseReport(report);
      if (!validation.valid) {
        resolve({ success: false, error: 'Report validation failed', errors: validation.errors });
        return;
      }

      // Submit report
      report.approval.status = 'submitted';
      report.approval.submittedAt = new Date();
      report.updated = new Date();

      resolve({
        success: true,
        reportId,
        status: 'submitted',
        submittedAt: report.approval.submittedAt,
        submissionTime: Date.now()
      });
    });
  }

  private validateExpenseReport(report: ExpenseReport): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for required receipts
    report.expenses.forEach((expense, index) => {
      if (expense.amount > 50 && !expense.receipt) {
        errors.push(`Expense ${index + 1}: Receipt required for amounts over $50`);
      }
    });

    // Check policy compliance
    report.expenses.forEach((expense, index) => {
      if (!expense.policy.compliant) {
        errors.push(`Expense ${index + 1}: Policy violations found`);
      }
    });

    // Check total amount
    if (report.summary.totalAmount > 10000) {
      errors.push('Total amount exceeds approval threshold');
    }

    return { valid: errors.length === 0, errors };
  }

  approveExpenseReport(reportId: string, approverId: string, comments?: string): Promise<ApprovalResult> {
    return new Promise((resolve) => {
      const report = this.reports.get(reportId);
      if (!report) {
        resolve({ success: false, error: 'Report not found' });
        return;
      }

      // Check permissions (simplified)
      if (report.approval.status !== 'submitted') {
        resolve({ success: false, error: 'Report is not in submitted status' });
        return;
      }

      // Approve report
      report.approval.status = 'approved';
      report.approval.approvedAt = new Date();
      report.approval.approvedBy = approverId;
      report.updated = new Date();

      if (comments) {
        report.notes = (report.notes || '') + `\nApproval comments: ${comments}`;
      }

      resolve({
        success: true,
        reportId,
        status: 'approved',
        approvedBy: approverId,
        approvedAt: report.approval.approvedAt,
        approvalTime: Date.now()
      });
    });
  }

  processExpenseReimbursement(reportId: string, processorId: string): Promise<ReimbursementResult> {
    return new Promise((resolve) => {
      const report = this.reports.get(reportId);
      if (!report) {
        resolve({ success: false, error: 'Report not found' });
        return;
      }

      if (report.approval.status !== 'approved') {
        resolve({ success: false, error: 'Report must be approved before reimbursement' });
        return;
      }

      // Process reimbursement
      report.approval.status = 'processed';
      report.approval.processedAt = new Date();
      report.expenses.forEach(expense => {
        if (expense.approval.status === 'approved') {
          expense.approval.status = 'reimbursed';
          expense.approval.reimbursedAt = new Date();
        }
      });
      report.updated = new Date();

      resolve({
        success: true,
        reportId,
        amount: report.summary.reimbursableAmount,
        currency: report.summary.currency,
        method: 'bank_transfer',
        processedAt: report.approval.processedAt,
        processingTime: Date.now()
      });
    });
  }

  checkExpensePolicy(expense: Expense): Promise<PolicyCheckResult> {
    return new Promise((resolve) => {
      // Get applicable policy
      const policy = Array.from(this.policies.values())[0]; // Simplified - get first policy
      if (!policy) {
        resolve({
          compliant: true,
          violations: [],
          warnings: [],
          overrides: []
        });
        return;
      }

      // Check rules
      const violations: string[] = [];
      const warnings: string[] = [];

      policy.rules.forEach(rule => {
        if (!rule.enabled) return;

        const matches = this.evaluateRuleCondition(rule.condition, expense);
        if (matches) {
          if (rule.action.severity === 'error') {
            violations.push(rule.action.message);
          } else if (rule.action.severity === 'warning') {
            warnings.push(rule.action.message);
          }
        }
      });

      // Check limits
      const periodExpenses = Array.from(this.expenses.values())
        .filter(e => e.userId === expense.userId &&
                    e.category === expense.category &&
                    e.date >= new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)); // Last 30 days

      const periodTotal = periodExpenses.reduce((sum, e) => sum + e.amount, 0) + expense.amount;

      if (policy.limits.monthly[expense.category] && periodTotal > policy.limits.monthly[expense.category]) {
        violations.push(`Monthly limit exceeded for ${expense.category}`);
      }

      resolve({
        compliant: violations.length === 0,
        violations,
        warnings,
        overrides: []
      });
    });
  }

  private evaluateRuleCondition(condition: ExpensePolicy['rules'][0]['condition'], expense: Expense): boolean {
    // Simplified rule evaluation
    switch (condition.type) {
      case 'amount':
        const amount = expense.amount;
        switch (condition.operator) {
          case 'greater_than':
            return amount > (condition.value as number);
          case 'less_than':
            return amount < (condition.value as number);
          default:
            return false;
        }
      default:
        return false;
    }
  }

  generateExpenseAnalytics(scope: ExpenseAnalytics['scope'], scopeId?: string, period?: { start: Date; end: Date }): Promise<AnalyticsResult> {
    return new Promise((resolve) => {
      const defaultPeriod = period || {
        start: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
        end: new Date()
      };

      // Get expenses for the period and scope
      let expenses = Array.from(this.expenses.values())
        .filter(expense => expense.date >= defaultPeriod.start && expense.date <= defaultPeriod.end);

      if (scope === 'user' && scopeId) {
        expenses = expenses.filter(e => e.userId === scopeId);
      } else if (scope === 'project' && scopeId) {
        expenses = expenses.filter(e => e.projectId === scopeId);
      }

      // Calculate metrics
      const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
      const expenseCount = expenses.length;
      const averageExpense = expenseCount > 0 ? totalExpenses / expenseCount : 0;

      // Category breakdown
      const categoryTotals: Record<string, number> = {};
      expenses.forEach(expense => {
        categoryTotals[expense.category] = (categoryTotals[expense.category] || 0) + expense.amount;
      });

      const topCategories = Object.entries(categoryTotals)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([category, amount]) => ({
          category,
          amount,
          percentage: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0
        }));

      // Spending trends (weekly)
      const trends: Array<{ date: Date; amount: number }> = [];
      for (let i = 0; i < 12; i++) {
        const weekStart = new Date(defaultPeriod.start.getTime() + i * 7 * 24 * 60 * 60 * 1000);
        const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        const weekExpenses = expenses.filter(e => e.date >= weekStart && e.date < weekEnd);
        const weekTotal = weekExpenses.reduce((sum, e) => sum + e.amount, 0);
        trends.push({ date: weekStart, amount: weekTotal });
      }

      resolve({
        success: true,
        scope,
        scopeId,
        period: defaultPeriod,
        metrics: {
          totalExpenses,
          averageExpense,
          expenseCount,
          reimbursementRate: 0.95, // Mock
          policyCompliance: 0.88, // Mock
          topCategories,
          topVendors: [], // Would calculate top vendors
          spendingTrends: trends,
          categoryTrends: {} // Would calculate category trends
        },
        benchmarks: {
          industry: {
            averageExpense: 150,
            topCategories: ['travel', 'meals', 'supplies'],
            complianceRate: 0.85
          },
          internal: {
            averageExpense: 120,
            topCategories: ['supplies', 'travel', 'software'],
            complianceRate: 0.90
          }
        },
        insights: [
          {
            type: 'saving_opportunity',
            title: 'High Travel Expenses',
            description: 'Travel expenses are 25% above budget',
            impact: 5000,
            recommendation: 'Consider virtual meetings for some trips',
            priority: 'medium'
          }
        ],
        generatedAt: Date.now()
      });
    });
  }

  getExpense(id: string): Expense | undefined {
    return this.expenses.get(id);
  }

  getExpenseReport(id: string): ExpenseReport | undefined {
    return this.reports.get(id);
  }

  getExpensePolicy(id: string): ExpensePolicy | undefined {
    return this.policies.get(id);
  }

  getExpenseBudget(id: string): ExpenseBudget | undefined {
    return this.budgets.get(id);
  }

  getExpenseAnalytics(id: string): ExpenseAnalytics | undefined {
    return this.analytics.get(id);
  }

  getExpenseIntegration(id: string): ExpenseIntegration | undefined {
    return this.integrations.get(id);
  }

  getAllExpenses(): Expense[] {
    return Array.from(this.expenses.values());
  }

  getAllExpenseReports(): ExpenseReport[] {
    return Array.from(this.reports.values());
  }

  getAllExpensePolicies(): ExpensePolicy[] {
    return Array.from(this.policies.values());
  }

  getAllExpenseBudgets(): ExpenseBudget[] {
    return Array.from(this.budgets.values());
  }

  getAllExpenseAnalytics(): ExpenseAnalytics[] {
    return Array.from(this.analytics.values());
  }

  getAllExpenseIntegrations(): ExpenseIntegration[] {
    return Array.from(this.integrations.values());
  }

  updateExpense(id: string, updates: Partial<Expense>): boolean {
    const expense = this.expenses.get(id);
    if (!expense) return false;

    Object.assign(expense, updates);
    expense.metadata.updated = new Date();
    return true;
  }

  deleteExpense(id: string): boolean {
    return this.expenses.delete(id);
  }

  exportExpenseManagementConfiguration(): Record<string, unknown> {
    return {
      expenses: Array.from(this.expenses.values()),
      reports: Array.from(this.reports.values()),
      policies: Array.from(this.policies.values()),
      budgets: Array.from(this.budgets.values()),
      analytics: Array.from(this.analytics.values()),
      integrations: Array.from(this.integrations.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface SubmissionResult {
  success: boolean;
  error?: string;
  errors?: string[];
  reportId?: string;
  status?: string;
  submittedAt?: Date;
  submissionTime?: number;
}

interface ApprovalResult {
  success: boolean;
  error?: string;
  reportId?: string;
  status?: string;
  approvedBy?: string;
  approvedAt?: Date;
  approvalTime?: number;
}

interface ReimbursementResult {
  success: boolean;
  error?: string;
  reportId?: string;
  amount?: number;
  currency?: string;
  method?: string;
  processedAt?: Date;
  processingTime?: number;
}

interface PolicyCheckResult {
  compliant: boolean;
  violations: string[];
  warnings: string[];
  overrides: Array<{
    rule: string;
    reason: string;
    approvedBy: string;
  }>;
}

interface AnalyticsResult {
  success: boolean;
  error?: string;
  scope?: string;
  scopeId?: string;
  period?: { start: Date; end: Date };
  metrics?: {
    totalExpenses: number;
    averageExpense: number;
    expenseCount: number;
    reimbursementRate: number;
    policyCompliance: number;
    topCategories: Array<{ category: string; amount: number; percentage: number }>;
    topVendors: Array<{ vendor: string; amount: number; count: number }>;
    spendingTrends: Array<{ date: Date; amount: number }>;
    categoryTrends: Record<string, Array<{ date: Date; amount: number }>>;
  };
  benchmarks?: {
    industry: { averageExpense: number; topCategories: string[]; complianceRate: number };
    internal: { averageExpense: number; topCategories: string[]; complianceRate: number };
  };
  insights?: Array<{
    type: string;
    title: string;
    description: string;
    impact: number;
    recommendation: string;
    priority: string;
  }>;
  generatedAt?: number;
}

export const expenseManagementManager = new ExpenseManagementManager();