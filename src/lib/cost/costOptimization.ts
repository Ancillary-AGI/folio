import { Component } from '../../types';

export interface CostAnalysis {
  id: string;
  designId: string;
  componentCosts: Array<{
    componentId: string;
    unitCost: number;
    quantity: number;
    totalCost: number;
    supplier: string;
    leadTime: number; // days
    availability: 'high' | 'medium' | 'low';
  }>;
  manufacturingCosts: {
    assembly: number;
    testing: number;
    packaging: number;
    overhead: number;
  };
  totalCost: number;
  costBreakdown: {
    materials: number; // percentage
    labor: number; // percentage
    overhead: number; // percentage
    profit: number; // percentage
  };
  costDrivers: Array<{
    factor: string;
    impact: number; // percentage
    description: string;
  }>;
  optimizationOpportunities: Array<{
    type: 'component' | 'supplier' | 'process' | 'design';
    description: string;
    potentialSavings: number;
    implementationEffort: 'low' | 'medium' | 'high';
  }>;
  generated: Date;
}

export interface CostModel {
  id: string;
  name: string;
  type: 'parametric' | 'analogous' | 'bottom_up' | 'top_down';
  parameters: Record<string, any>;
  accuracy: number; // percentage
  confidence: number; // percentage
  lastUpdated: Date;
}

export interface SupplierDatabase {
  suppliers: Array<{
    id: string;
    name: string;
    location: string;
    capabilities: string[];
    certifications: string[];
    leadTimes: Record<string, number>; // component type -> days
    pricing: Record<string, number>; // component type -> cost
    reliability: number; // 1-10 scale
  }>;
  components: Array<{
    id: string;
    name: string;
    category: string;
    suppliers: Array<{
      supplierId: string;
      partNumber: string;
      price: number;
      moq: number; // minimum order quantity
      leadTime: number;
      availability: 'high' | 'medium' | 'low';
    }>;
  }>;
}

export class CostOptimizer {
  private costAnalyses: Map<string, CostAnalysis> = new Map();
  private costModels: Map<string, CostModel> = new Map();
  private supplierDatabase: SupplierDatabase;

  constructor() {
    this.supplierDatabase = this.initializeSupplierDatabase();
  }

  private initializeSupplierDatabase(): SupplierDatabase {
    return {
      suppliers: [
        {
          id: 'digikey',
          name: 'Digi-Key Electronics',
          location: ' Thief River Falls, MN, USA',
          capabilities: ['resistors', 'capacitors', 'ICs', 'discrete'],
          certifications: ['ISO 9001', 'ISO 14001'],
          leadTimes: { resistors: 2, capacitors: 3, ICs: 5, discrete: 2 },
          pricing: { resistors: 0.01, capacitors: 0.05, ICs: 1.0, discrete: 0.1 },
          reliability: 9
        },
        {
          id: 'mouser',
          name: 'Mouser Electronics',
          location: 'Mansfield, TX, USA',
          capabilities: ['resistors', 'capacitors', 'ICs', 'discrete', 'power'],
          certifications: ['ISO 9001', 'ISO 14001', 'REACH'],
          leadTimes: { resistors: 1, capacitors: 2, ICs: 4, discrete: 1, power: 7 },
          pricing: { resistors: 0.009, capacitors: 0.045, ICs: 0.95, discrete: 0.09, power: 2.0 },
          reliability: 9
        },
        {
          id: 'arrow',
          name: 'Arrow Electronics',
          location: 'Centennial, CO, USA',
          capabilities: ['ICs', 'discrete', 'power', 'RF'],
          certifications: ['ISO 9001', 'AS9120'],
          leadTimes: { ICs: 3, discrete: 2, power: 6, RF: 10 },
          pricing: { ICs: 0.9, discrete: 0.08, power: 1.8, RF: 5.0 },
          reliability: 8
        }
      ],
      components: [
        {
          id: 'res_10k',
          name: '10kΩ Resistor',
          category: 'resistor',
          suppliers: [
            { supplierId: 'digikey', partNumber: 'CF14JT10K0CT-ND', price: 0.01, moq: 100, leadTime: 2, availability: 'high' },
            { supplierId: 'mouser', partNumber: '603-CFR-25JB-52-10K', price: 0.009, moq: 200, leadTime: 1, availability: 'high' }
          ]
        },
        {
          id: 'cap_10uf',
          name: '10μF Capacitor',
          category: 'capacitor',
          suppliers: [
            { supplierId: 'digikey', partNumber: '445-1423-1-ND', price: 0.05, moq: 50, leadTime: 3, availability: 'high' },
            { supplierId: 'mouser', partNumber: '80-C322C106M5U5TA', price: 0.045, moq: 100, leadTime: 2, availability: 'high' }
          ]
        }
      ]
    };
  }

  analyzeDesignCosts(components: Component[], quantities: Record<string, number>): CostAnalysis {
    const componentCosts = components.map(component => {
      const suppliers = this.findComponentSuppliers(component);
      const bestSupplier = this.selectBestSupplier(suppliers, quantities[component.id] || 1);

      return {
        componentId: component.id,
        unitCost: bestSupplier.price,
        quantity: quantities[component.id] || 1,
        totalCost: bestSupplier.price * (quantities[component.id] || 1),
        supplier: this.supplierDatabase.suppliers.find(s => s.id === bestSupplier.supplierId)?.name || 'Unknown',
        leadTime: bestSupplier.leadTime,
        availability: bestSupplier.availability
      };
    });

    const totalComponentCost = componentCosts.reduce((sum, cost) => sum + cost.totalCost, 0);

    // Estimate manufacturing costs
    const assemblyCost = totalComponentCost * 0.3; // 30% of component cost
    const testingCost = totalComponentCost * 0.1; // 10% of component cost
    const packagingCost = totalComponentCost * 0.05; // 5% of component cost
    const overheadCost = totalComponentCost * 0.2; // 20% overhead

    const totalCost = totalComponentCost + assemblyCost + testingCost + packagingCost + overheadCost;

    // Identify cost drivers
    const costDrivers = this.identifyCostDrivers(componentCosts, totalCost);

    // Generate optimization opportunities
    const optimizationOpportunities = this.generateOptimizationOpportunities(componentCosts, totalCost);

    const analysis: CostAnalysis = {
      id: `cost_${Date.now()}`,
      designId: 'design_1',
      componentCosts,
      manufacturingCosts: {
        assembly: assemblyCost,
        testing: testingCost,
        packaging: packagingCost,
        overhead: overheadCost
      },
      totalCost,
      costBreakdown: {
        materials: (totalComponentCost / totalCost) * 100,
        labor: (assemblyCost / totalCost) * 100,
        overhead: ((testingCost + packagingCost + overheadCost) / totalCost) * 100,
        profit: 15 // Assume 15% profit margin
      },
      costDrivers,
      optimizationOpportunities,
      generated: new Date()
    };

    this.costAnalyses.set(analysis.id, analysis);
    return analysis;
  }

  private findComponentSuppliers(component: Component): SupplierDatabase['components'][0]['suppliers'] {
    // Find suppliers for this component
    const componentEntry = this.supplierDatabase.components.find(c =>
      c.name.toLowerCase().includes(component.name.toLowerCase()) ||
      c.category === component.category
    );

    if (componentEntry) {
      return componentEntry.suppliers;
    }

    // Fallback to category-based pricing
    const categorySuppliers = this.supplierDatabase.suppliers.filter(s =>
      s.capabilities.includes(component.category)
    );

    return categorySuppliers.map(supplier => ({
      supplierId: supplier.id,
      partNumber: `${component.name}_${supplier.id}`,
      price: supplier.pricing[component.category] || 0.1,
      moq: 100,
      leadTime: supplier.leadTimes[component.category] || 5,
      availability: 'medium' as const
    }));
  }

  private selectBestSupplier(suppliers: SupplierDatabase['components'][0]['suppliers'], quantity: number): SupplierDatabase['components'][0]['suppliers'][0] {
    if (suppliers.length === 0) {
      return {
        supplierId: 'unknown',
        partNumber: 'unknown',
        price: 0.1,
        moq: 1,
        leadTime: 5,
        availability: 'low'
      };
    }

    // Select supplier based on total cost including MOQ considerations
    return suppliers.reduce((best, current) => {
      const currentTotalCost = quantity >= current.moq ?
        current.price * quantity :
        current.price * current.moq; // Pay for MOQ even if not ordering that much

      const bestTotalCost = quantity >= best.moq ?
        best.price * quantity :
        best.price * best.moq;

      return currentTotalCost < bestTotalCost ? current : best;
    });
  }

  private identifyCostDrivers(componentCosts: CostAnalysis['componentCosts'], totalCost: number): CostAnalysis['costDrivers'] {
    const drivers = [];

    // Find high-cost components
    const sortedCosts = componentCosts.sort((a, b) => b.totalCost - a.totalCost);
    const topCostComponents = sortedCosts.slice(0, 3);

    topCostComponents.forEach(cost => {
      if (cost.totalCost / totalCost > 0.1) { // >10% of total cost
        drivers.push({
          factor: `High-cost component: ${cost.componentId}`,
          impact: (cost.totalCost / totalCost) * 100,
          description: `Component ${cost.componentId} represents ${(cost.totalCost / totalCost * 100).toFixed(1)}% of total cost`
        });
      }
    });

    // Check for long lead times
    const longLeadTimes = componentCosts.filter(cost => cost.leadTime > 10);
    if (longLeadTimes.length > 0) {
      drivers.push({
        factor: 'Long component lead times',
        impact: 5, // Estimated impact on project timeline
        description: `${longLeadTimes.length} components have lead times > 10 days`
      });
    }

    // Check for low availability
    const lowAvailability = componentCosts.filter(cost => cost.availability === 'low');
    if (lowAvailability.length > 0) {
      drivers.push({
        factor: 'Low component availability',
        impact: 10, // Risk premium
        description: `${lowAvailability.length} components have low availability`
      });
    }

    return drivers;
  }

  private generateOptimizationOpportunities(componentCosts: CostAnalysis['componentCosts'], totalCost: number): CostAnalysis['optimizationOpportunities'] {
    const opportunities = [];

    // Component consolidation
    const uniqueComponents = new Set(componentCosts.map(c => c.componentId)).size;
    if (uniqueComponents > 20) {
      opportunities.push({
        type: 'component',
        description: `Consolidate ${uniqueComponents} unique components to reduce variety`,
        potentialSavings: totalCost * 0.05, // 5% savings
        implementationEffort: 'medium'
      });
    }

    // Supplier optimization
    const supplierCount = new Set(componentCosts.map(c => c.supplier)).size;
    if (supplierCount > 3) {
      opportunities.push({
        type: 'supplier',
        description: `Reduce from ${supplierCount} suppliers to improve volume discounts`,
        potentialSavings: totalCost * 0.03, // 3% savings
        implementationEffort: 'low'
      });
    }

    // Process optimization
    opportunities.push({
      type: 'process',
      description: 'Switch to surface mount technology for cost reduction',
      potentialSavings: totalCost * 0.1, // 10% savings
      implementationEffort: 'high'
    });

    // Design optimization
    const highCostComponents = componentCosts.filter(c => c.totalCost > totalCost * 0.05);
    if (highCostComponents.length > 0) {
      opportunities.push({
        type: 'design',
        description: 'Replace high-cost components with lower-cost alternatives',
        potentialSavings: highCostComponents.reduce((sum, c) => sum + c.totalCost, 0) * 0.2, // 20% reduction on high-cost components
        implementationEffort: 'medium'
      });
    }

    return opportunities;
  }

  createCostModel(name: string, type: CostModel['type'], parameters: Record<string, any>): CostModel {
    const model: CostModel = {
      id: `model_${Date.now()}`,
      name,
      type,
      parameters,
      accuracy: 85, // Estimated accuracy
      confidence: 80, // Estimated confidence
      lastUpdated: new Date()
    };

    this.costModels.set(model.id, model);
    return model;
  }

  estimateCostUsingModel(model: CostModel, designParameters: Record<string, any>): number {
    switch (model.type) {
      case 'parametric':
        return this.parametricCostEstimation(model.parameters, designParameters);

      case 'analogous':
        return this.analogousCostEstimation(model.parameters, designParameters);

      case 'bottom_up':
        return this.bottomUpCostEstimation(model.parameters, designParameters);

      case 'top_down':
        return this.topDownCostEstimation(model.parameters, designParameters);

      default:
        return 0;
    }
  }

  private parametricCostEstimation(modelParams: Record<string, any>, designParams: Record<string, any>): number {
    // Simple parametric model: cost = a * (size)^b * (complexity)^c
    const a = modelParams.a || 1.0;
    const b = modelParams.b || 0.5;
    const c = modelParams.c || 0.3;

    const size = designParams.componentCount || 10;
    const complexity = designParams.complexity || 1;

    return a * Math.pow(size, b) * Math.pow(complexity, c);
  }

  private analogousCostEstimation(modelParams: Record<string, any>, designParams: Record<string, any>): number {
    // Use historical data for similar designs
    const similarDesigns = modelParams.similarDesigns || [];
    if (similarDesigns.length === 0) return 0;

    const averageCost = similarDesigns.reduce((sum: number, design: any) => sum + design.cost, 0) / similarDesigns.length;

    // Adjust based on design parameters
    const sizeRatio = (designParams.componentCount || 10) / 10; // Normalize to 10 components
    const complexityRatio = designParams.complexity || 1;

    return averageCost * sizeRatio * complexityRatio;
  }

  private bottomUpCostEstimation(modelParams: Record<string, any>, designParams: Record<string, any>): number {
    // Sum individual component costs
    const componentCosts = modelParams.componentCosts || [];
    return componentCosts.reduce((sum: number, cost: number) => sum + cost, 0);
  }

  private topDownCostEstimation(modelParams: Record<string, any>, designParams: Record<string, any>): number {
    // Allocate total budget to components
    const totalBudget = modelParams.totalBudget || 1000;
    const componentCount = designParams.componentCount || 10;

    return totalBudget / componentCount; // Per component cost
  }

  optimizeForCost(analysis: CostAnalysis, constraints: { maxCost: number; targetCost: number }): {
    optimizedAnalysis: CostAnalysis;
    changes: Array<{
      componentId: string;
      originalCost: number;
      newCost: number;
      savings: number;
    }>;
    totalSavings: number;
  } {
    const optimized = { ...analysis };
    const changes = [];

    // Sort components by cost impact
    const sortedComponents = [...analysis.componentCosts].sort((a, b) => b.totalCost - a.totalCost);

    let totalSavings = 0;
    const maxSavingsNeeded = analysis.totalCost - constraints.targetCost;

    for (const component of sortedComponents) {
      if (totalSavings >= maxSavingsNeeded) break;

      // Try to find cheaper alternative
      const alternative = this.findCheaperAlternative(component);
      if (alternative) {
        const savings = component.totalCost - alternative.totalCost;
        if (savings > 0) {
          changes.push({
            componentId: component.componentId,
            originalCost: component.totalCost,
            newCost: alternative.totalCost,
            savings
          });

          // Update optimized analysis
          const index = optimized.componentCosts.findIndex(c => c.componentId === component.componentId);
          if (index !== -1) {
            optimized.componentCosts[index] = alternative;
          }

          totalSavings += savings;
        }
      }
    }

    // Recalculate totals
    optimized.totalCost = optimized.componentCosts.reduce((sum, cost) => sum + cost.totalCost, 0) +
                         Object.values(optimized.manufacturingCosts).reduce((sum, cost) => sum + cost, 0);

    return {
      optimizedAnalysis: optimized,
      changes,
      totalSavings
    };
  }

  private findCheaperAlternative(component: CostAnalysis['componentCosts'][0]): CostAnalysis['componentCosts'][0] | null {
    // Look for cheaper supplier or alternative component
    const suppliers = this.findComponentSuppliers({ id: component.componentId, name: '', category: '', symbol: { width: 0, height: 0, paths: [] }, pins: [], properties: {} });

    const cheaperSupplier = suppliers
      .filter(s => s.price < component.unitCost)
      .sort((a, b) => a.price - b.price)[0];

    if (cheaperSupplier) {
      return {
        ...component,
        unitCost: cheaperSupplier.price,
        totalCost: cheaperSupplier.price * component.quantity,
        supplier: this.supplierDatabase.suppliers.find(s => s.id === cheaperSupplier.supplierId)?.name || 'Unknown',
        leadTime: cheaperSupplier.leadTime,
        availability: cheaperSupplier.availability
      };
    }

    return null;
  }

  getCostAnalysis(id: string): CostAnalysis | undefined {
    return this.costAnalyses.get(id);
  }

  getCostModel(id: string): CostModel | undefined {
    return this.costModels.get(id);
  }

  getAllCostAnalyses(): CostAnalysis[] {
    return Array.from(this.costAnalyses.values());
  }

  getAllCostModels(): CostModel[] {
    return Array.from(this.costModels.values());
  }
}

export const costOptimizer = new CostOptimizer();