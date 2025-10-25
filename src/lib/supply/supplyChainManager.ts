import { Component } from '../../types';

export interface Supplier {
  id: string;
  name: string;
  location: string;
  contact: {
    email: string;
    phone: string;
    address: string;
  };
  capabilities: string[]; // Component categories they supply
  certifications: string[];
  performance: {
    onTimeDelivery: number; // percentage
    qualityRating: number; // 1-10 scale
    leadTime: number; // average days
    reliability: number; // 1-10 scale
  };
  pricing: Record<string, number>; // category -> markup percentage
  minimumOrder: Record<string, number>; // category -> MOQ
  status: 'active' | 'inactive' | 'blacklisted';
}

export interface SupplyChainNode {
  id: string;
  type: 'supplier' | 'manufacturer' | 'distributor' | 'warehouse';
  name: string;
  location: string;
  capacity: number;
  leadTime: number; // days
  cost: number; // per unit handling cost
  reliability: number; // 1-10 scale
}

export interface SupplyChainNetwork {
  id: string;
  name: string;
  nodes: SupplyChainNode[];
  connections: Array<{
    from: string;
    to: string;
    transportMode: 'air' | 'sea' | 'ground' | 'rail';
    leadTime: number;
    cost: number;
    reliability: number;
  }>;
  totalLeadTime: number;
  totalCost: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface InventoryItem {
  componentId: string;
  supplierId: string;
  quantity: number;
  location: string;
  status: 'available' | 'on_order' | 'backordered' | 'obsolete';
  lastUpdated: Date;
  expiryDate?: Date;
  cost: number;
  reorderPoint: number;
  safetyStock: number;
}

export interface ProcurementPlan {
  id: string;
  componentId: string;
  quantity: number;
  dueDate: Date;
  suppliers: Array<{
    supplierId: string;
    quantity: number;
    unitPrice: number;
    leadTime: number;
    totalCost: number;
  }>;
  status: 'draft' | 'approved' | 'ordered' | 'received' | 'cancelled';
  totalCost: number;
  riskAssessment: {
    supplierRisk: number;
    deliveryRisk: number;
    qualityRisk: number;
    overallRisk: number;
  };
}

export class SupplyChainManager {
  private suppliers: Map<string, Supplier> = new Map();
  private networks: Map<string, SupplyChainNetwork> = new Map();
  private inventory: Map<string, InventoryItem[]> = new Map();
  private procurementPlans: Map<string, ProcurementPlan> = new Map();

  constructor() {
    this.initializeDefaultSuppliers();
  }

  private initializeDefaultSuppliers(): void {
    const defaultSuppliers: Supplier[] = [
      {
        id: 'digikey',
        name: 'Digi-Key Electronics',
        location: 'Thief River Falls, MN, USA',
        contact: {
          email: 'sales@digikey.com',
          phone: '+1-218-681-6674',
          address: '701 Brooks Avenue South, Thief River Falls, MN 56701'
        },
        capabilities: ['resistors', 'capacitors', 'ICs', 'discrete', 'power'],
        certifications: ['ISO 9001', 'ISO 14001', 'REACH', 'RoHS'],
        performance: {
          onTimeDelivery: 98,
          qualityRating: 9,
          leadTime: 3,
          reliability: 9
        },
        pricing: { resistors: 5, capacitors: 8, ICs: 15, discrete: 10, power: 20 },
        minimumOrder: { resistors: 100, capacitors: 50, ICs: 25, discrete: 100, power: 10 },
        status: 'active'
      },
      {
        id: 'mouser',
        name: 'Mouser Electronics',
        location: 'Mansfield, TX, USA',
        contact: {
          email: 'sales@mouser.com',
          phone: '+1-817-804-3888',
          address: '1000 North Main Street, Mansfield, TX 76063'
        },
        capabilities: ['resistors', 'capacitors', 'ICs', 'discrete', 'power', 'RF'],
        certifications: ['ISO 9001', 'ISO 14001', 'REACH', 'RoHS'],
        performance: {
          onTimeDelivery: 97,
          qualityRating: 9,
          leadTime: 2,
          reliability: 9
        },
        pricing: { resistors: 4, capacitors: 7, ICs: 12, discrete: 8, power: 18, RF: 25 },
        minimumOrder: { resistors: 200, capacitors: 100, ICs: 50, discrete: 200, power: 25, RF: 10 },
        status: 'active'
      },
      {
        id: 'avnet',
        name: 'Avnet Inc.',
        location: 'Phoenix, AZ, USA',
        contact: {
          email: 'sales@avnet.com',
          phone: '+1-480-643-2000',
          address: '2211 South 47th Street, Phoenix, AZ 85034'
        },
        capabilities: ['ICs', 'power', 'RF', 'embedded'],
        certifications: ['ISO 9001', 'AS9120', 'ISO 14001'],
        performance: {
          onTimeDelivery: 95,
          qualityRating: 8,
          leadTime: 5,
          reliability: 8
        },
        pricing: { ICs: 10, power: 15, RF: 20, embedded: 18 },
        minimumOrder: { ICs: 100, power: 50, RF: 25, embedded: 10 },
        status: 'active'
      }
    ];

    defaultSuppliers.forEach(supplier => {
      this.suppliers.set(supplier.id, supplier);
    });
  }

  addSupplier(supplier: Supplier): void {
    this.suppliers.set(supplier.id, supplier);
  }

  createSupplyChainNetwork(name: string, nodes: SupplyChainNode[]): SupplyChainNetwork {
    const connections = this.generateConnections(nodes);

    const totalLeadTime = this.calculateTotalLeadTime(nodes, connections);
    const totalCost = this.calculateTotalCost(nodes, connections);
    const riskLevel = this.assessNetworkRisk(nodes, connections);

    const network: SupplyChainNetwork = {
      id: `network_${Date.now()}`,
      name,
      nodes,
      connections,
      totalLeadTime,
      totalCost,
      riskLevel
    };

    this.networks.set(network.id, network);
    return network;
  }

  private generateConnections(nodes: SupplyChainNode[]): SupplyChainNetwork['connections'] {
    const connections = [];

    // Create connections between adjacent nodes
    for (let i = 0; i < nodes.length - 1; i++) {
      const fromNode = nodes[i];
      const toNode = nodes[i + 1];

      connections.push({
        from: fromNode.id,
        to: toNode.id,
        transportMode: this.selectTransportMode(fromNode.location, toNode.location),
        leadTime: this.calculateTransportTime(fromNode.location, toNode.location),
        cost: this.calculateTransportCost(fromNode.location, toNode.location),
        reliability: 0.95 // 95% reliability
      });
    }

    return connections;
  }

  private selectTransportMode(fromLocation: string, toLocation: string): 'air' | 'sea' | 'ground' | 'rail' {
    // Simple transport mode selection based on distance
    const distance = this.calculateDistance(fromLocation, toLocation);

    if (distance > 5000) return 'air'; // Long distance
    if (distance > 1000) return 'sea'; // Medium-long distance
    if (distance > 200) return 'rail'; // Medium distance
    return 'ground'; // Short distance
  }

  private calculateTransportTime(fromLocation: string, toLocation: string): number {
    const distance = this.calculateDistance(fromLocation, toLocation);
    const mode = this.selectTransportMode(fromLocation, toLocation);

    switch (mode) {
      case 'air': return Math.ceil(distance / 800); // 800 km/day
      case 'sea': return Math.ceil(distance / 50); // 50 km/day
      case 'rail': return Math.ceil(distance / 100); // 100 km/day
      case 'ground': return Math.ceil(distance / 80); // 80 km/day
    }
  }

  private calculateTransportCost(fromLocation: string, toLocation: string): number {
    const distance = this.calculateDistance(fromLocation, toLocation);
    const mode = this.selectTransportMode(fromLocation, toLocation);

    const baseRates = {
      air: 5.0, // $5 per km
      sea: 0.1, // $0.10 per km
      rail: 0.5, // $0.50 per km
      ground: 1.0 // $1.00 per km
    };

    return distance * baseRates[mode];
  }

  private calculateDistance(fromLocation: string, toLocation: string): number {
    // Simplified distance calculation - in reality would use actual coordinates
    // Assume average distances for demonstration
    return 1000; // 1000 km average
  }

  private calculateTotalLeadTime(nodes: SupplyChainNode[], connections: SupplyChainNetwork['connections']): number {
    return connections.reduce((sum, conn) => sum + conn.leadTime, 0) +
           nodes.reduce((sum, node) => sum + node.leadTime, 0);
  }

  private calculateTotalCost(nodes: SupplyChainNode[], connections: SupplyChainNetwork['connections']): number {
    return connections.reduce((sum, conn) => sum + conn.cost, 0) +
           nodes.reduce((sum, node) => sum + node.cost, 0);
  }

  private assessNetworkRisk(nodes: SupplyChainNode[], connections: SupplyChainNetwork['connections']): 'low' | 'medium' | 'high' {
    const avgReliability = [...nodes, ...connections].reduce((sum, item) => sum + item.reliability, 0) /
                          (nodes.length + connections.length);

    if (avgReliability > 8.5) return 'low';
    if (avgReliability > 7.0) return 'medium';
    return 'high';
  }

  createProcurementPlan(componentId: string, quantity: number, dueDate: Date): ProcurementPlan {
    const suppliers = this.findSuitableSuppliers(componentId, quantity);

    const suppliersWithQuotes = suppliers.map(supplier => ({
      supplierId: supplier.id,
      quantity,
      unitPrice: this.getSupplierPrice(supplier, componentId),
      leadTime: supplier.performance.leadTime,
      totalCost: this.getSupplierPrice(supplier, componentId) * quantity
    }));

    const totalCost = suppliersWithQuotes.reduce((sum, s) => sum + s.totalCost, 0);

    const riskAssessment = this.assessProcurementRisk(suppliersWithQuotes, dueDate);

    const plan: ProcurementPlan = {
      id: `proc_${Date.now()}`,
      componentId,
      quantity,
      dueDate,
      suppliers: suppliersWithQuotes,
      status: 'draft',
      totalCost,
      riskAssessment
    };

    this.procurementPlans.set(plan.id, plan);
    return plan;
  }

  private findSuitableSuppliers(componentId: string, quantity: number): Supplier[] {
    // Find suppliers that can provide this component
    const componentCategory = this.getComponentCategory(componentId);

    return Array.from(this.suppliers.values()).filter(supplier =>
      supplier.status === 'active' &&
      supplier.capabilities.includes(componentCategory) &&
      quantity >= (supplier.minimumOrder[componentCategory] || 0)
    );
  }

  private getComponentCategory(componentId: string): string {
    // Simplified category determination - in reality would look up component details
    if (componentId.includes('res')) return 'resistors';
    if (componentId.includes('cap')) return 'capacitors';
    if (componentId.includes('ic') || componentId.includes('cpu') || componentId.includes('dsp')) return 'ICs';
    return 'discrete';
  }

  private getSupplierPrice(supplier: Supplier, componentId: string): number {
    const category = this.getComponentCategory(componentId);
    const basePrice = 1.0; // Assume $1 base price
    const markup = supplier.pricing[category] || 10;

    return basePrice * (1 + markup / 100);
  }

  private assessProcurementRisk(suppliers: ProcurementPlan['suppliers'], dueDate: Date): ProcurementPlan['riskAssessment'] {
    const supplierRisk = suppliers.length === 0 ? 10 :
                        suppliers.length === 1 ? 7 : 3;

    const maxLeadTime = Math.max(...suppliers.map(s => s.leadTime));
    const daysAvailable = (dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    const deliveryRisk = maxLeadTime > daysAvailable ? 8 : 3;

    const avgQuality = suppliers.reduce((sum, s) => {
      const supplier = this.suppliers.get(s.supplierId);
      return sum + (supplier?.performance.qualityRating || 5);
    }, 0) / suppliers.length;

    const qualityRisk = avgQuality < 7 ? 8 : 3;

    const overallRisk = (supplierRisk + deliveryRisk + qualityRisk) / 3;

    return {
      supplierRisk,
      deliveryRisk,
      qualityRisk,
      overallRisk
    };
  }

  updateInventory(componentId: string, supplierId: string, quantity: number, location: string): void {
    if (!this.inventory.has(componentId)) {
      this.inventory.set(componentId, []);
    }

    const items = this.inventory.get(componentId)!;
    const existingItem = items.find(item => item.supplierId === supplierId && item.location === location);

    if (existingItem) {
      existingItem.quantity += quantity;
      existingItem.lastUpdated = new Date();
    } else {
      items.push({
        componentId,
        supplierId,
        quantity,
        location,
        status: 'available',
        lastUpdated: new Date(),
        cost: this.getSupplierPrice(this.suppliers.get(supplierId)!, componentId),
        reorderPoint: 100,
        safetyStock: 50
      });
    }
  }

  checkInventory(componentId: string, requiredQuantity: number): {
    available: number;
    onOrder: number;
    canFulfill: boolean;
    recommendations: string[];
  } {
    const items = this.inventory.get(componentId) || [];
    const available = items
      .filter(item => item.status === 'available')
      .reduce((sum, item) => sum + item.quantity, 0);

    const onOrder = items
      .filter(item => item.status === 'on_order')
      .reduce((sum, item) => sum + item.quantity, 0);

    const canFulfill = available >= requiredQuantity;
    const recommendations = [];

    if (!canFulfill) {
      recommendations.push(`Order ${requiredQuantity - available} additional units`);
    }

    if (available < items.reduce((sum, item) => sum + item.reorderPoint, 0) / items.length) {
      recommendations.push('Inventory below reorder point - consider reordering');
    }

    return {
      available,
      onOrder,
      canFulfill,
      recommendations
    };
  }

  optimizeSupplyChain(networkId: string): {
    optimizedNetwork: SupplyChainNetwork;
    improvements: Array<{
      type: string;
      description: string;
      benefit: number;
    }>;
  } {
    const network = this.networks.get(networkId);
    if (!network) {
      throw new Error('Supply chain network not found');
    }

    const optimized = { ...network };
    const improvements = [];

    // Optimize transport modes
    optimized.connections = network.connections.map(conn => {
      const currentCost = conn.cost;
      const optimizedMode = this.optimizeTransportMode(conn);
      const newConn = { ...conn, transportMode: optimizedMode };

      newConn.leadTime = this.calculateTransportTime(
        network.nodes.find(n => n.id === conn.from)!.location,
        network.nodes.find(n => n.id === conn.to)!.location
      );

      newConn.cost = this.calculateTransportCost(
        network.nodes.find(n => n.id === conn.from)!.location,
        network.nodes.find(n => n.id === conn.to)!.location
      );

      if (newConn.cost < currentCost) {
        improvements.push({
          type: 'transport_optimization',
          description: `Changed transport mode for ${conn.from} -> ${conn.to}`,
          benefit: currentCost - newConn.cost
        });
      }

      return newConn;
    });

    // Recalculate totals
    optimized.totalLeadTime = this.calculateTotalLeadTime(optimized.nodes, optimized.connections);
    optimized.totalCost = this.calculateTotalCost(optimized.nodes, optimized.connections);

    return {
      optimizedNetwork: optimized,
      improvements
    };
  }

  private optimizeTransportMode(connection: SupplyChainNetwork['connections'][0]): 'air' | 'sea' | 'ground' | 'rail' {
    // Choose fastest reliable transport mode
    const modes: Array<'air' | 'sea' | 'ground' | 'rail'> = ['air', 'sea', 'rail', 'ground'];
    return modes[0]; // Prefer air for speed
  }

  generateSupplierScorecard(supplierId: string): {
    overallScore: number;
    categories: Record<string, number>;
    trends: Array<{
      period: string;
      score: number;
    }>;
    recommendations: string[];
  } {
    const supplier = this.suppliers.get(supplierId);
    if (!supplier) {
      throw new Error('Supplier not found');
    }

    const categories = {
      quality: supplier.performance.qualityRating,
      delivery: supplier.performance.onTimeDelivery / 10, // Convert percentage to 1-10 scale
      cost: 10 - (Object.values(supplier.pricing).reduce((a, b) => a + b, 0) / Object.values(supplier.pricing).length) / 10,
      reliability: supplier.performance.reliability
    };

    const overallScore = Object.values(categories).reduce((a, b) => a + b, 0) / Object.values(categories).length;

    // Mock trends data
    const trends = [
      { period: 'Q1', score: overallScore - 0.5 },
      { period: 'Q2', score: overallScore },
      { period: 'Q3', score: overallScore + 0.2 },
      { period: 'Q4', score: overallScore }
    ];

    const recommendations = [];
    if (categories.quality < 7) recommendations.push('Improve quality control processes');
    if (categories.delivery < 7) recommendations.push('Address delivery reliability issues');
    if (categories.cost > 8) recommendations.push('Competitive pricing may be available elsewhere');

    return {
      overallScore,
      categories,
      trends,
      recommendations
    };
  }

  getSupplier(id: string): Supplier | undefined {
    return this.suppliers.get(id);
  }

  getSupplyChainNetwork(id: string): SupplyChainNetwork | undefined {
    return this.networks.get(id);
  }

  getProcurementPlan(id: string): ProcurementPlan | undefined {
    return this.procurementPlans.get(id);
  }

  getAllSuppliers(): Supplier[] {
    return Array.from(this.suppliers.values());
  }

  getAllNetworks(): SupplyChainNetwork[] {
    return Array.from(this.networks.values());
  }

  getAllProcurementPlans(): ProcurementPlan[] {
    return Array.from(this.procurementPlans.values());
  }
}

export const supplyChainManager = new SupplyChainManager();