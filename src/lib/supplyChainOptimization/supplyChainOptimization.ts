import { Component } from '../../types';

export interface Supplier {
  id: string;
  name: string;
  category: 'component' | 'material' | 'service' | 'equipment' | 'logistics';
  contact: {
    primary: string;
    secondary?: string;
    address: string;
    phone: string;
    email: string;
  };
  performance: {
    quality: number; // 1-5 scale
    delivery: number; // 1-5 scale
    cost: number; // 1-5 scale
    responsiveness: number; // 1-5 scale
    overall: number; // composite score
    lastUpdated: Date;
  };
  certifications: Array<{
    type: string;
    issuer: string;
    issued: Date;
    expires: Date;
    status: 'active' | 'expired' | 'pending';
  }>;
  contracts: Array<{
    id: string;
    type: string;
    startDate: Date;
    endDate: Date;
    value: number;
    terms: string;
    status: 'active' | 'expired' | 'terminated';
  }>;
  risk: {
    level: 'low' | 'medium' | 'high' | 'critical';
    factors: string[];
    mitigation: string[];
    lastAssessment: Date;
  };
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'inactive' | 'blacklisted';
    tags: string[];
  };
}

export interface ProcurementAutomation {
  id: string;
  name: string;
  description: string;
  type: 'rfp' | 'rfq' | 'auction' | 'direct' | 'blanket' | 'framework';
  category: string;
  requirements: {
    items: Array<{
      description: string;
      quantity: number;
      specifications: Record<string, unknown>;
      delivery: Date;
      budget: number;
    }>;
    criteria: Array<{
      name: string;
      weight: number; // percentage
      type: 'quality' | 'cost' | 'delivery' | 'service' | 'compliance';
    }>;
  };
  suppliers: Array<{
    supplierId: string;
    invited: Date;
    responded: Date;
    bid: {
      total: number;
      breakdown: Record<string, number>;
      validUntil: Date;
    };
    evaluation: {
      scores: Record<string, number>;
      totalScore: number;
      rank: number;
      comments: string;
    };
  }>;
  timeline: {
    issued: Date;
    closing: Date;
    evaluation: Date;
    award?: Date;
    delivery: Date;
  };
  status: {
    current: 'draft' | 'issued' | 'evaluation' | 'awarded' | 'completed' | 'cancelled';
    progress: number; // percentage
    issues: string[];
    nextAction: string;
  };
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    approvedBy?: string;
    approvalDate?: Date;
    budget: number;
    actualSpend: number;
    tags: string[];
  };
}

export interface InventoryManagement {
  id: string;
  name: string;
  description: string;
  location: string;
  type: 'raw_material' | 'work_in_progress' | 'finished_goods' | 'spare_parts' | 'consumables';
  item: {
    sku: string;
    description: string;
    category: string;
    unit: string;
    unitCost: number;
    leadTime: number; // days
    safetyStock: number;
    reorderPoint: number;
    maxStock: number;
  };
  stock: {
    current: number;
    available: number; // current - reserved
    reserved: number;
    onOrder: number;
    inTransit: number;
    lastCount: Date;
    lastMovement: Date;
  };
  demand: {
    forecast: Array<{
      period: Date;
      quantity: number;
      confidence: number; // percentage
      method: string;
    }>;
    historical: Array<{
      period: Date;
      actual: number;
      forecast: number;
      accuracy: number;
    }>;
    seasonality: {
      pattern: string;
      amplitude: number;
      peak: string;
    };
  };
  optimization: {
    eoq: number; // economic order quantity
    reorderPoint: number;
    safetyStock: number;
    serviceLevel: number; // percentage
    stockoutCost: number;
    holdingCost: number;
  };
  alerts: Array<{
    type: 'low_stock' | 'overstock' | 'expiring' | 'quality_issue' | 'slow_moving';
    condition: string;
    threshold: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
    triggered: Date;
    acknowledged: boolean;
    resolved: boolean;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'inactive' | 'discontinued';
    tags: string[];
  };
}

export interface DemandForecasting {
  id: string;
  name: string;
  description: string;
  product: string;
  method: 'time_series' | 'regression' | 'machine_learning' | 'qualitative' | 'causal';
  data: {
    historical: Array<{
      period: Date;
      actual: number;
      factors: Record<string, number>; // external factors
    }>;
    external: Array<{
      factor: string;
      data: Array<{
        period: Date;
        value: number;
        impact: number; // correlation coefficient
      }>;
    }>;
  };
  model: {
    algorithm: string;
    parameters: Record<string, unknown>;
    training: {
      period: {
        start: Date;
        end: Date;
      };
      accuracy: number;
      error: number;
      lastTrained: Date;
    };
    validation: {
      method: string;
      metrics: {
        mae: number; // mean absolute error
        rmse: number; // root mean square error
        mape: number; // mean absolute percentage error
        rSquared: number;
      };
    };
  };
  forecast: Array<{
    period: Date;
    point: number;
    lowerBound: number;
    upperBound: number;
    confidence: number;
    factors: Record<string, number>;
  }>;
  scenarios: Array<{
    name: string;
    assumptions: Record<string, unknown>;
    forecast: Array<{
      period: Date;
      value: number;
    }>;
    probability: number;
  }>;
  alerts: Array<{
    condition: string;
    threshold: number;
    triggered: Date;
    severity: 'low' | 'medium' | 'high';
    action: string;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'active' | 'inactive' | 'archived';
    tags: string[];
  };
}

export interface ProductionPlanning {
  id: string;
  name: string;
  description: string;
  product: string;
  planning: {
    horizon: number; // days
    granularity: 'hour' | 'day' | 'week' | 'month';
    startDate: Date;
    endDate: Date;
  };
  demand: Array<{
    period: Date;
    quantity: number;
    confidence: number;
    source: string;
  }>;
  capacity: {
    available: Array<{
      resource: string;
      capacity: number;
      utilization: number;
      constraints: string[];
    }>;
    constraints: Array<{
      type: 'machine' | 'labor' | 'material' | 'facility';
      resource: string;
      limit: number;
      period: Date;
    }>;
  };
  schedule: Array<{
    operation: string;
    resource: string;
    start: Date;
    end: Date;
    quantity: number;
    status: 'planned' | 'confirmed' | 'in_progress' | 'completed';
    dependencies: string[];
  }>;
  optimization: {
    objective: 'minimize_cost' | 'maximize_throughput' | 'balance_utilization' | 'minimize_lateness';
    constraints: string[];
    solution: {
      totalCost: number;
      throughput: number;
      utilization: number;
      lateness: number;
      lastOptimized: Date;
    };
  };
  risks: Array<{
    risk: string;
    probability: number;
    impact: number;
    mitigation: string;
    owner: string;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    status: 'draft' | 'approved' | 'active' | 'completed';
    approvedBy?: string;
    approvalDate?: Date;
    tags: string[];
  };
}

export class SupplyChainOptimizationManager {
  private suppliers: Map<string, Supplier> = new Map();
  private procurements: Map<string, ProcurementAutomation> = new Map();
  private inventories: Map<string, InventoryManagement> = new Map();
  private forecasts: Map<string, DemandForecasting> = new Map();
  private plans: Map<string, ProductionPlanning> = new Map();

  createSupplier(supplier: Omit<Supplier, 'id'>): Supplier {
    const newSupplier: Supplier = {
      ...supplier,
      id: `supplier_${Date.now()}`
    };

    this.suppliers.set(newSupplier.id, newSupplier);
    return newSupplier;
  }

  createProcurementAutomation(procurement: Omit<ProcurementAutomation, 'id'>): ProcurementAutomation {
    const newProcurement: ProcurementAutomation = {
      ...procurement,
      id: `procurement_${Date.now()}`
    };

    this.procurements.set(newProcurement.id, newProcurement);
    return newProcurement;
  }

  createInventoryManagement(inventory: Omit<InventoryManagement, 'id'>): InventoryManagement {
    const newInventory: InventoryManagement = {
      ...inventory,
      id: `inventory_${Date.now()}`
    };

    this.inventories.set(newInventory.id, newInventory);
    return newInventory;
  }

  createDemandForecasting(forecast: Omit<DemandForecasting, 'id'>): DemandForecasting {
    const newForecast: DemandForecasting = {
      ...forecast,
      id: `forecast_${Date.now()}`
    };

    this.forecasts.set(newForecast.id, newForecast);
    return newForecast;
  }

  createProductionPlanning(plan: Omit<ProductionPlanning, 'id'>): ProductionPlanning {
    const newPlan: ProductionPlanning = {
      ...plan,
      id: `plan_${Date.now()}`
    };

    this.plans.set(newPlan.id, newPlan);
    return newPlan;
  }

  optimizeProcurement(procurementId: string): Promise<ProcurementResult> {
    return new Promise((resolve) => {
      const procurement = this.procurements.get(procurementId);
      if (!procurement) {
        resolve({ success: false, error: 'Procurement not found' });
        return;
      }

      // Simulate procurement optimization
      setTimeout(() => {
        const result = this.performProcurementOptimization(procurement);

        // Update procurement
        procurement.suppliers = result.suppliers;
        procurement.status.current = 'awarded';
        procurement.status.progress = 100;
        procurement.timeline.award = new Date();

        resolve({
          success: true,
          procurementId,
          winner: result.winner,
          savings: result.savings,
          suppliers: result.suppliers.length,
          optimizationTime: Date.now()
        });
      }, 5000 + Math.random() * 10000); // 5-15 seconds
    });
  }

  private performProcurementOptimization(procurement: ProcurementAutomation): {
    suppliers: ProcurementAutomation['suppliers'];
    winner: string;
    savings: number;
  } {
    // Simulate supplier responses and evaluation
    const suppliers: ProcurementAutomation['suppliers'] = procurement.requirements.items.map((item, index) => ({
      supplierId: `supplier_${index + 1}`,
      invited: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      responded: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      bid: {
        total: item.budget * (0.8 + Math.random() * 0.4), // 80-120% of budget
        breakdown: { material: item.budget * 0.7, labor: item.budget * 0.2, overhead: item.budget * 0.1 },
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      },
      evaluation: {
        scores: {
          quality: 3 + Math.random() * 2,
          cost: 3 + Math.random() * 2,
          delivery: 3 + Math.random() * 2,
          service: 3 + Math.random() * 2
        },
        totalScore: 0, // Will be calculated
        rank: 0, // Will be assigned
        comments: 'Good overall performance'
      }
    }));

    // Calculate total scores and ranks
    suppliers.forEach(supplier => {
      const weights = procurement.requirements.criteria.reduce((acc, criterion) => {
        acc[criterion.name.toLowerCase()] = criterion.weight / 100;
        return acc;
      }, {} as Record<string, number>);

      supplier.evaluation.totalScore =
        supplier.evaluation.scores.quality * (weights.quality || 0.25) +
        supplier.evaluation.scores.cost * (weights.cost || 0.25) +
        supplier.evaluation.scores.delivery * (weights.delivery || 0.25) +
        supplier.evaluation.scores.service * (weights.service || 0.25);
    });

    suppliers.sort((a, b) => b.evaluation.totalScore - a.evaluation.totalScore);
    suppliers.forEach((supplier, index) => {
      supplier.evaluation.rank = index + 1;
    });

    const winner = suppliers[0].supplierId;
    const originalBudget = procurement.requirements.items.reduce((sum, item) => sum + item.budget, 0);
    const winningBid = suppliers[0].bid.total;
    const savings = originalBudget - winningBid;

    return { suppliers, winner, savings };
  }

  optimizeInventory(inventoryId: string): Promise<InventoryResult> {
    return new Promise((resolve) => {
      const inventory = this.inventories.get(inventoryId);
      if (!inventory) {
        resolve({ success: false, error: 'Inventory not found' });
        return;
      }

      // Simulate inventory optimization
      setTimeout(() => {
        const result = this.performInventoryOptimization(inventory);

        // Update inventory
        inventory.optimization = result.optimization;
        inventory.stock.current = result.currentStock;

        resolve({
          success: true,
          inventoryId,
          eoq: result.optimization.eoq,
          reorderPoint: result.optimization.reorderPoint,
          savings: result.savings,
          optimizationTime: Date.now()
        });
      }, 3000 + Math.random() * 4000); // 3-7 seconds
    });
  }

  private performInventoryOptimization(inventory: InventoryManagement): {
    optimization: InventoryManagement['optimization'];
    currentStock: number;
    savings: number;
  } {
    const { item } = inventory;
    const annualDemand = inventory.demand.forecast.reduce((sum, f) => sum + f.quantity, 0);
    const orderingCost = 50; // per order
    const holdingCostRate = 0.2; // 20% of unit cost per year

    // Economic Order Quantity (EOQ)
    const eoq = Math.sqrt((2 * annualDemand * orderingCost) / (item.unitCost * holdingCostRate));

    // Reorder Point
    const leadTimeDemand = (item.leadTime / 365) * annualDemand;
    const safetyStock = leadTimeDemand * 0.5; // 50% safety factor
    const reorderPoint = leadTimeDemand + safetyStock;

    const serviceLevel = 95; // 95% service level

    // Calculate savings
    const currentOrderingCost = (annualDemand / item.reorderPoint) * orderingCost;
    const optimizedOrderingCost = (annualDemand / eoq) * orderingCost;
    const savings = currentOrderingCost - optimizedOrderingCost;

    const optimization: InventoryManagement['optimization'] = {
      eoq,
      reorderPoint,
      safetyStock,
      serviceLevel,
      stockoutCost: item.unitCost * 2, // Assume stockout cost is 2x unit cost
      holdingCost: item.unitCost * holdingCostRate
    };

    return { optimization, currentStock: inventory.stock.current, savings };
  }

  generateDemandForecast(forecastId: string): Promise<ForecastResult> {
    return new Promise((resolve) => {
      const forecast = this.forecasts.get(forecastId);
      if (!forecast) {
        resolve({ success: false, error: 'Forecast not found' });
        return;
      }

      // Simulate demand forecasting
      setTimeout(() => {
        const result = this.performDemandForecasting(forecast);

        // Update forecast
        forecast.forecast = result.forecast;
        forecast.model.validation.metrics = result.metrics;

        resolve({
          success: true,
          forecastId,
          periods: result.forecast.length,
          accuracy: result.metrics.mape,
          confidence: 95,
          forecastingTime: Date.now()
        });
      }, 4000 + Math.random() * 6000); // 4-10 seconds
    });
  }

  private performDemandForecasting(forecast: DemandForecasting): {
    forecast: DemandForecasting['forecast'];
    metrics: DemandForecasting['model']['validation']['metrics'];
  } {
    const historical = forecast.data.historical;
    const periods = 12; // 12 months forecast

    // Simple exponential smoothing forecast
    const alpha = 0.3; // smoothing parameter
    let lastValue = historical[historical.length - 1]?.actual || 0;

    const forecastData: DemandForecasting['forecast'] = [];
    for (let i = 1; i <= periods; i++) {
      const period = new Date();
      period.setMonth(period.getMonth() + i);

      const point = lastValue;
      const stdDev = Math.sqrt(historical.reduce((sum, h) => sum + Math.pow(h.actual - point, 2), 0) / historical.length);
      const confidence = 1.96; // 95% confidence

      forecastData.push({
        period,
        point,
        lowerBound: Math.max(0, point - confidence * stdDev),
        upperBound: point + confidence * stdDev,
        confidence: 95,
        factors: {}
      });

      lastValue = alpha * point + (1 - alpha) * lastValue;
    }

    // Calculate forecast accuracy metrics
    const metrics: DemandForecasting['model']['validation']['metrics'] = {
      mae: historical.reduce((sum, h, i) => {
        const forecast = i > 0 ? historical[i - 1].actual : h.actual;
        return sum + Math.abs(h.actual - forecast);
      }, 0) / historical.length,
      rmse: Math.sqrt(historical.reduce((sum, h, i) => {
        const forecast = i > 0 ? historical[i - 1].actual : h.actual;
        return sum + Math.pow(h.actual - forecast, 2);
      }, 0) / historical.length),
      mape: historical.reduce((sum, h, i) => {
        const forecast = i > 0 ? historical[i - 1].actual : h.actual;
        return sum + Math.abs((h.actual - forecast) / h.actual);
      }, 0) / historical.length * 100,
      rSquared: 0.85 // Simplified
    };

    return { forecast: forecastData, metrics };
  }

  optimizeProductionPlan(planId: string): Promise<PlanningResult> {
    return new Promise((resolve) => {
      const plan = this.plans.get(planId);
      if (!plan) {
        resolve({ success: false, error: 'Production plan not found' });
        return;
      }

      // Simulate production planning optimization
      setTimeout(() => {
        const result = this.performProductionOptimization(plan);

        // Update plan
        plan.schedule = result.schedule;
        plan.optimization.solution = result.solution;

        resolve({
          success: true,
          planId,
          utilization: result.solution.utilization,
          throughput: result.solution.throughput,
          costReduction: result.costReduction,
          optimizationTime: Date.now()
        });
      }, 6000 + Math.random() * 8000); // 6-14 seconds
    });
  }

  private performProductionOptimization(plan: ProductionPlanning): {
    schedule: ProductionPlanning['schedule'];
    solution: ProductionPlanning['optimization']['solution'];
    costReduction: number;
  } {
    const totalDemand = plan.demand.reduce((sum, d) => sum + d.quantity, 0);
    const availableCapacity = plan.capacity.available.reduce((sum, c) => sum + c.capacity, 0);

    // Generate optimized schedule
    const schedule: ProductionPlanning['schedule'] = plan.demand.map((demand, index) => ({
      operation: `Operation ${index + 1}`,
      resource: plan.capacity.available[index % plan.capacity.available.length].resource,
      start: demand.period,
      end: new Date(demand.period.getTime() + 8 * 60 * 60 * 1000), // 8 hours
      quantity: demand.quantity,
      status: 'planned',
      dependencies: index > 0 ? [`Operation ${index}`] : []
    }));

    const utilization = (totalDemand / availableCapacity) * 100;
    const throughput = totalDemand / plan.planning.horizon;
    const originalCost = totalDemand * 10; // Assume $10 per unit
    const optimizedCost = originalCost * 0.9; // 10% cost reduction
    const costReduction = originalCost - optimizedCost;

    const solution: ProductionPlanning['optimization']['solution'] = {
      totalCost: optimizedCost,
      throughput,
      utilization,
      lateness: 0, // Assume no lateness
      lastOptimized: new Date()
    };

    return { schedule, solution, costReduction };
  }

  getSupplier(id: string): Supplier | undefined {
    return this.suppliers.get(id);
  }

  getProcurementAutomation(id: string): ProcurementAutomation | undefined {
    return this.procurements.get(id);
  }

  getInventoryManagement(id: string): InventoryManagement | undefined {
    return this.inventories.get(id);
  }

  getDemandForecasting(id: string): DemandForecasting | undefined {
    return this.forecasts.get(id);
  }

  getProductionPlanning(id: string): ProductionPlanning | undefined {
    return this.plans.get(id);
  }

  getAllSuppliers(): Supplier[] {
    return Array.from(this.suppliers.values());
  }

  getAllProcurementAutomation(): ProcurementAutomation[] {
    return Array.from(this.procurements.values());
  }

  getAllInventoryManagement(): InventoryManagement[] {
    return Array.from(this.inventories.values());
  }

  getAllDemandForecasting(): DemandForecasting[] {
    return Array.from(this.forecasts.values());
  }

  getAllProductionPlanning(): ProductionPlanning[] {
    return Array.from(this.plans.values());
  }

  updateSupplier(id: string, updates: Partial<Supplier>): boolean {
    const supplier = this.suppliers.get(id);
    if (!supplier) return false;

    Object.assign(supplier, updates);
    supplier.metadata.updated = new Date();
    return true;
  }

  deleteSupplier(id: string): boolean {
    return this.suppliers.delete(id);
  }

  exportSupplyChainOptimizationConfiguration(): Record<string, unknown> {
    return {
      suppliers: Array.from(this.suppliers.values()),
      procurements: Array.from(this.procurements.values()),
      inventories: Array.from(this.inventories.values()),
      forecasts: Array.from(this.forecasts.values()),
      plans: Array.from(this.plans.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface ProcurementResult {
  success: boolean;
  error?: string;
  procurementId?: string;
  winner?: string;
  savings?: number;
  suppliers?: number;
  optimizationTime?: number;
}

interface InventoryResult {
  success: boolean;
  error?: string;
  inventoryId?: string;
  eoq?: number;
  reorderPoint?: number;
  savings?: number;
  optimizationTime?: number;
}

interface ForecastResult {
  success: boolean;
  error?: string;
  forecastId?: string;
  periods?: number;
  accuracy?: number;
  confidence?: number;
  forecastingTime?: number;
}

interface PlanningResult {
  success: boolean;
  error?: string;
  planId?: string;
  utilization?: number;
  throughput?: number;
  costReduction?: number;
  optimizationTime?: number;
}

export const supplyChainOptimizationManager = new SupplyChainOptimizationManager();