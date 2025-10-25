export interface Supplier {
  id: string;
  name: string;
  contactInfo: {
    email: string;
    phone: string;
    address: string;
  };
  categories: string[];
  rating: number;
  leadTime: number; // days
  minimumOrder: number;
  paymentTerms: string;
  active: boolean;
}

export interface ProcurementItem {
  id: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  unitCost: number;
  suppliers: string[]; // supplier IDs
  minimumStock: number;
  maximumStock: number;
  currentStock: number;
  reorderPoint: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  items: PurchaseOrderItem[];
  status: 'draft' | 'pending_approval' | 'approved' | 'ordered' | 'received' | 'cancelled';
  totalAmount: number;
  taxAmount: number;
  shippingCost: number;
  orderDate: Date;
  expectedDelivery: Date;
  actualDelivery?: Date;
  approvedBy?: string;
  approvedDate?: Date;
  notes?: string;
}

export interface PurchaseOrderItem {
  itemId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  receivedQuantity: number;
  status: 'pending' | 'partial' | 'received' | 'cancelled';
}

export interface ProcurementRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  priority: number;
  enabled: boolean;
}

export interface ProcurementMetrics {
  totalSpend: number;
  averageOrderValue: number;
  supplierPerformance: Record<string, number>;
  onTimeDeliveryRate: number;
  orderCycleTime: number;
  costSavings: number;
}

export class ProcurementAutomation {
  private suppliers: Map<string, Supplier> = new Map();
  private items: Map<string, ProcurementItem> = new Map();
  private purchaseOrders: Map<string, PurchaseOrder> = new Map();
  private rules: Map<string, ProcurementRule> = new Map();

  constructor() {}

  // Supplier Management
  addSupplier(supplier: Omit<Supplier, 'id'>): Supplier {
    const newSupplier: Supplier = {
      ...supplier,
      id: `supplier-${Date.now()}`
    };

    this.suppliers.set(newSupplier.id, newSupplier);
    return newSupplier;
  }

  updateSupplier(supplierId: string, updates: Partial<Supplier>): Supplier | null {
    const supplier = this.suppliers.get(supplierId);
    if (!supplier) return null;

    const updatedSupplier = { ...supplier, ...updates };
    this.suppliers.set(supplierId, updatedSupplier);
    return updatedSupplier;
  }

  getSupplier(supplierId: string): Supplier | undefined {
    return this.suppliers.get(supplierId);
  }

  getAllSuppliers(): Supplier[] {
    return Array.from(this.suppliers.values());
  }

  getSuppliersByCategory(category: string): Supplier[] {
    return this.getAllSuppliers().filter(supplier =>
      supplier.categories.includes(category) && supplier.active
    );
  }

  // Item Management
  addProcurementItem(item: Omit<ProcurementItem, 'id'>): ProcurementItem {
    const newItem: ProcurementItem = {
      ...item,
      id: `item-${Date.now()}`
    };

    this.items.set(newItem.id, newItem);
    return newItem;
  }

  updateProcurementItem(itemId: string, updates: Partial<ProcurementItem>): ProcurementItem | null {
    const item = this.items.get(itemId);
    if (!item) return null;

    const updatedItem = { ...item, ...updates };
    this.items.set(itemId, updatedItem);
    return updatedItem;
  }

  getProcurementItem(itemId: string): ProcurementItem | undefined {
    return this.items.get(itemId);
  }

  getAllProcurementItems(): ProcurementItem[] {
    return Array.from(this.items.values());
  }

  getLowStockItems(): ProcurementItem[] {
    return this.getAllProcurementItems().filter(item =>
      item.currentStock <= item.reorderPoint
    );
  }

  // Purchase Order Management
  createPurchaseOrder(poData: Omit<PurchaseOrder, 'id' | 'poNumber' | 'totalAmount' | 'taxAmount' | 'shippingCost'>): PurchaseOrder {
    const poNumber = this.generatePONumber();
    const totalAmount = this.calculateTotalAmount(poData.items);
    const taxAmount = totalAmount * 0.1; // 10% tax
    const shippingCost = this.calculateShippingCost(poData.supplierId, totalAmount);

    const purchaseOrder: PurchaseOrder = {
      ...poData,
      id: `po-${Date.now()}`,
      poNumber,
      totalAmount,
      taxAmount,
      shippingCost,
      orderDate: new Date()
    };

    this.purchaseOrders.set(purchaseOrder.id, purchaseOrder);

    // Apply automation rules
    this.applyProcurementRules(purchaseOrder);

    return purchaseOrder;
  }

  updatePurchaseOrder(poId: string, updates: Partial<PurchaseOrder>): PurchaseOrder | null {
    const po = this.purchaseOrders.get(poId);
    if (!po) return null;

    const updatedPO = { ...po, ...updates };
    this.purchaseOrders.set(poId, updatedPO);
    return updatedPO;
  }

  approvePurchaseOrder(poId: string, approverId: string): boolean {
    const po = this.purchaseOrders.get(poId);
    if (!po || po.status !== 'pending_approval') return false;

    po.status = 'approved';
    po.approvedBy = approverId;
    po.approvedDate = new Date();

    return true;
  }

  receivePurchaseOrder(poId: string, receivedItems: Record<string, number>): boolean {
    const po = this.purchaseOrders.get(poId);
    if (!po || po.status !== 'ordered') return false;

    // Update received quantities
    po.items.forEach(item => {
      const receivedQty = receivedItems[item.itemId] || 0;
      item.receivedQuantity = receivedQty;
      item.status = receivedQty >= item.quantity ? 'received' :
                   receivedQty > 0 ? 'partial' : 'pending';

      // Update inventory
      const procurementItem = this.items.get(item.itemId);
      if (procurementItem) {
        procurementItem.currentStock += receivedQty;
      }
    });

    // Check if all items received
    const allReceived = po.items.every(item => item.status === 'received');
    if (allReceived) {
      po.status = 'received';
      po.actualDelivery = new Date();
    }

    return true;
  }

  getPurchaseOrder(poId: string): PurchaseOrder | undefined {
    return this.purchaseOrders.get(poId);
  }

  getAllPurchaseOrders(): PurchaseOrder[] {
    return Array.from(this.purchaseOrders.values());
  }

  getPurchaseOrdersByStatus(status: PurchaseOrder['status']): PurchaseOrder[] {
    return this.getAllPurchaseOrders().filter(po => po.status === status);
  }

  // Automation Rules
  addProcurementRule(rule: Omit<ProcurementRule, 'id'>): ProcurementRule {
    const newRule: ProcurementRule = {
      ...rule,
      id: `rule-${Date.now()}`
    };

    this.rules.set(newRule.id, newRule);
    return newRule;
  }

  applyProcurementRules(purchaseOrder: PurchaseOrder): void {
    const activeRules = Array.from(this.rules.values())
      .filter(rule => rule.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of activeRules) {
      if (this.evaluateRuleCondition(rule.condition, purchaseOrder)) {
        this.executeRuleAction(rule.action, purchaseOrder);
      }
    }
  }

  private evaluateRuleCondition(condition: string, po: PurchaseOrder): boolean {
    // Simple rule evaluation - in production, use a proper expression evaluator
    try {
      // Example conditions:
      // "totalAmount > 1000"
      // "supplier.rating < 3"
      // "items.length > 5"

      const context = {
        totalAmount: po.totalAmount,
        itemCount: po.items.length,
        supplier: this.suppliers.get(po.supplierId),
        items: po.items
      };

      // Simple evaluation for demo
      if (condition.includes('totalAmount >')) {
        const threshold = parseFloat(condition.split('>')[1]);
        return po.totalAmount > threshold;
      }

      if (condition.includes('itemCount >')) {
        const threshold = parseInt(condition.split('>')[1]);
        return po.items.length > threshold;
      }

      return false;
    } catch (error) {
      console.error('Error evaluating rule condition:', error);
      return false;
    }
  }

  private executeRuleAction(action: string, po: PurchaseOrder): void {
    // Simple action execution
    if (action === 'require_approval') {
      po.status = 'pending_approval';
    } else if (action === 'auto_approve') {
      po.status = 'approved';
    } else if (action === 'escalate') {
      // Send notification to manager
      console.log(`Escalating PO ${po.poNumber} for approval`);
    }
  }

  // Auto-replenishment
  generateReplenishmentOrders(): PurchaseOrder[] {
    const lowStockItems = this.getLowStockItems();
    const replenishmentOrders: PurchaseOrder[] = [];

    // Group items by supplier
    const itemsBySupplier = new Map<string, ProcurementItem[]>();

    lowStockItems.forEach(item => {
      item.suppliers.forEach(supplierId => {
        if (!itemsBySupplier.has(supplierId)) {
          itemsBySupplier.set(supplierId, []);
        }
        itemsBySupplier.get(supplierId)!.push(item);
      });
    });

    // Create POs for each supplier
    itemsBySupplier.forEach((items, supplierId) => {
      const poItems: PurchaseOrderItem[] = items.map(item => {
        const orderQuantity = Math.max(item.maximumStock - item.currentStock, 1);
        return {
          itemId: item.id,
          quantity: orderQuantity,
          unitPrice: item.unitCost,
          totalPrice: orderQuantity * item.unitCost,
          receivedQuantity: 0,
          status: 'pending'
        };
      });

      const po = this.createPurchaseOrder({
        supplierId,
        items: poItems,
        status: 'draft',
        expectedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        orderDate: new Date()
      });

      replenishmentOrders.push(po);
    });

    return replenishmentOrders;
  }

  // Analytics and Reporting
  calculateMetrics(): ProcurementMetrics {
    const allPOs = this.getAllPurchaseOrders();
    const completedPOs = allPOs.filter(po => po.status === 'received');

    const totalSpend = completedPOs.reduce((sum, po) => sum + po.totalAmount, 0);
    const averageOrderValue = completedPOs.length > 0 ? totalSpend / completedPOs.length : 0;

    // Calculate supplier performance
    const supplierPerformance: Record<string, number> = {};
    this.suppliers.forEach(supplier => {
      const supplierPOs = completedPOs.filter(po => po.supplierId === supplier.id);
      if (supplierPOs.length > 0) {
        const onTimeDeliveries = supplierPOs.filter(po => {
          if (!po.actualDelivery || !po.expectedDelivery) return false;
          return po.actualDelivery <= po.expectedDelivery;
        }).length;
        supplierPerformance[supplier.id] = (onTimeDeliveries / supplierPOs.length) * 100;
      }
    });

    const onTimeDeliveryRate = completedPOs.length > 0
      ? (completedPOs.filter(po => {
          if (!po.actualDelivery || !po.expectedDelivery) return false;
          return po.actualDelivery <= po.expectedDelivery;
        }).length / completedPOs.length) * 100
      : 0;

    const orderCycleTime = completedPOs.length > 0
      ? completedPOs.reduce((sum, po) => {
          if (po.actualDelivery && po.orderDate) {
            return sum + (po.actualDelivery.getTime() - po.orderDate.getTime());
          }
          return sum;
        }, 0) / completedPOs.length / (1000 * 60 * 60 * 24) // Convert to days
      : 0;

    // Cost savings calculation (simplified)
    const costSavings = totalSpend * 0.05; // Assume 5% savings from optimization

    return {
      totalSpend,
      averageOrderValue,
      supplierPerformance,
      onTimeDeliveryRate,
      orderCycleTime,
      costSavings
    };
  }

  // Helper methods
  private generatePONumber(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const sequence = String(this.purchaseOrders.size + 1).padStart(4, '0');
    return `PO-${year}${month}-${sequence}`;
  }

  private calculateTotalAmount(items: PurchaseOrderItem[]): number {
    return items.reduce((sum, item) => sum + item.totalPrice, 0);
  }

  private calculateShippingCost(supplierId: string, totalAmount: number): number {
    const supplier = this.suppliers.get(supplierId);
    if (!supplier) return 0;

    // Simple shipping calculation
    const baseShipping = 10;
    const freeShippingThreshold = 100;
    return totalAmount >= freeShippingThreshold ? 0 : baseShipping;
  }

  // Getters
  getAllRules(): ProcurementRule[] {
    return Array.from(this.rules.values());
  }

  getLowStockAlerts(): Array<{ item: ProcurementItem; shortage: number }> {
    return this.getLowStockItems().map(item => ({
      item,
      shortage: item.reorderPoint - item.currentStock
    }));
  }
}

export const procurementAutomation = new ProcurementAutomation();