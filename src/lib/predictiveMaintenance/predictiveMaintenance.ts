import { Component } from '../../types';

export interface MaintenancePrediction {
  id: string;
  componentId: string;
  component: Component;
  predictionType: 'failure' | 'degradation' | 'wear' | 'calibration' | 'replacement';
  probability: number; // 0-1
  confidence: number; // 0-1
  predictedTime: Date;
  timeToFailure?: number; // hours/days
  severity: 'low' | 'medium' | 'high' | 'critical';
  factors: Array<{
    name: string;
    impact: number; // -1 to 1
    description: string;
  }>;
  recommendations: Array<{
    action: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    cost: number;
    timeRequired: number; // hours
    riskReduction: number; // 0-1
  }>;
  metadata: {
    model: string;
    algorithm: string;
    trainingData: string;
    lastUpdated: Date;
    accuracy: number;
  };
}

export interface MaintenanceSchedule {
  id: string;
  componentId: string;
  component: Component;
  scheduleType: 'preventive' | 'predictive' | 'condition_based' | 'time_based';
  frequency: {
    interval: number; // hours/days/weeks/months
    unit: 'hours' | 'days' | 'weeks' | 'months' | 'years';
    lastPerformed?: Date;
    nextDue: Date;
  };
  tasks: Array<{
    id: string;
    name: string;
    description: string;
    estimatedTime: number; // hours
    requiredSkills: string[];
    partsRequired: Array<{
      partNumber: string;
      quantity: number;
      cost: number;
    }>;
    procedures: string[];
    safetyRequirements: string[];
  }>;
  monitoring: {
    parameters: Array<{
      name: string;
      type: 'sensor' | 'visual' | 'measurement';
      threshold: {
        warning: number;
        critical: number;
      };
      unit: string;
      frequency: number; // minutes
    }>;
    alerts: Array<{
      condition: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      notification: string;
      escalation: string[];
    }>;
  };
  history: Array<{
    date: Date;
    type: 'scheduled' | 'unscheduled' | 'emergency';
    performedBy: string;
    duration: number; // hours
    cost: number;
    notes: string;
    outcome: 'successful' | 'issues_found' | 'failed';
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    approvalRequired: boolean;
    status: 'active' | 'inactive' | 'superseded';
  };
}

export interface EquipmentHealth {
  id: string;
  equipmentId: string;
  equipmentType: string;
  location: string;
  overallHealth: number; // 0-100
  healthTrend: 'improving' | 'stable' | 'degrading' | 'critical';
  subsystems: Array<{
    name: string;
    health: number;
    trend: 'improving' | 'stable' | 'degrading';
    lastAssessment: Date;
    nextAssessment: Date;
  }>;
  sensors: Array<{
    id: string;
    name: string;
    type: 'temperature' | 'vibration' | 'pressure' | 'current' | 'voltage' | 'flow' | 'level';
    value: number;
    unit: string;
    status: 'normal' | 'warning' | 'critical';
    threshold: {
      warning: number;
      critical: number;
    };
    trend: number[]; // last 10 readings
    lastUpdated: Date;
  }>;
  predictions: MaintenancePrediction[];
  alerts: Array<{
    id: string;
    type: 'health' | 'sensor' | 'prediction' | 'maintenance';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    timestamp: Date;
    acknowledged: boolean;
    resolved: boolean;
  }>;
  maintenanceSchedule: MaintenanceSchedule[];
  kpis: {
    availability: number; // uptime percentage
    reliability: number; // MTBF
    maintainability: number; // MTTR
    performance: number; // efficiency rating
  };
  metadata: {
    created: Date;
    updated: Date;
    monitoredSince: Date;
    dataQuality: number;
  };
}

export interface MaintenanceAnalytics {
  id: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalEquipment: number;
    healthyEquipment: number;
    warningEquipment: number;
    criticalEquipment: number;
    maintenanceEvents: number;
    unplannedDowntime: number; // hours
    plannedDowntime: number; // hours
    totalMaintenanceCost: number;
    averageMTBF: number; // hours
    averageMTTR: number; // hours
  };
  trends: {
    healthTrend: Array<{
      date: Date;
      averageHealth: number;
      healthyCount: number;
      criticalCount: number;
    }>;
    failureTrend: Array<{
      date: Date;
      failureCount: number;
      failureType: string;
    }>;
    costTrend: Array<{
      date: Date;
      maintenanceCost: number;
      unplannedCost: number;
      plannedCost: number;
    }>;
  };
  insights: Array<{
    type: 'efficiency' | 'cost' | 'reliability' | 'predictive_accuracy';
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    recommendation: string;
    data: Record<string, unknown>;
  }>;
  predictions: {
    nextWeek: {
      failures: number;
      criticalAlerts: number;
      maintenanceNeeded: number;
    };
    nextMonth: {
      failures: number;
      downtime: number;
      cost: number;
    };
  };
  metadata: {
    generated: Date;
    dataQuality: number;
    confidence: number;
  };
}

export class PredictiveMaintenanceManager {
  private predictions: Map<string, MaintenancePrediction> = new Map();
  private schedules: Map<string, MaintenanceSchedule> = new Map();
  private equipmentHealth: Map<string, EquipmentHealth> = new Map();
  private analytics: Map<string, MaintenanceAnalytics> = new Map();

  createMaintenancePrediction(prediction: Omit<MaintenancePrediction, 'id'>): MaintenancePrediction {
    const newPrediction: MaintenancePrediction = {
      ...prediction,
      id: `prediction_${Date.now()}`
    };

    this.predictions.set(newPrediction.id, newPrediction);
    return newPrediction;
  }

  createMaintenanceSchedule(schedule: Omit<MaintenanceSchedule, 'id'>): MaintenanceSchedule {
    const newSchedule: MaintenanceSchedule = {
      ...schedule,
      id: `schedule_${Date.now()}`
    };

    this.schedules.set(newSchedule.id, newSchedule);
    return newSchedule;
  }

  createEquipmentHealth(health: Omit<EquipmentHealth, 'id'>): EquipmentHealth {
    const newHealth: EquipmentHealth = {
      ...health,
      id: `health_${Date.now()}`
    };

    this.equipmentHealth.set(newHealth.id, newHealth);
    return newHealth;
  }

  analyzeEquipmentHealth(equipmentId: string): Promise<EquipmentHealth> {
    return new Promise((resolve) => {
      // Simulate equipment health analysis
      setTimeout(() => {
        const health = this.equipmentHealth.get(equipmentId);
        if (!health) {
          resolve(this.createMockEquipmentHealth(equipmentId));
          return;
        }

        // Update sensor readings
        health.sensors.forEach(sensor => {
          sensor.value = sensor.value + (Math.random() - 0.5) * sensor.value * 0.1; // ±10% variation
          sensor.lastUpdated = new Date();

          // Update trend
          sensor.trend.push(sensor.value);
          if (sensor.trend.length > 10) {
            sensor.trend.shift();
          }

          // Update status
          if (sensor.value >= sensor.threshold.critical) {
            sensor.status = 'critical';
          } else if (sensor.value >= sensor.threshold.warning) {
            sensor.status = 'warning';
          } else {
            sensor.status = 'normal';
          }
        });

        // Calculate overall health
        const sensorHealth = health.sensors.reduce((sum, sensor) => {
          const weight = sensor.type === 'temperature' ? 0.3 :
                        sensor.type === 'vibration' ? 0.3 :
                        sensor.type === 'current' ? 0.2 : 0.2;
          const sensorScore = sensor.status === 'normal' ? 100 :
                             sensor.status === 'warning' ? 70 : 30;
          return sum + (sensorScore * weight);
        }, 0);

        health.overallHealth = Math.max(0, Math.min(100, sensorHealth));

        // Determine trend
        const recentHealth = health.overallHealth;
        const previousHealth = health.overallHealth; // Simplified
        if (recentHealth > previousHealth + 5) {
          health.healthTrend = 'improving';
        } else if (recentHealth < previousHealth - 5) {
          health.healthTrend = 'degrading';
        } else {
          health.healthTrend = 'stable';
        }

        // Generate alerts
        health.sensors.forEach(sensor => {
          if (sensor.status !== 'normal') {
            const existingAlert = health.alerts.find(a =>
              a.type === 'sensor' && a.message.includes(sensor.name)
            );

            if (!existingAlert) {
              health.alerts.push({
                id: `alert_${Date.now()}`,
                type: 'sensor',
                severity: sensor.status === 'critical' ? 'critical' : 'medium',
                message: `${sensor.name} ${sensor.status}: ${sensor.value}${sensor.unit}`,
                timestamp: new Date(),
                acknowledged: false,
                resolved: false
              });
            }
          }
        });

        resolve(health);
      }, 1000 + Math.random() * 2000); // 1-3 seconds
    });
  }

  private createMockEquipmentHealth(equipmentId: string): EquipmentHealth {
    return {
      id: `health_${equipmentId}`,
      equipmentId,
      equipmentType: 'Circuit Board',
      location: 'Lab Station 1',
      overallHealth: 85 + Math.random() * 10,
      healthTrend: 'stable',
      subsystems: [
        {
          name: 'Power Supply',
          health: 90,
          trend: 'stable',
          lastAssessment: new Date(Date.now() - 24 * 60 * 60 * 1000),
          nextAssessment: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        },
        {
          name: 'Signal Processing',
          health: 85,
          trend: 'stable',
          lastAssessment: new Date(Date.now() - 48 * 60 * 60 * 1000),
          nextAssessment: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        }
      ],
      sensors: [
        {
          id: 'temp_1',
          name: 'Temperature Sensor',
          type: 'temperature',
          value: 45 + Math.random() * 10,
          unit: '°C',
          status: 'normal',
          threshold: { warning: 60, critical: 75 },
          trend: Array.from({ length: 10 }, () => 45 + Math.random() * 10),
          lastUpdated: new Date()
        },
        {
          id: 'vib_1',
          name: 'Vibration Sensor',
          type: 'vibration',
          value: 0.5 + Math.random() * 0.5,
          unit: 'g',
          status: 'normal',
          threshold: { warning: 1.0, critical: 2.0 },
          trend: Array.from({ length: 10 }, () => 0.5 + Math.random() * 0.5),
          lastUpdated: new Date()
        }
      ],
      predictions: [],
      alerts: [],
      maintenanceSchedule: [],
      kpis: {
        availability: 0.98,
        reliability: 5000, // hours MTBF
        maintainability: 2, // hours MTTR
        performance: 0.95
      },
      metadata: {
        created: new Date(),
        updated: new Date(),
        monitoredSince: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        dataQuality: 0.92
      }
    };
  }

  predictMaintenanceNeeds(equipmentId: string): Promise<MaintenancePrediction[]> {
    return new Promise((resolve) => {
      // Simulate predictive maintenance analysis
      setTimeout(() => {
        const predictions: MaintenancePrediction[] = [];

        // Generate mock predictions
        const predictionTypes: MaintenancePrediction['predictionType'][] =
          ['failure', 'degradation', 'wear', 'calibration', 'replacement'];

        predictionTypes.forEach(type => {
          if (Math.random() > 0.6) { // 40% chance of prediction
            const prediction: MaintenancePrediction = {
              id: `pred_${equipmentId}_${type}_${Date.now()}`,
              componentId: equipmentId,
              component: {} as Component, // Would be populated from component library
              predictionType: type,
              probability: Math.random() * 0.8, // 0-80% probability
              confidence: 0.7 + Math.random() * 0.25, // 70-95% confidence
              predictedTime: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000), // Next 30 days
              timeToFailure: Math.random() * 500, // 0-500 hours
              severity: Math.random() > 0.7 ? 'high' : Math.random() > 0.4 ? 'medium' : 'low',
              factors: [
                {
                  name: 'Usage Hours',
                  impact: Math.random() * 0.5,
                  description: 'High usage correlates with increased failure risk'
                },
                {
                  name: 'Temperature',
                  impact: Math.random() * 0.3,
                  description: 'Elevated temperatures accelerate component degradation'
                }
              ],
              recommendations: [
                {
                  action: `Perform ${type} maintenance`,
                  priority: Math.random() > 0.7 ? 'high' : 'medium',
                  cost: Math.random() * 500,
                  timeRequired: Math.random() * 8,
                  riskReduction: 0.6 + Math.random() * 0.3
                }
              ],
              metadata: {
                model: 'RandomForest',
                algorithm: 'predictive_maintenance_v2',
                trainingData: 'historical_maintenance_data',
                lastUpdated: new Date(),
                accuracy: 0.85 + Math.random() * 0.1
              }
            };

            predictions.push(prediction);
            this.predictions.set(prediction.id, prediction);
          }
        });

        resolve(predictions);
      }, 2000 + Math.random() * 3000); // 2-5 seconds
    });
  }

  generateMaintenanceAnalytics(startDate: Date, endDate: Date): Promise<MaintenanceAnalytics> {
    return new Promise((resolve) => {
      // Simulate analytics generation
      setTimeout(() => {
        const analytics: MaintenanceAnalytics = {
          id: `analytics_${Date.now()}`,
          period: { start: startDate, end: endDate },
          summary: {
            totalEquipment: 50 + Math.floor(Math.random() * 50),
            healthyEquipment: 35 + Math.floor(Math.random() * 30),
            warningEquipment: 8 + Math.floor(Math.random() * 10),
            criticalEquipment: 2 + Math.floor(Math.random() * 5),
            maintenanceEvents: 25 + Math.floor(Math.random() * 50),
            unplannedDowntime: Math.random() * 100,
            plannedDowntime: Math.random() * 50,
            totalMaintenanceCost: Math.random() * 50000,
            averageMTBF: 2000 + Math.random() * 3000,
            averageMTTR: 4 + Math.random() * 8
          },
          trends: {
            healthTrend: this.generateHealthTrend(startDate, endDate),
            failureTrend: this.generateFailureTrend(startDate, endDate),
            costTrend: this.generateCostTrend(startDate, endDate)
          },
          insights: [
            {
              type: 'efficiency',
              title: 'Maintenance Efficiency Improvement',
              description: 'Predictive maintenance reduced unplanned downtime by 35%',
              impact: 'high',
              recommendation: 'Continue investing in predictive maintenance sensors',
              data: { improvement: 0.35, costSavings: 15000 }
            },
            {
              type: 'cost',
              title: 'Cost Optimization Opportunity',
              description: 'Component replacement costs could be reduced by optimizing maintenance schedules',
              impact: 'medium',
              recommendation: 'Review maintenance intervals for high-cost components',
              data: { potentialSavings: 8000, affectedComponents: 5 }
            }
          ],
          predictions: {
            nextWeek: {
              failures: Math.floor(Math.random() * 5),
              criticalAlerts: Math.floor(Math.random() * 3),
              maintenanceNeeded: Math.floor(Math.random() * 8)
            },
            nextMonth: {
              failures: Math.floor(Math.random() * 15),
              downtime: Math.random() * 20,
              cost: Math.random() * 10000
            }
          },
          metadata: {
            generated: new Date(),
            dataQuality: 0.88,
            confidence: 0.82
          }
        };

        this.analytics.set(analytics.id, analytics);
        resolve(analytics);
      }, 3000 + Math.random() * 4000); // 3-7 seconds
    });
  }

  private generateHealthTrend(startDate: Date, endDate: Date): MaintenanceAnalytics['trends']['healthTrend'] {
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const trend: MaintenanceAnalytics['trends']['healthTrend'] = [];

    for (let i = 0; i < days; i += 7) { // Weekly data points
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);

      trend.push({
        date,
        averageHealth: 80 + Math.random() * 15,
        healthyCount: 35 + Math.floor(Math.random() * 10),
        criticalCount: Math.floor(Math.random() * 5)
      });
    }

    return trend;
  }

  private generateFailureTrend(startDate: Date, endDate: Date): MaintenanceAnalytics['trends']['failureTrend'] {
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const trend: MaintenanceAnalytics['trends']['failureTrend'] = [];

    for (let i = 0; i < days; i += 7) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);

      trend.push({
        date,
        failureCount: Math.floor(Math.random() * 8),
        failureType: ['Electrical', 'Mechanical', 'Thermal', 'Software'][Math.floor(Math.random() * 4)]
      });
    }

    return trend;
  }

  private generateCostTrend(startDate: Date, endDate: Date): MaintenanceAnalytics['trends']['costTrend'] {
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const trend: MaintenanceAnalytics['trends']['costTrend'] = [];

    for (let i = 0; i < days; i += 7) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);

      trend.push({
        date,
        maintenanceCost: Math.random() * 5000,
        unplannedCost: Math.random() * 3000,
        plannedCost: Math.random() * 2000
      });
    }

    return trend;
  }

  getMaintenancePrediction(id: string): MaintenancePrediction | undefined {
    return this.predictions.get(id);
  }

  getMaintenanceSchedule(id: string): MaintenanceSchedule | undefined {
    return this.schedules.get(id);
  }

  getEquipmentHealth(id: string): EquipmentHealth | undefined {
    return this.equipmentHealth.get(id);
  }

  getMaintenanceAnalytics(id: string): MaintenanceAnalytics | undefined {
    return this.analytics.get(id);
  }

  getAllMaintenancePredictions(): MaintenancePrediction[] {
    return Array.from(this.predictions.values());
  }

  getAllMaintenanceSchedules(): MaintenanceSchedule[] {
    return Array.from(this.schedules.values());
  }

  getAllEquipmentHealth(): EquipmentHealth[] {
    return Array.from(this.equipmentHealth.values());
  }

  getAllMaintenanceAnalytics(): MaintenanceAnalytics[] {
    return Array.from(this.analytics.values());
  }

  updateMaintenancePrediction(id: string, updates: Partial<MaintenancePrediction>): boolean {
    const prediction = this.predictions.get(id);
    if (!prediction) return false;

    Object.assign(prediction, updates);
    prediction.metadata.lastUpdated = new Date();
    return true;
  }

  deleteMaintenancePrediction(id: string): boolean {
    return this.predictions.delete(id);
  }

  exportPredictiveMaintenanceConfiguration(): Record<string, unknown> {
    return {
      predictions: Array.from(this.predictions.values()),
      schedules: Array.from(this.schedules.values()),
      equipmentHealth: Array.from(this.equipmentHealth.values()),
      analytics: Array.from(this.analytics.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface MaintenanceAnalysisResult {
  success: boolean;
  error?: string;
  healthId?: string;
  overallHealth?: number;
  alertsTriggered?: number;
  predictionsGenerated?: number;
  analysisTime?: number;
}

interface PredictionResult {
  success: boolean;
  error?: string;
  predictions?: MaintenancePrediction[];
  highRiskCount?: number;
  predictionTime?: number;
}

interface AnalyticsResult {
  success: boolean;
  error?: string;
  analyticsId?: string;
  insightsGenerated?: number;
  predictionsMade?: number;
  analyticsTime?: number;
}

export const predictiveMaintenanceManager = new PredictiveMaintenanceManager();