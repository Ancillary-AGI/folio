import { Component } from '../../types';

export interface UserSession {
  id: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  duration: number; // milliseconds
  device: {
    type: 'desktop' | 'tablet' | 'mobile';
    os: string;
    browser: string;
    screenResolution: string;
  };
  location?: {
    country: string;
    region: string;
    city: string;
  };
  events: UserEvent[];
  metadata: {
    ipAddress?: string;
    userAgent: string;
    referrer?: string;
    sessionId: string;
  };
}

export interface UserEvent {
  id: string;
  sessionId: string;
  timestamp: Date;
  type: 'click' | 'hover' | 'scroll' | 'key_press' | 'drag' | 'drop' | 'zoom' | 'pan' | 'select' | 'deselect' | 'save' | 'export' | 'simulate' | 'compile' | 'upload';
  target: {
    element: string;
    componentId?: string;
    wireId?: string;
    x?: number;
    y?: number;
  };
  data: Record<string, unknown>;
  context: {
    page: string;
    tool: string;
    projectId?: string;
    circuitId?: string;
  };
}

export interface UserBehaviorPattern {
  id: string;
  userId: string;
  pattern: {
    name: string;
    description: string;
    type: 'usage' | 'workflow' | 'efficiency' | 'learning' | 'expertise';
    frequency: number;
    confidence: number;
    lastObserved: Date;
  };
  actions: Array<{
    sequence: string[];
    frequency: number;
    averageTime: number;
    successRate: number;
  }>;
  preferences: {
    tools: Record<string, number>; // tool -> usage frequency
    themes: Record<string, number>; // theme -> usage frequency
    shortcuts: Record<string, number>; // shortcut -> usage frequency
    workflows: Record<string, number>; // workflow -> usage frequency
  };
  metrics: {
    efficiency: number;
    productivity: number;
    learning: number;
    expertise: number;
  };
  recommendations: Array<{
    type: 'tool' | 'workflow' | 'training' | 'shortcut';
    suggestion: string;
    impact: 'high' | 'medium' | 'low';
    confidence: number;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    dataPoints: number;
    accuracy: number;
  };
}

export interface UserAnalytics {
  id: string;
  userId: string;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalSessions: number;
    totalTime: number; // minutes
    averageSessionTime: number; // minutes
    mostUsedTools: Array<{
      tool: string;
      usage: number;
      time: number;
    }>;
    mostUsedFeatures: Array<{
      feature: string;
      usage: number;
      time: number;
    }>;
    productivity: {
      score: number;
      trend: 'improving' | 'stable' | 'declining';
      factors: Record<string, number>;
    };
    learning: {
      score: number;
      newFeatures: number;
      skillDevelopment: number;
      knowledgeGaps: string[];
    };
  };
  detailed: {
    dailyUsage: Array<{
      date: Date;
      sessions: number;
      time: number;
      tools: Record<string, number>;
      features: Record<string, number>;
    }>;
    workflowAnalysis: Array<{
      workflow: string;
      frequency: number;
      averageTime: number;
      successRate: number;
      bottlenecks: string[];
    }>;
    errorAnalysis: Array<{
      error: string;
      frequency: number;
      context: string;
      resolution: string;
    }>;
  };
  insights: Array<{
    type: 'efficiency' | 'learning' | 'usability' | 'feature' | 'workflow';
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    recommendation: string;
    data: Record<string, unknown>;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    dataQuality: number;
    confidence: number;
  };
}

export class UserBehaviorAnalyticsManager {
  private sessions: Map<string, UserSession> = new Map();
  private events: Map<string, UserEvent[]> = new Map();
  private patterns: Map<string, UserBehaviorPattern> = new Map();
  private analytics: Map<string, UserAnalytics> = new Map();

  trackEvent(event: Omit<UserEvent, 'id'>): UserEvent {
    const newEvent: UserEvent = {
      ...event,
      id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    // Add to events map
    if (!this.events.has(event.sessionId)) {
      this.events.set(event.sessionId, []);
    }
    this.events.get(event.sessionId)!.push(newEvent);

    // Update session if it exists
    const session = this.sessions.get(event.sessionId);
    if (session) {
      session.events.push(newEvent);
    }

    return newEvent;
  }

  startSession(session: Omit<UserSession, 'id' | 'events' | 'endTime' | 'duration'>): UserSession {
    const newSession: UserSession = {
      ...session,
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      events: [],
      duration: 0
    };

    this.sessions.set(newSession.id, newSession);
    return newSession;
  }

  endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.endTime) return false;

    session.endTime = new Date();
    session.duration = session.endTime.getTime() - session.startTime.getTime();
    return true;
  }

  analyzeUserBehavior(userId: string, startDate: Date, endDate: Date): Promise<UserAnalytics> {
    return new Promise((resolve) => {
      // Simulate behavior analysis
      setTimeout(() => {
        const analysis = this.performBehaviorAnalysis(userId, startDate, endDate);

        // Store analysis
        this.analytics.set(`${userId}_${startDate.toISOString()}_${endDate.toISOString()}`, analysis);

        resolve(analysis);
      }, 2000 + Math.random() * 3000); // 2-5 seconds
    });
  }

  private performBehaviorAnalysis(userId: string, startDate: Date, endDate: Date): UserAnalytics {
    // Get user's sessions in the period
    const userSessions = Array.from(this.sessions.values())
      .filter(session =>
        session.userId === userId &&
        session.startTime >= startDate &&
        session.startTime <= endDate
      );

    const totalSessions = userSessions.length;
    const totalTime = userSessions.reduce((sum, session) => sum + session.duration, 0) / (1000 * 60); // minutes
    const averageSessionTime = totalSessions > 0 ? totalTime / totalSessions : 0;

    // Analyze tool usage
    const toolUsage = new Map<string, { usage: number; time: number }>();
    userSessions.forEach(session => {
      session.events.forEach(event => {
        const tool = event.context.tool;
        if (!toolUsage.has(tool)) {
          toolUsage.set(tool, { usage: 0, time: 0 });
        }
        const usage = toolUsage.get(tool)!;
        usage.usage++;
        // Estimate time spent on tool (simplified)
        usage.time += Math.random() * 10; // minutes
      });
    });

    const mostUsedTools = Array.from(toolUsage.entries())
      .map(([tool, data]) => ({ tool, ...data }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 5);

    // Analyze feature usage
    const featureUsage = new Map<string, { usage: number; time: number }>();
    userSessions.forEach(session => {
      session.events.forEach(event => {
        const feature = event.type;
        if (!featureUsage.has(feature)) {
          featureUsage.set(feature, { usage: 0, time: 0 });
        }
        const usage = featureUsage.get(feature)!;
        usage.usage++;
        usage.time += Math.random() * 5; // minutes
      });
    });

    const mostUsedFeatures = Array.from(featureUsage.entries())
      .map(([feature, data]) => ({ feature, ...data }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 5);

    // Calculate productivity score
    const productivityScore = Math.min(100, (averageSessionTime * 10) + (mostUsedTools.length * 5) + Math.random() * 20);
    const productivityTrend = Math.random() > 0.6 ? 'improving' : Math.random() > 0.3 ? 'stable' : 'declining';

    // Calculate learning score
    const learningScore = Math.min(100, (featureUsage.size * 2) + (totalSessions * 0.5) + Math.random() * 30);

    const analysis: UserAnalytics = {
      id: `analytics_${userId}_${Date.now()}`,
      userId,
      period: { start: startDate, end: endDate },
      summary: {
        totalSessions,
        totalTime,
        averageSessionTime,
        mostUsedTools,
        mostUsedFeatures,
        productivity: {
          score: productivityScore,
          trend: productivityTrend as any,
          factors: {
            sessionTime: averageSessionTime * 0.3,
            toolDiversity: mostUsedTools.length * 0.2,
            featureUsage: mostUsedFeatures.length * 0.2,
            efficiency: Math.random() * 0.3
          }
        },
        learning: {
          score: learningScore,
          newFeatures: Math.floor(featureUsage.size * 0.3),
          skillDevelopment: Math.random() * 50,
          knowledgeGaps: ['Advanced simulation', 'PCB routing', 'FPGA programming']
        }
      },
      detailed: {
        dailyUsage: this.generateDailyUsage(userSessions, startDate, endDate),
        workflowAnalysis: this.analyzeWorkflows(userSessions),
        errorAnalysis: this.analyzeErrors(userSessions)
      },
      insights: this.generateInsights(userSessions, productivityScore, learningScore),
      metadata: {
        created: new Date(),
        updated: new Date(),
        dataQuality: 0.85 + Math.random() * 0.1,
        confidence: 0.8 + Math.random() * 0.15
      }
    };

    return analysis;
  }

  private generateDailyUsage(sessions: UserSession[], startDate: Date, endDate: Date): UserAnalytics['detailed']['dailyUsage'] {
    const dailyUsage: UserAnalytics['detailed']['dailyUsage'] = [];
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);

      const daySessions = sessions.filter(session =>
        session.startTime.toDateString() === date.toDateString()
      );

      const tools: Record<string, number> = {};
      const features: Record<string, number> = {};

      daySessions.forEach(session => {
        session.events.forEach(event => {
          tools[event.context.tool] = (tools[event.context.tool] || 0) + 1;
          features[event.type] = (features[event.type] || 0) + 1;
        });
      });

      dailyUsage.push({
        date,
        sessions: daySessions.length,
        time: daySessions.reduce((sum, session) => sum + session.duration, 0) / (1000 * 60),
        tools,
        features
      });
    }

    return dailyUsage;
  }

  private analyzeWorkflows(sessions: UserSession[]): UserAnalytics['detailed']['workflowAnalysis'] {
    // Group events by common workflows
    const workflows = new Map<string, {
      events: UserEvent[];
      frequency: number;
      totalTime: number;
      successes: number;
    }>();

    sessions.forEach(session => {
      // Simple workflow detection based on event sequences
      const workflowKey = this.detectWorkflow(session.events);
      if (workflowKey) {
        if (!workflows.has(workflowKey)) {
          workflows.set(workflowKey, {
            events: [],
            frequency: 0,
            totalTime: 0,
            successes: 0
          });
        }
        const workflow = workflows.get(workflowKey)!;
        workflow.events.push(...session.events);
        workflow.frequency++;
        workflow.totalTime += session.duration;
        // Assume success if session completed
        if (session.endTime) workflow.successes++;
      }
    });

    return Array.from(workflows.entries()).map(([workflow, data]) => ({
      workflow,
      frequency: data.frequency,
      averageTime: data.totalTime / data.frequency / 1000, // seconds
      successRate: data.successes / data.frequency,
      bottlenecks: ['Component placement', 'Wire routing'] // Simplified
    }));
  }

  private detectWorkflow(events: UserEvent[]): string | null {
    // Simple workflow detection logic
    const eventTypes = events.map(e => e.type);
    if (eventTypes.includes('select') && eventTypes.includes('drag') && eventTypes.includes('save')) {
      return 'Component Design';
    }
    if (eventTypes.includes('simulate') && eventTypes.includes('zoom')) {
      return 'Circuit Analysis';
    }
    if (eventTypes.includes('compile') && eventTypes.includes('upload')) {
      return 'Board Programming';
    }
    return null;
  }

  private analyzeErrors(sessions: UserSession[]): UserAnalytics['detailed']['errorAnalysis'] {
    // Look for error patterns in events
    const errors: Map<string, { frequency: number; contexts: string[] }> = new Map();

    sessions.forEach(session => {
      session.events.forEach(event => {
        if (event.type === 'error' || event.data.error) {
          const errorKey = event.data.error as string || 'Unknown error';
          if (!errors.has(errorKey)) {
            errors.set(errorKey, { frequency: 0, contexts: [] });
          }
          const error = errors.get(errorKey)!;
          error.frequency++;
          error.contexts.push(event.context.page);
        }
      });
    });

    return Array.from(errors.entries()).map(([error, data]) => ({
      error,
      frequency: data.frequency,
      context: data.contexts[0] || 'Unknown',
      resolution: 'User resolved independently'
    }));
  }

  private generateInsights(sessions: UserSession[], productivityScore: number, learningScore: number): UserAnalytics['insights'] {
    const insights: UserAnalytics['insights'] = [];

    if (productivityScore < 70) {
      insights.push({
        type: 'efficiency',
        title: 'Low Productivity Detected',
        description: 'User productivity score is below optimal levels',
        impact: 'high',
        recommendation: 'Consider training on advanced tools and shortcuts',
        data: { currentScore: productivityScore, targetScore: 85 }
      });
    }

    if (learningScore < 60) {
      insights.push({
        type: 'learning',
        title: 'Learning Opportunity',
        description: 'User may benefit from additional training',
        impact: 'medium',
        recommendation: 'Suggest tutorials for unused features',
        data: { currentScore: learningScore, unusedFeatures: ['3D visualization', 'Advanced simulation'] }
      });
    }

    // Add workflow insights
    const workflowAnalysis = this.analyzeWorkflows(sessions);
    const slowWorkflows = workflowAnalysis.filter(w => w.averageTime > 300); // 5 minutes
    if (slowWorkflows.length > 0) {
      insights.push({
        type: 'workflow',
        title: 'Workflow Optimization',
        description: 'Some workflows are taking longer than expected',
        impact: 'medium',
        recommendation: 'Streamline workflow processes',
        data: { slowWorkflows: slowWorkflows.map(w => w.workflow) }
      });
    }

    return insights;
  }

  getUserSession(sessionId: string): UserSession | undefined {
    return this.sessions.get(sessionId);
  }

  getUserSessions(userId: string, limit?: number): UserSession[] {
    const userSessions = Array.from(this.sessions.values())
      .filter(session => session.userId === userId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    return limit ? userSessions.slice(0, limit) : userSessions;
  }

  getUserAnalytics(userId: string): UserAnalytics[] {
    return Array.from(this.analytics.values())
      .filter(analytics => analytics.userId === userId)
      .sort((a, b) => b.metadata.created.getTime() - a.metadata.created.getTime());
  }

  getUserBehaviorPattern(userId: string): UserBehaviorPattern | undefined {
    return this.patterns.get(userId);
  }

  updateUserBehaviorPattern(userId: string, pattern: Omit<UserBehaviorPattern, 'id' | 'userId'>): UserBehaviorPattern {
    const newPattern: UserBehaviorPattern = {
      ...pattern,
      id: `pattern_${userId}_${Date.now()}`,
      userId
    };

    this.patterns.set(userId, newPattern);
    return newPattern;
  }

  exportUserBehaviorAnalytics(userId: string): Record<string, unknown> {
    const sessions = this.getUserSessions(userId);
    const analytics = this.getUserAnalytics(userId);
    const pattern = this.getUserBehaviorPattern(userId);

    return {
      userId,
      sessions,
      analytics,
      pattern,
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface BehaviorAnalysisResult {
  success: boolean;
  error?: string;
  analyticsId?: string;
  insights?: number;
  patterns?: number;
  recommendations?: number;
  analysisTime?: number;
}

export const userBehaviorAnalyticsManager = new UserBehaviorAnalyticsManager();