export interface EdgeNode {
  id: string;
  name: string;
  type: 'gateway' | 'sensor_node' | 'compute_node' | 'storage_node';
  location: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };
  capabilities: {
    cpu: number; // cores
    memory: number; // GB
    storage: number; // GB
    network: string[]; // supported protocols
    sensors?: string[];
    actuators?: string[];
  };
  status: 'online' | 'offline' | 'maintenance' | 'error';
  load: {
    cpuUsage: number;
    memoryUsage: number;
    networkUsage: number;
    temperature: number;
  };
  lastSeen: Date;
  firmwareVersion: string;
  securityLevel: 'low' | 'medium' | 'high';
}

export interface EdgeApplication {
  id: string;
  name: string;
  description: string;
  type: 'data_processing' | 'ai_inference' | 'real_time_analytics' | 'control_system';
  requirements: {
    minCpu: number;
    minMemory: number;
    minStorage: number;
    latencyRequirement: number; // ms
    dataRate: number; // MB/s
  };
  code: string; // containerized application code
  status: 'deployed' | 'running' | 'stopped' | 'failed';
  deployedNodes: string[];
  metrics: {
    throughput: number;
    latency: number;
    accuracy: number;
    uptime: number;
  };
}

export interface DataFlow {
  id: string;
  name: string;
  sourceNode: string;
  destinationNode: string;
  dataType: string;
  protocol: 'MQTT' | 'CoAP' | 'HTTP' | 'WebSocket' | 'BLE';
  qualityOfService: 0 | 1 | 2; // QoS levels
  bandwidth: number; // KB/s
  latency: number; // ms
  status: 'active' | 'inactive' | 'failed';
  lastDataTransfer: Date;
}

export interface EdgeCluster {
  id: string;
  name: string;
  nodes: string[];
  coordinator: string; // master node ID
  topology: 'star' | 'mesh' | 'hierarchical';
  policies: {
    loadBalancing: boolean;
    failover: boolean;
    dataReplication: boolean;
    securityPolicy: string;
  };
  status: 'active' | 'degraded' | 'failed';
}

export interface EdgeAnalytics {
  nodeId: string;
  timeRange: { start: Date; end: Date };
  metrics: {
    dataProcessed: number;
    averageLatency: number;
    throughput: number;
    errorRate: number;
    energyConsumption: number;
  };
  predictions: {
    loadForecast: number[];
    failureProbability: number;
    optimizationSuggestions: string[];
  };
}

export interface EdgeSecurity {
  nodeId: string;
  authentication: boolean;
  encryption: boolean;
  accessControl: string[];
  intrusionDetection: boolean;
  lastSecurityScan: Date;
  vulnerabilities: number;
  complianceStatus: 'compliant' | 'non_compliant' | 'unknown';
}

export class EdgeComputing {
  private nodes: Map<string, EdgeNode> = new Map();
  private applications: Map<string, EdgeApplication> = new Map();
  private dataFlows: Map<string, DataFlow> = new Map();
  private clusters: Map<string, EdgeCluster> = new Map();
  private analytics: Map<string, EdgeAnalytics> = new Map();
  private security: Map<string, EdgeSecurity> = new Map();

  constructor() {}

  // Node Management
  registerEdgeNode(node: Omit<EdgeNode, 'id' | 'lastSeen'>): EdgeNode {
    const newNode: EdgeNode = {
      ...node,
      id: `node-${Date.now()}`,
      lastSeen: new Date()
    };

    this.nodes.set(newNode.id, newNode);
    this.initializeNodeSecurity(newNode.id);
    return newNode;
  }

  updateNodeStatus(nodeId: string, status: EdgeNode['status'], load?: Partial<EdgeNode['load']>): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    node.status = status;
    node.lastSeen = new Date();

    if (load) {
      node.load = { ...node.load, ...load };
    }

    // Check for alerts based on status/load
    this.checkNodeAlerts(node);

    return true;
  }

  private checkNodeAlerts(node: EdgeNode): void {
    if (node.load.cpuUsage > 90) {
      console.warn(`High CPU usage on node ${node.name}: ${node.load.cpuUsage}%`);
    }

    if (node.load.memoryUsage > 85) {
      console.warn(`High memory usage on node ${node.name}: ${node.load.memoryUsage}%`);
    }

    if (node.load.temperature > 70) {
      console.warn(`High temperature on node ${node.name}: ${node.load.temperature}°C`);
    }

    if (node.status === 'error') {
      console.error(`Node ${node.name} is in error state`);
    }
  }

  // Application Deployment
  deployApplication(app: Omit<EdgeApplication, 'id' | 'status' | 'deployedNodes' | 'metrics'>): EdgeApplication {
    const newApp: EdgeApplication = {
      ...app,
      id: `app-${Date.now()}`,
      status: 'deployed',
      deployedNodes: [],
      metrics: {
        throughput: 0,
        latency: 0,
        accuracy: 1.0,
        uptime: 1.0
      }
    };

    // Find suitable nodes for deployment
    const suitableNodes = this.findSuitableNodes(newApp.requirements);
    newApp.deployedNodes = suitableNodes.slice(0, 3); // Deploy to up to 3 nodes

    // Start application on nodes
    newApp.deployedNodes.forEach(nodeId => {
      this.startApplicationOnNode(newApp.id, nodeId);
    });

    this.applications.set(newApp.id, newApp);
    return newApp;
  }

  private findSuitableNodes(requirements: EdgeApplication['requirements']): string[] {
    return Array.from(this.nodes.values())
      .filter(node =>
        node.status === 'online' &&
        node.capabilities.cpu >= requirements.minCpu &&
        node.capabilities.memory >= requirements.minMemory &&
        node.capabilities.storage >= requirements.minStorage
      )
      .map(node => node.id);
  }

  private startApplicationOnNode(appId: string, nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Simulate application startup
    setTimeout(() => {
      console.log(`Application ${appId} started on node ${node.name}`);
    }, 1000);
  }

  updateApplicationMetrics(appId: string, metrics: Partial<EdgeApplication['metrics']>): boolean {
    const app = this.applications.get(appId);
    if (!app) return false;

    app.metrics = { ...app.metrics, ...metrics };
    return true;
  }

  // Data Flow Management
  createDataFlow(flow: Omit<DataFlow, 'id' | 'status' | 'lastDataTransfer'>): DataFlow {
    const newFlow: DataFlow = {
      ...flow,
      id: `flow-${Date.now()}`,
      status: 'active',
      lastDataTransfer: new Date()
    };

    this.dataFlows.set(newFlow.id, newFlow);
    this.optimizeDataFlow(newFlow);
    return newFlow;
  }

  updateDataFlow(flowId: string, dataSize: number, latency: number): boolean {
    const flow = this.dataFlows.get(flowId);
    if (!flow) return false;

    flow.lastDataTransfer = new Date();
    flow.bandwidth = dataSize / 1000; // Convert to KB/s
    flow.latency = latency;

    return true;
  }

  private optimizeDataFlow(flow: DataFlow): void {
    // Optimize routing based on network conditions
    const sourceNode = this.nodes.get(flow.sourceNode);
    const destNode = this.nodes.get(flow.destinationNode);

    if (sourceNode && destNode) {
      // Calculate optimal protocol based on distance and requirements
      const distance = this.calculateDistance(sourceNode.location, destNode.location);

      if (distance < 100 && flow.dataType === 'sensor') {
        flow.protocol = 'BLE'; // Short range, low power
      } else if (flow.qualityOfService > 0) {
        flow.protocol = 'MQTT'; // Reliable messaging
      }
    }
  }

  private calculateDistance(loc1: EdgeNode['location'], loc2: EdgeNode['location']): number {
    const R = 6371; // Earth's radius in km
    const dLat = (loc2.latitude - loc1.latitude) * Math.PI / 180;
    const dLon = (loc2.longitude - loc1.longitude) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(loc1.latitude * Math.PI / 180) * Math.cos(loc2.latitude * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Cluster Management
  createCluster(cluster: Omit<EdgeCluster, 'id' | 'status'>): EdgeCluster {
    const newCluster: EdgeCluster = {
      ...cluster,
      id: `cluster-${Date.now()}`,
      status: 'active'
    };

    // Validate coordinator exists and is suitable
    const coordinator = this.nodes.get(newCluster.coordinator);
    if (!coordinator || coordinator.type !== 'compute_node') {
      throw new Error('Invalid coordinator node');
    }

    this.clusters.set(newCluster.id, newCluster);
    return newCluster;
  }

  balanceClusterLoad(clusterId: string): boolean {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return false;

    const clusterNodes = cluster.nodes.map(id => this.nodes.get(id)).filter(Boolean) as EdgeNode[];

    // Simple load balancing algorithm
    const avgCpuUsage = clusterNodes.reduce((sum, node) => sum + node.load.cpuUsage, 0) / clusterNodes.length;

    clusterNodes.forEach(node => {
      if (node.load.cpuUsage > avgCpuUsage + 20) {
        // Migrate applications to less loaded nodes
        this.migrateApplications(node.id, cluster.nodes);
      }
    });

    return true;
  }

  private migrateApplications(fromNodeId: string, toNodeIds: string[]): void {
    // Find applications on the overloaded node
    const appsToMigrate = Array.from(this.applications.values())
      .filter(app => app.deployedNodes.includes(fromNodeId));

    appsToMigrate.forEach(app => {
      // Find least loaded node
      const targetNode = toNodeIds
        .map(id => this.nodes.get(id))
        .filter(Boolean)
        .sort((a, b) => (a!.load.cpuUsage - b!.load.cpuUsage))[0];

      if (targetNode) {
        this.migrateApplication(app.id, fromNodeId, targetNode.id);
      }
    });
  }

  private migrateApplication(appId: string, fromNodeId: string, toNodeId: string): void {
    const app = this.applications.get(appId);
    if (!app) return;

    // Remove from old node
    app.deployedNodes = app.deployedNodes.filter(id => id !== fromNodeId);

    // Add to new node
    if (!app.deployedNodes.includes(toNodeId)) {
      app.deployedNodes.push(toNodeId);
      this.startApplicationOnNode(appId, toNodeId);
    }

    console.log(`Migrated application ${appId} from ${fromNodeId} to ${toNodeId}`);
  }

  // Analytics and Monitoring
  generateNodeAnalytics(nodeId: string, startDate: Date, endDate: Date): EdgeAnalytics | null {
    const node = this.nodes.get(nodeId);
    if (!node) return null;

    // Mock analytics data - in practice, this would aggregate real metrics
    const analytics: EdgeAnalytics = {
      nodeId,
      timeRange: { start: startDate, end: endDate },
      metrics: {
        dataProcessed: Math.random() * 1000,
        averageLatency: Math.random() * 100,
        throughput: Math.random() * 100,
        errorRate: Math.random() * 0.1,
        energyConsumption: Math.random() * 50
      },
      predictions: {
        loadForecast: Array.from({ length: 24 }, () => Math.random() * 100),
        failureProbability: Math.random() * 0.1,
        optimizationSuggestions: [
          'Consider load balancing',
          'Update firmware',
          'Optimize network configuration'
        ]
      }
    };

    this.analytics.set(`${nodeId}-${startDate.getTime()}`, analytics);
    return analytics;
  }

  // Security Management
  private initializeNodeSecurity(nodeId: string): void {
    const security: EdgeSecurity = {
      nodeId,
      authentication: true,
      encryption: true,
      accessControl: ['admin', 'user'],
      intrusionDetection: true,
      lastSecurityScan: new Date(),
      vulnerabilities: 0,
      complianceStatus: 'compliant'
    };

    this.security.set(nodeId, security);
  }

  performSecurityScan(nodeId: string): EdgeSecurity | null {
    const security = this.security.get(nodeId);
    if (!security) return null;

    // Mock security scan
    security.lastSecurityScan = new Date();
    security.vulnerabilities = Math.floor(Math.random() * 5);
    security.complianceStatus = security.vulnerabilities === 0 ? 'compliant' : 'non_compliant';

    return security;
  }

  // Resource Optimization
  optimizeResourceAllocation(): {
    recommendations: Array<{ nodeId: string; action: string; impact: number }>;
  } {
    const recommendations: Array<{ nodeId: string; action: string; impact: number }> = [];

    this.nodes.forEach(node => {
      if (node.load.cpuUsage > 80) {
        recommendations.push({
          nodeId: node.id,
          action: 'Scale up CPU resources',
          impact: 0.8
        });
      }

      if (node.load.memoryUsage > 75) {
        recommendations.push({
          nodeId: node.id,
          action: 'Increase memory allocation',
          impact: 0.7
        });
      }

      if (node.load.networkUsage < 20) {
        recommendations.push({
          nodeId: node.id,
          action: 'Consider consolidating workloads',
          impact: 0.5
        });
      }
    });

    return { recommendations };
  }

  // Getters
  getEdgeNode(nodeId: string): EdgeNode | undefined {
    return this.nodes.get(nodeId);
  }

  getAllEdgeNodes(): EdgeNode[] {
    return Array.from(this.nodes.values());
  }

  getEdgeApplication(appId: string): EdgeApplication | undefined {
    return this.applications.get(appId);
  }

  getAllEdgeApplications(): EdgeApplication[] {
    return Array.from(this.applications.values());
  }

  getDataFlow(flowId: string): DataFlow | undefined {
    return this.dataFlows.get(flowId);
  }

  getAllDataFlows(): DataFlow[] {
    return Array.from(this.dataFlows.values());
  }

  getEdgeCluster(clusterId: string): EdgeCluster | undefined {
    return this.clusters.get(clusterId);
  }

  getAllEdgeClusters(): EdgeCluster[] {
    return Array.from(this.clusters.values());
  }

  getNodeSecurity(nodeId: string): EdgeSecurity | undefined {
    return this.security.get(nodeId);
  }

  getNodeAnalytics(nodeId: string): EdgeAnalytics[] {
    return Array.from(this.analytics.values()).filter(a => a.nodeId === nodeId);
  }

  // Dashboard Metrics
  getDashboardMetrics(): {
    totalNodes: number;
    onlineNodes: number;
    totalApplications: number;
    runningApplications: number;
    activeDataFlows: number;
    averageLatency: number;
    totalBandwidth: number;
  } {
    const nodes = this.getAllEdgeNodes();
    const applications = this.getAllEdgeApplications();
    const dataFlows = this.getAllDataFlows();

    return {
      totalNodes: nodes.length,
      onlineNodes: nodes.filter(n => n.status === 'online').length,
      totalApplications: applications.length,
      runningApplications: applications.filter(a => a.status === 'running').length,
      activeDataFlows: dataFlows.filter(f => f.status === 'active').length,
      averageLatency: dataFlows.reduce((sum, f) => sum + f.latency, 0) / Math.max(dataFlows.length, 1),
      totalBandwidth: dataFlows.reduce((sum, f) => sum + f.bandwidth, 0)
    };
  }
}

export const edgeComputing = new EdgeComputing();