import React, { useState, useEffect } from 'react';
import { procurementAutomation, Supplier, ProcurementItem, PurchaseOrder, ProcurementMetrics } from '../../lib/procurement/procurementAutomation';
import { inventoryManagement, InventoryItem } from '../../lib/inventory/inventoryManagement';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Badge } from '../ui/badge';

export const ProcurementDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<ProcurementItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [metrics, setMetrics] = useState<ProcurementMetrics | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setSuppliers(procurementAutomation.getAllSuppliers());
    setItems(procurementAutomation.getAllProcurementItems());
    setPurchaseOrders(procurementAutomation.getAllPurchaseOrders());
    setInventoryItems(inventoryManagement.getAllInventoryItems());
    setMetrics(procurementAutomation.calculateMetrics());
  };

  const addSupplier = () => {
    procurementAutomation.addSupplier({
      name: 'New Supplier',
      contactInfo: {
        email: 'contact@supplier.com',
        phone: '+1234567890',
        address: '123 Supplier St'
      },
      categories: ['electronics'],
      rating: 4.5,
      leadTime: 7,
      minimumOrder: 100,
      paymentTerms: 'Net 30',
      active: true
    });
    loadData();
  };

  const addProcurementItem = () => {
    procurementAutomation.addProcurementItem({
      name: 'New Item',
      description: 'Item description',
      category: 'electronics',
      unit: 'pcs',
      unitCost: 10.0,
      suppliers: [],
      minimumStock: 10,
      maximumStock: 100,
      currentStock: 50,
      reorderPoint: 20
    });
    loadData();
  };

  const createPurchaseOrder = () => {
    const lowStockItems = procurementAutomation.getLowStockItems();
    if (lowStockItems.length === 0) return;

    const poItems = lowStockItems.slice(0, 3).map(item => ({
      itemId: item.id,
      quantity: Math.max(item.maximumStock - item.currentStock, 10),
      unitPrice: item.unitCost,
      totalPrice: 0, // Will be calculated
      receivedQuantity: 0,
      status: 'pending' as const
    }));

    procurementAutomation.createPurchaseOrder({
      supplierId: suppliers[0]?.id || '',
      items: poItems,
      status: 'draft',
      expectedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      orderDate: new Date()
    });
    loadData();
  };

  const generateReplenishmentOrders = () => {
    procurementAutomation.generateReplenishmentOrders();
    loadData();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'draft': return 'bg-gray-500';
      case 'pending_approval': return 'bg-yellow-500';
      case 'approved': return 'bg-blue-500';
      case 'ordered': return 'bg-purple-500';
      case 'received': return 'bg-green-500';
      case 'cancelled': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="w-full h-full p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Procurement & Inventory Management</h1>
        <div className="flex gap-2">
          <Button onClick={addSupplier}>Add Supplier</Button>
          <Button onClick={addProcurementItem}>Add Item</Button>
          <Button onClick={createPurchaseOrder}>Create PO</Button>
          <Button onClick={generateReplenishmentOrders}>Auto Replenish</Button>
        </div>
      </div>

      {metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">${metrics.totalSpend.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">Total Spend</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">${metrics.averageOrderValue.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">Avg Order Value</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.onTimeDeliveryRate.toFixed(1)}%</div>
              <div className="text-sm text-muted-foreground">On-Time Delivery</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{metrics.orderCycleTime.toFixed(1)}d</div>
              <div className="text-sm text-muted-foreground">Cycle Time</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="suppliers" className="space-y-4">
          <div className="grid gap-4">
            {suppliers.map(supplier => (
              <Card key={supplier.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{supplier.name}</h3>
                      <p className="text-sm text-muted-foreground">{supplier.contactInfo.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Rating: {supplier.rating}/5 • Lead Time: {supplier.leadTime} days
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={supplier.active ? 'default' : 'secondary'}>
                        {supplier.active ? 'Active' : 'Inactive'}
                      </Badge>
                      <span className="text-sm font-medium">${supplier.minimumOrder} min order</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="items" className="space-y-4">
          <div className="grid gap-4">
            {items.map(item => (
              <Card key={item.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{item.name}</h3>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                      <p className="text-xs text-muted-foreground">
                        Stock: {item.currentStock}/{item.maximumStock} • Reorder: {item.reorderPoint}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={item.currentStock <= item.reorderPoint ? 'destructive' : 'default'}>
                        {item.currentStock <= item.reorderPoint ? 'Low Stock' : 'In Stock'}
                      </Badge>
                      <span className="text-sm font-medium">${item.unitCost}/{item.unit}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="orders" className="space-y-4">
          <div className="grid gap-4">
            {purchaseOrders.map(po => (
              <Card key={po.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{po.poNumber}</h3>
                      <p className="text-sm text-muted-foreground">
                        Supplier: {suppliers.find(s => s.id === po.supplierId)?.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Items: {po.items.length} • Total: ${po.totalAmount.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs ${getStatusColor(po.status)} text-white`}>
                        {po.status.replace('_', ' ')}
                      </span>
                      <span className="text-sm font-medium">
                        {po.expectedDelivery.toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="inventory" className="space-y-4">
          <div className="grid gap-4">
            {inventoryItems.map(item => (
              <Card key={item.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">{item.name}</h3>
                      <p className="text-sm text-muted-foreground">{item.sku} • {item.location}</p>
                      <p className="text-xs text-muted-foreground">
                        Stock: {item.currentStock}/{item.maximumStock} • Min: {item.minimumStock}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={item.currentStock <= item.minimumStock ? 'destructive' : 'default'}>
                        {item.currentStock <= item.minimumStock ? 'Low Stock' : 'OK'}
                      </Badge>
                      <span className="text-sm font-medium">${item.unitCost} cost</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};