export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  category: string;
  sku: string;
  barcode?: string;
  unit: string;
  unitCost: number;
  unitPrice: number;
  currentStock: number;
  minimumStock: number;
  maximumStock: number;
  reorderPoint: number;
  location: string;
  supplierId?: string;
  lastRestocked: Date;
  expiryDate?: Date;
  batchNumber?: string;
  serialNumbers: string[];
  tags: string[];
  active: boolean;
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  type: 'inbound' | 'outbound' | 'adjustment' | 'transfer';
  quantity: number;
  previousStock: number;
  newStock: number;
  reference: string; // PO number, SO number, etc.
  reason?: string;
  performedBy: string;
  timestamp: Date;
  location?: string;
  cost?: number;
}

export interface InventoryLocation {
  id: string;
  name: string;
  type: 'warehouse' | 'store' | 'shelf' | 'bin';
  capacity: number;
  currentOccupancy: number;
  parentLocation?: string;
  temperature?: number;
  humidity?: number;
  securityLevel: 'low' | 'medium' | 'high';
}

export interface InventoryAlert {
  id: string;
  type: 'low_stock' | 'out_of_stock' | 'overstock' | 'expiry' | 'damaged';
  itemId: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  acknowledged: boolean;
  timestamp: Date;
}

export interface InventoryReport {
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiringItems: number;
  turnoverRate: number;
  stockAccuracy: number;
  carryingCost: number;
}

export class InventoryManagement {
  private items: Map<string, InventoryItem> = new Map();
  private transactions: Map<string, InventoryTransaction> = new Map();
  private locations: Map<string, InventoryLocation> = new Map();
  private alerts: Map<string, InventoryAlert> = new Map();

  constructor() {}

  // Item Management
  addInventoryItem(item: Omit<InventoryItem, 'id'>): InventoryItem {
    const newItem: InventoryItem = {
      ...item,
      id: `item-${Date.now()}`
    };

    this.items.set(newItem.id, newItem);
    this.checkInventoryAlerts(newItem);
    return newItem;
  }

  updateInventoryItem(itemId: string, updates: Partial<InventoryItem>): InventoryItem | null {
    const item = this.items.get(itemId);
    if (!item) return null;

    const updatedItem = { ...item, ...updates };
    this.items.set(itemId, updatedItem);
    this.checkInventoryAlerts(updatedItem);
    return updatedItem;
  }

  getInventoryItem(itemId: string): InventoryItem | undefined {
    return this.items.get(itemId);
  }

  getAllInventoryItems(): InventoryItem[] {
    return Array.from(this.items.values()).filter(item => item.active);
  }

  getItemsByCategory(category: string): InventoryItem[] {
    return this.getAllInventoryItems().filter(item => item.category === category);
  }

  getItemsByLocation(location: string): InventoryItem[] {
    return this.getAllInventoryItems().filter(item => item.location === location);
  }

  // Stock Management
  adjustStock(itemId: string, quantity: number, type: InventoryTransaction['type'],
              reference: string, performedBy: string, reason?: string): boolean {
    const item = this.items.get(itemId);
    if (!item) return false;

    const previousStock = item.currentStock;
    const newStock = previousStock + quantity;

    // Prevent negative stock unless it's an adjustment
    if (newStock < 0 && type !== 'adjustment') {
      return false;
    }

    // Update item stock
    item.currentStock = newStock;
    item.lastRestocked = new Date();

    // Create transaction record
    const transaction: InventoryTransaction = {
      id: `txn-${Date.now()}`,
      itemId,
      type,
      quantity,
      previousStock,
      newStock,
      reference,
      reason,
      performedBy,
      timestamp: new Date(),
      location: item.location,
      cost: quantity > 0 ? quantity * item.unitCost : undefined
    };

    this.transactions.set(transaction.id, transaction);
    this.checkInventoryAlerts(item);

    return true;
  }

  transferStock(itemId: string, quantity: number, fromLocation: string, toLocation: string,
                performedBy: string, reference: string): boolean {
    const item = this.items.get(itemId);
    if (!item || item.location !== fromLocation) return false;

    // Check if destination location has capacity
    const toLocationObj = this.locations.get(toLocation);
    if (toLocationObj && toLocationObj.currentOccupancy + quantity > toLocationObj.capacity) {
      return false;
    }

    // Remove from source location
    if (!this.adjustStock(itemId, -quantity, 'transfer', reference, performedBy, `Transfer to ${toLocation}`)) {
      return false;
    }

    // Add to destination location
    item.location = toLocation;
    if (!this.adjustStock(itemId, quantity, 'transfer', reference, performedBy, `Transfer from ${fromLocation}`)) {
      // Rollback
      item.location = fromLocation;
      this.adjustStock(itemId, quantity, 'transfer', reference, performedBy, 'Rollback transfer');
      return false;
    }

    // Update location occupancy
    this.updateLocationOccupancy(fromLocation, -quantity);
    this.updateLocationOccupancy(toLocation, quantity);

    return true;
  }

  // Location Management
  addLocation(location: Omit<InventoryLocation, 'id'>): InventoryLocation {
    const newLocation: InventoryLocation = {
      ...location,
      id: `location-${Date.now()}`
    };

    this.locations.set(newLocation.id, newLocation);
    return newLocation;
  }

  updateLocationOccupancy(locationId: string, quantityChange: number): void {
    const location = this.locations.get(locationId);
    if (location) {
      location.currentOccupancy = Math.max(0, location.currentOccupancy + quantityChange);
    }
  }

  getLocation(locationId: string): InventoryLocation | undefined {
    return this.locations.get(locationId);
  }

  getAllLocations(): InventoryLocation[] {
    return Array.from(this.locations.values());
  }

  // Alert Management
  private checkInventoryAlerts(item: InventoryItem): void {
    // Clear existing alerts for this item
    const existingAlerts = Array.from(this.alerts.values())
      .filter(alert => alert.itemId === item.id && !alert.acknowledged);

    existingAlerts.forEach(alert => {
      this.alerts.delete(alert.id);
    });

    // Check for low stock
    if (item.currentStock <= item.reorderPoint && item.currentStock > 0) {
      this.createAlert('low_stock', item.id, `Low stock alert: ${item.name} has ${item.currentStock} units remaining`, 'medium');
    }

    // Check for out of stock
    if (item.currentStock <= 0) {
      this.createAlert('out_of_stock', item.id, `Out of stock: ${item.name} is depleted`, 'high');
    }

    // Check for overstock
    if (item.currentStock > item.maximumStock) {
      this.createAlert('overstock', item.id, `Overstock alert: ${item.name} has ${item.currentStock} units (max: ${item.maximumStock})`, 'low');
    }

    // Check for expiry
    if (item.expiryDate && item.expiryDate.getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000) { // 30 days
      const daysUntilExpiry = Math.ceil((item.expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      this.createAlert('expiry', item.id, `Expiry alert: ${item.name} expires in ${daysUntilExpiry} days`, 'high');
    }
  }

  private createAlert(type: InventoryAlert['type'], itemId: string, message: string, severity: InventoryAlert['severity']): void {
    const alert: InventoryAlert = {
      id: `alert-${Date.now()}`,
      type,
      itemId,
      message,
      severity,
      acknowledged: false,
      timestamp: new Date()
    };

    this.alerts.set(alert.id, alert);
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    return true;
  }

  getActiveAlerts(): InventoryAlert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.acknowledged);
  }

  getAlertsByType(type: InventoryAlert['type']): InventoryAlert[] {
    return this.getActiveAlerts().filter(alert => alert.type === type);
  }

  // Transaction History
  getTransactionHistory(itemId?: string, limit: number = 50): InventoryTransaction[] {
    let transactions = Array.from(this.transactions.values());

    if (itemId) {
      transactions = transactions.filter(txn => txn.itemId === itemId);
    }

    return transactions
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // Reporting
  generateInventoryReport(): InventoryReport {
    const items = this.getAllInventoryItems();
    const transactions = Array.from(this.transactions.values());

    const totalItems = items.length;
    const totalValue = items.reduce((sum, item) => sum + (item.currentStock * item.unitCost), 0);

    const lowStockItems = items.filter(item => item.currentStock <= item.reorderPoint && item.currentStock > 0).length;
    const outOfStockItems = items.filter(item => item.currentStock <= 0).length;

    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringItems = items.filter(item =>
      item.expiryDate && item.expiryDate <= thirtyDaysFromNow
    ).length;

    // Calculate turnover rate (simplified - items sold / average inventory)
    const outboundTransactions = transactions.filter(txn => txn.type === 'outbound');
    const totalOutbound = outboundTransactions.reduce((sum, txn) => sum + Math.abs(txn.quantity), 0);
    const avgInventory = items.reduce((sum, item) => sum + item.currentStock, 0) / items.length;
    const turnoverRate = avgInventory > 0 ? totalOutbound / avgInventory : 0;

    // Stock accuracy (simplified - assume 98% accuracy)
    const stockAccuracy = 98.5;

    // Carrying cost (simplified - 25% of inventory value per year)
    const carryingCost = totalValue * 0.25;

    return {
      totalItems,
      totalValue,
      lowStockItems,
      outOfStockItems,
      expiringItems,
      turnoverRate,
      stockAccuracy,
      carryingCost
    };
  }

  // Search and Filtering
  searchItems(query: string): InventoryItem[] {
    const lowercaseQuery = query.toLowerCase();
    return this.getAllInventoryItems().filter(item =>
      item.name.toLowerCase().includes(lowercaseQuery) ||
      item.description.toLowerCase().includes(lowercaseQuery) ||
      item.sku.toLowerCase().includes(lowercaseQuery) ||
      item.category.toLowerCase().includes(lowercaseQuery) ||
      item.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery))
    );
  }

  getItemsByStockLevel(level: 'low' | 'normal' | 'high'): InventoryItem[] {
    return this.getAllInventoryItems().filter(item => {
      switch (level) {
        case 'low':
          return item.currentStock <= item.reorderPoint;
        case 'normal':
          return item.currentStock > item.reorderPoint && item.currentStock <= item.maximumStock;
        case 'high':
          return item.currentStock > item.maximumStock;
        default:
          return false;
      }
    });
  }

  // Bulk Operations
  bulkAdjustStock(updates: Array<{ itemId: string; quantity: number; type: InventoryTransaction['type']; reference: string; performedBy: string }>): boolean {
    // Validate all updates first
    for (const update of updates) {
      const item = this.items.get(update.itemId);
      if (!item) return false;

      const newStock = item.currentStock + update.quantity;
      if (newStock < 0 && update.type !== 'adjustment') {
        return false;
      }
    }

    // Apply all updates
    for (const update of updates) {
      this.adjustStock(update.itemId, update.quantity, update.type, update.reference, update.performedBy);
    }

    return true;
  }

  // Forecasting
  forecastDemand(itemId: string, days: number = 30): number {
    const item = this.items.get(itemId);
    if (!item) return 0;

    // Get historical outbound transactions for the last 90 days
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const historicalTransactions = Array.from(this.transactions.values())
      .filter(txn => txn.itemId === itemId && txn.type === 'outbound' && txn.timestamp >= ninetyDaysAgo);

    if (historicalTransactions.length === 0) return 0;

    // Calculate average daily demand
    const totalDemand = historicalTransactions.reduce((sum, txn) => sum + Math.abs(txn.quantity), 0);
    const avgDailyDemand = totalDemand / 90;

    return Math.round(avgDailyDemand * days);
  }

  // Optimization
  optimizeInventoryLevels(): Array<{ itemId: string; recommendedStock: number; reason: string }> {
    const recommendations: Array<{ itemId: string; recommendedStock: number; reason: string }> = [];

    this.items.forEach(item => {
      if (!item.active) return;

      const forecastedDemand = this.forecastDemand(item.id, 30);

      // Safety stock calculation (simplified)
      const safetyStock = Math.max(item.minimumStock, Math.ceil(forecastedDemand * 0.2));

      if (item.currentStock < safetyStock) {
        recommendations.push({
          itemId: item.id,
          recommendedStock: safetyStock,
          reason: `Current stock (${item.currentStock}) below safety level (${safetyStock})`
        });
      } else if (item.currentStock > item.maximumStock) {
        recommendations.push({
          itemId: item.id,
          recommendedStock: item.maximumStock,
          reason: `Current stock (${item.currentStock}) exceeds maximum (${item.maximumStock})`
        });
      }
    });

    return recommendations;
  }
}

export const inventoryManagement = new InventoryManagement();