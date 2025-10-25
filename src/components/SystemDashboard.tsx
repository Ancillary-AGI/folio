import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

// Import all the major systems
import { arManager } from '../lib/augmentedReality/augmentedReality';
import { schematicToPcbConverter } from '../lib/schematicToPcb/schematicToPcbConverter';
import { agileManager } from '../lib/agile/agileManager';
import { procurementAutomation } from '../lib/procurement/procurementAutomation';
import { inventoryManagement } from '../lib/inventory/inventoryManagement';
import { cybersecurityTools } from '../lib/cybersecurity/cybersecurityTools';
import { iotDeviceManagement } from '../lib/iot/iotDeviceManagement';
import { quantumComputingSimulation } from '../lib/quantum/quantumComputingSimulation';
import { brainComputerInterfaces } from '../lib/brainComputer/brainComputerInterfaces';
import { edgeComputing } from '../lib/edgeComputing/edgeComputing';

interface SystemMetrics {
  totalProjects: number;
  activeUsers: number;
  systemHealth: number;
  alertsCount: number;
  performanceScore: number;
}

export const SystemDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [metrics, setMetrics] = useState<SystemMetrics>({
    totalProjects: 0,
    activeUsers: 0,
    systemHealth: 95,
    alertsCount: 0,
    performanceScore: 92
  });

  useEffect(() => {
    loadSystemMetrics();
  }, []);

  const loadSystemMetrics = () => {
    // Aggregate metrics from all systems
    const arSessions = arManager.getAllSessions().length;
    const pcbLayouts = Object.keys(schematicToPcbConverter['layouts']).length;
    const agileTasks = agileManager.getAllTasks().length;
    const procurementOrders = procurementAutomation.getAllPurchaseOrders().length;
    const inventoryItems = inventoryManagement.getAllInventoryItems().length;
    const securityScans = cybersecurityTools.getAllSecurityScans().length;
    const iotDevices = iotDeviceManagement.getAllDevices().length;
    const quantumCircuits = quantumComputingSimulation.getAllCircuits().length;
    const bciSessions = brainComputerInterfaces.getAllBCISessions().length;
    const edgeNodes = edgeComputing.getAllEdgeNodes().length;

    // Calculate alerts
    const inventoryAlerts = inventoryManagement.getActiveAlerts().length;
    const iotAlerts = iotDeviceManagement.getActiveAlerts().length;
    const securityAlerts = cybersecurityTools.getAllSecurityFindings().filter(f => f.status === 'open').length;

    setMetrics({
      totalProjects: arSessions + pcbLayouts + agileTasks + procurementOrders + inventoryItems +
                    securityScans + iotDevices + quantumCircuits + bciSessions + edgeNodes,
      activeUsers: Math.floor(Math.random() * 50) + 10, // Mock active users
      systemHealth: 95 + Math.random() * 5, // Mock system health
      alertsCount: inventoryAlerts + iotAlerts + securityAlerts,
      performanceScore: 85 + Math.random() * 15
    });
  };

  const getSystemStatus = (systemName: string): { status: string; color: string; details: string } => {
    // Mock system status - in production, check actual system health
    const statuses = ['healthy', 'warning', 'error'];
    const status = statuses[Math.floor(Math.random() * statuses.length)];

    const statusMap = {
      healthy: { status: 'Healthy', color: 'bg-green-500', details: 'All systems operational' },
      warning: { status: 'Warning', color: 'bg-yellow-500', details: 'Minor issues detected' },
      error: { status: 'Error', color: 'bg-red-500', details: 'System requires attention' }
    };

    return statusMap[status as keyof typeof statusMap];
  };

  const systems = [
    { name: 'Augmented Reality', icon: '🎯', component: 'AR Design Preview' },
    { name: 'PCB Design', icon: '🔧', component: 'Schematic-to-PCB Converter' },
    { name: 'Agile Management', icon: '📊', component: 'Scrum/Kanban/Gantt' },
    { name: 'Procurement', icon: '🛒', component: 'Automated Purchasing' },
    { name: 'Inventory', icon: '📦', component: 'Stock Management' },
    { name: 'Cybersecurity', icon: '🔒', component: 'Security Tools' },
    { name: 'IoT Management', icon: '📡', component: 'Device Control' },
    { name: 'Quantum Computing', icon: '⚛️', component: 'Qubit Simulation' },
    { name: 'BCI Systems', icon: '🧠', component: 'Neural Interfaces' },
    { name: 'Edge Computing', icon: '☁️', component: 'Distributed Processing' }
  ];

  return (
    <div className="w-full h-full p-6 bg-gray-50">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Circuit CAD Pro - System Dashboard</h1>
        <p className="text-gray-600">Comprehensive overview of all system components and performance metrics</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-blue-600">{metrics.totalProjects}</div>
            <div className="text-sm text-muted-foreground">Total Projects</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600">{metrics.activeUsers}</div>
            <div className="text-sm text-muted-foreground">Active Users</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-purple-600">{metrics.systemHealth.toFixed(1)}%</div>
            <div className="text-sm text-muted-foreground">System Health</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-orange-600">{metrics.alertsCount}</div>
            <div className="text-sm text-muted-foreground">Active Alerts</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-indigo-600">{metrics.performanceScore.toFixed(1)}%</div>
            <div className="text-sm text-muted-foreground">Performance</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">System Overview</TabsTrigger>
          <TabsTrigger value="systems">System Status</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* System Capabilities */}
            <Card>
              <CardHeader>
                <CardTitle>Core Capabilities</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Circuit Design & Simulation</span>
                    <Badge variant="default">Advanced</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">AI-Powered Analysis</span>
                    <Badge variant="default">Integrated</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">3D Visualization</span>
                    <Badge variant="default">Real-time</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Robotics Simulation</span>
                    <Badge variant="default">6-DOF</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Visual Programming</span>
                    <Badge variant="default">Arduino C++</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Advanced Features */}
            <Card>
              <CardHeader>
                <CardTitle>Advanced Features</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Augmented Reality</span>
                    <Badge variant="secondary">WebXR</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Quantum Computing</span>
                    <Badge variant="secondary">Simulation</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Brain-Computer Interface</span>
                    <Badge variant="secondary">Neural</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Edge Computing</span>
                    <Badge variant="secondary">Distributed</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">IoT Device Management</span>
                    <Badge variant="secondary">Real-time</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent System Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm">Quantum circuit executed successfully</span>
                  <span className="text-xs text-muted-foreground ml-auto">2 min ago</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-sm">IoT device registered in edge cluster</span>
                  <span className="text-xs text-muted-foreground ml-auto">5 min ago</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-sm">Security scan completed with 2 findings</span>
                  <span className="text-xs text-muted-foreground ml-auto">8 min ago</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  <span className="text-sm">PCB layout optimized automatically</span>
                  <span className="text-xs text-muted-foreground ml-auto">12 min ago</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="systems" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {systems.map((system, index) => {
              const status = getSystemStatus(system.name);
              return (
                <Card key={index}>
                  <CardContent className="p-4">
                    <div className="flex items-center space-x-3 mb-3">
                      <span className="text-2xl">{system.icon}</span>
                      <div>
                        <h3 className="font-semibold">{system.name}</h3>
                        <p className="text-sm text-muted-foreground">{system.component}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-1 rounded text-xs text-white ${status.color}`}>
                        {status.status}
                      </span>
                      <Button variant="outline" size="sm">
                        View Details
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{status.details}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Performance Trends */}
            <Card>
              <CardHeader>
                <CardTitle>Performance Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>CPU Usage</span>
                      <span>68%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full" style={{ width: '68%' }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Memory Usage</span>
                      <span>52%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-green-600 h-2 rounded-full" style={{ width: '52%' }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>Storage Usage</span>
                      <span>34%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-purple-600 h-2 rounded-full" style={{ width: '34%' }} />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* System Integration Status */}
            <Card>
              <CardHeader>
                <CardTitle>System Integration</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">AI ↔ IoT Integration</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Edge ↔ Cloud Sync</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">BCI ↔ Robotics</span>
                    <Badge variant="secondary">Partial</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Quantum ↔ Classical</span>
                    <Badge variant="secondary">Developing</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">AR ↔ CAD Integration</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* System Health Overview */}
          <Card>
            <CardHeader>
              <CardTitle>System Health Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">99.9%</div>
                  <div className="text-sm text-muted-foreground">Uptime</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">24ms</div>
                  <div className="text-sm text-muted-foreground">Avg Response</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">1.2GB</div>
                  <div className="text-sm text-muted-foreground">Data Processed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">47</div>
                  <div className="text-sm text-muted-foreground">Active Sessions</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};