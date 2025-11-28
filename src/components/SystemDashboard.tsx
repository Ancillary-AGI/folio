import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

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
    // Mock metrics for dashboard
    setMetrics({
      totalProjects: Math.floor(Math.random() * 100) + 50,
      activeUsers: Math.floor(Math.random() * 50) + 10,
      systemHealth: 95 + Math.random() * 5,
      alertsCount: Math.floor(Math.random() * 10),
      performanceScore: 85 + Math.random() * 15
    });
  };

  const getSystemStatus = (): { status: string; color: string; details: string } => {
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
    { name: 'CAD & Mechanical', icon: '🎨', component: '3D Modeling & FEA' },
    { name: 'Circuit & PCB', icon: '⚡', component: 'Schematic & Layout' },
    { name: 'Robotics', icon: '🤖', component: '6-DOF Simulation' },
    { name: 'Embedded Systems', icon: '🔧', component: 'Arduino & FPGA' },
    { name: 'AI Assistant', icon: '🧠', component: 'Agentic Design' },
    { name: 'Simulation', icon: '📊', component: 'Multi-Physics' },
    { name: 'Collaboration', icon: '👥', component: 'Real-time Editing' },
    { name: 'Version Control', icon: '📝', component: 'Git-like System' },
    { name: 'Digital Twin', icon: '🔄', component: 'Real-time Sync' },
    { name: 'Plugin System', icon: '🔌', component: 'Extensible API' }
  ];

  return (
    <div className="w-full h-full p-6 bg-background">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Engineering IDE Pro - System Dashboard</h1>
        <p className="text-muted-foreground">Comprehensive overview of all system components and performance metrics</p>
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
                    <span className="text-sm">CAD & Mechanical Design</span>
                    <Badge variant="default">Advanced</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Circuit & PCB Design</span>
                    <Badge variant="default">Professional</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Robotics Simulation</span>
                    <Badge variant="default">6-DOF</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Agentic AI</span>
                    <Badge variant="default">Integrated</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Real-time Collaboration</span>
                    <Badge variant="default">Multi-user</Badge>
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
                    <span className="text-sm">Multi-Physics Simulation</span>
                    <Badge variant="secondary">FEA</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Digital Twin Sync</span>
                    <Badge variant="secondary">Real-time</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Hardware Interfaces</span>
                    <Badge variant="secondary">I²C/SPI/UART/CAN</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Visual Programming</span>
                    <Badge variant="secondary">Arduino C++</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">3D Export</span>
                    <Badge variant="secondary">STL/G-code</Badge>
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
                  <span className="text-sm">PCB layout optimized successfully</span>
                  <span className="text-xs text-muted-foreground ml-auto">2 min ago</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-sm">Robot simulation completed</span>
                  <span className="text-xs text-muted-foreground ml-auto">5 min ago</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                  <span className="text-sm">DRC check found 2 warnings</span>
                  <span className="text-xs text-muted-foreground ml-auto">8 min ago</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  <span className="text-sm">AI suggested component optimization</span>
                  <span className="text-xs text-muted-foreground ml-auto">12 min ago</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="systems" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {systems.map((system, index) => {
              const status = getSystemStatus();
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
                    <span className="text-sm">AI ↔ Circuit Design</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">CAD ↔ PCB</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Robotics ↔ Digital Twin</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Embedded ↔ Simulation</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Cloud ↔ Local Sync</span>
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
