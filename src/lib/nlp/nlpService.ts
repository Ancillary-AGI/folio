import { Component, Wire, Net } from '../../types';

export interface VoiceCommand {
  id: string;
  command: string;
  intent: string;
  entities: Record<string, unknown>;
  confidence: number;
  timestamp: number;
}

export interface NLPIntent {
  name: string;
  patterns: string[];
  examples: string[];
  handler: (entities: Record<string, unknown>) => Promise<unknown>;
}

export interface MLModel {
  id: string;
  name: string;
  type: 'classification' | 'regression' | 'clustering';
  trained: boolean;
  accuracy: number;
  features: string[];
  lastTrained: number;
}

export interface SmartSuggestion {
  id: string;
  type: 'component' | 'connection' | 'optimization' | 'fix';
  title: string;
  description: string;
  confidence: number;
  action: () => void;
  metadata: Record<string, unknown>;
}

export interface PredictiveInsight {
  id: string;
  type: 'performance' | 'reliability' | 'cost' | 'timeline';
  title: string;
  description: string;
  confidence: number;
  impact: 'low' | 'medium' | 'high';
  recommendation: string;
  data: Record<string, unknown>;
}

export class NLPService {
  private intents: Map<string, NLPIntent> = new Map();
  private voiceCommands: Map<string, VoiceCommand> = new Map();
  private mlModels: Map<string, MLModel> = new Map();
  private isListening: boolean = false;

  constructor() {
    this.initializeIntents();
    this.initializeMLModels();
  }

  // Voice Control
  async startVoiceListening(): Promise<void> {
    try {
      // Check for browser speech recognition support
      // @ts-expect-error - Speech recognition API types not in TypeScript standard
      const SpeechRecognition = window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;

      if (!SpeechRecognition) {
        throw new Error('Speech recognition not supported in this browser');
      }

      // @ts-expect-error - Speech recognition API types
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        this.isListening = true;
        console.log('Voice listening started');
      };

      recognition.onresult = (event: Event) => {
        // @ts-expect-error - Speech recognition result types
        const last = (event as unknown as { results: Array<Array<{ transcript: string }>> }).results.length - 1;
        // @ts-expect-error - Speech recognition result types
        const command = (event as unknown as { results: Array<Array<{ transcript: string }>> }).results[last][0].transcript;

        this.processVoiceCommand(command);
      };

      recognition.onerror = (event: Event) => {
        // @ts-expect-error - Speech recognition error types
        console.error('Speech recognition error:', (event as unknown as { error: string }).error);
      };

      recognition.onend = () => {
        this.isListening = false;
        console.log('Voice listening ended');
      };

      recognition.start();
    } catch (error) {
      console.error('Failed to start voice listening:', error);
      throw error;
    }
  }

  stopVoiceListening(): void {
    this.isListening = false;
  }

  async processVoiceCommand(command: string): Promise<unknown> {
    const voiceCommand: VoiceCommand = {
      id: `vc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      command: command.toLowerCase(),
      intent: '',
      entities: {},
      confidence: 0,
      timestamp: Date.now()
    };

    // Process command through NLP pipeline
    const processedCommand = await this.processNLP(command);
    voiceCommand.intent = processedCommand.intent;
    voiceCommand.entities = processedCommand.entities;
    voiceCommand.confidence = processedCommand.confidence;

    this.voiceCommands.set(voiceCommand.id, voiceCommand);

    // Execute command
    return await this.executeIntent(processedCommand.intent, processedCommand.entities);
  }

  // Natural Language Processing
  async processNLP(text: string): Promise<{ intent: string; entities: Record<string, unknown>; confidence: number }> {
    // Tokenize and normalize text
    const tokens = this.tokenize(text.toLowerCase());

    // Find matching intent
    let bestMatch = { intent: 'unknown', confidence: 0, entities: {} };

    for (const [intentName, intent] of this.intents) {
      const match = this.matchIntent(tokens, intent);
      if (match.confidence > bestMatch.confidence) {
        bestMatch = {
          intent: intentName,
          confidence: match.confidence,
          entities: match.entities
        };
      }
    }

    return bestMatch;
  }

  // Machine Learning-based Smart Suggestions
  async generateSmartSuggestions(context: {
    components: Component[];
    wires: Wire[];
    nets: Net[];
    currentAction?: string;
    userHistory?: string[];
  }): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Component placement suggestions
    const componentSuggestions = await this.analyzeComponentPlacement(context);
    suggestions.push(...componentSuggestions);

    // Connection suggestions
    const connectionSuggestions = await this.analyzeConnections(context);
    suggestions.push(...connectionSuggestions);

    // Optimization suggestions
    const optimizationSuggestions = await this.analyzeOptimizations(context);
    suggestions.push(...optimizationSuggestions);

    // ML-based predictions
    const predictiveSuggestions = await this.generatePredictiveSuggestions();
    suggestions.push(...predictiveSuggestions);

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  // Predictive Analytics
  async generatePredictiveInsights(projectData: {
    components: Component[];
    timeline: unknown[];
    budget: number;
    requirements: string[];
  }): Promise<PredictiveInsight[]> {
    const insights: PredictiveInsight[] = [];

    // Performance predictions
    const performanceInsight = await this.predictPerformance(projectData);
    insights.push(performanceInsight);

    // Timeline predictions
    const timelineInsight = await this.predictTimeline(projectData);
    insights.push(timelineInsight);

    // Cost predictions
    const costInsight = await this.predictCost(projectData);
    insights.push(costInsight);

    // Reliability predictions
    const reliabilityInsight = await this.predictReliability(projectData);
    insights.push(reliabilityInsight);

    return insights;
  }

  // ML Model Training and Management
  async trainMLModel(modelId: string, trainingData: Array<Record<string, unknown>>): Promise<void> {
    const model = this.mlModels.get(modelId);
    if (!model) throw new Error('Model not found');

    // Simulate training process
    console.log(`Training model ${modelId} with ${trainingData.length} samples`);

    // In a real implementation, this would train the model
    await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate training time

    model.trained = true;
    model.accuracy = 0.85 + Math.random() * 0.1; // Simulated accuracy
    model.lastTrained = Date.now();

    console.log(`Model ${modelId} trained with accuracy: ${model.accuracy}`);
  }

  async predictWithModel(modelId: string): Promise<{ prediction: number; confidence: number; features: string[] }> {
    const model = this.mlModels.get(modelId);
    if (!model || !model.trained) throw new Error('Model not trained');

    // Simulate prediction
    return {
      prediction: Math.random(),
      confidence: model.accuracy,
      features: model.features
    };
  }

  // Intent Management
  registerIntent(intent: NLPIntent): void {
    this.intents.set(intent.name, intent);
  }

  // Private methods
  private initializeIntents(): void {
    // Design intents
    this.registerIntent({
      name: 'add_component',
      patterns: ['add (a) {component_type}', 'create (a) {component_type}', 'insert {component_type}'],
      examples: ['add a resistor', 'create an LED', 'insert capacitor'],
      handler: async (entities) => {
        return { action: 'add_component', type: entities.component_type };
      }
    });

    this.registerIntent({
      name: 'connect_components',
      patterns: ['connect {component1} to {component2}', 'wire {component1} and {component2}', 'link {component1} with {component2}'],
      examples: ['connect resistor to LED', 'wire pin 1 to pin 2'],
      handler: async (entities) => {
        return { action: 'connect', from: entities.component1, to: entities.component2 };
      }
    });

    this.registerIntent({
      name: 'simulate_circuit',
      patterns: ['run simulation', 'simulate circuit', 'test the design'],
      examples: ['run simulation', 'simulate the circuit'],
      handler: async () => {
        return { action: 'simulate' };
      }
    });

    this.registerIntent({
      name: 'optimize_design',
      patterns: ['optimize design', 'improve performance', 'reduce power consumption'],
      examples: ['optimize for power', 'improve efficiency'],
      handler: async (entities) => {
        return { action: 'optimize', target: entities.target || 'general' };
      }
    });

    this.registerIntent({
      name: 'export_design',
      patterns: ['export to {format}', 'save as {format}', 'generate {format} file'],
      examples: ['export to PDF', 'save as STL', 'generate Gerber files'],
      handler: async (entities) => {
        return { action: 'export', format: entities.format };
      }
    });
  }

  private initializeMLModels(): void {
    // Component recommendation model
    this.mlModels.set('component_recommender', {
      id: 'component_recommender',
      name: 'Component Recommendation Model',
      type: 'classification',
      trained: false,
      accuracy: 0,
      features: ['circuit_type', 'power_requirements', 'frequency', 'user_history'],
      lastTrained: 0
    });

    // Design optimization model
    this.mlModels.set('design_optimizer', {
      id: 'design_optimizer',
      name: 'Design Optimization Model',
      type: 'regression',
      trained: false,
      accuracy: 0,
      features: ['component_count', 'connection_complexity', 'power_consumption', 'thermal_profile'],
      lastTrained: 0
    });

    // Failure prediction model
    this.mlModels.set('failure_predictor', {
      id: 'failure_predictor',
      name: 'Failure Prediction Model',
      type: 'regression',
      trained: false,
      accuracy: 0,
      features: ['operating_conditions', 'component_age', 'usage_patterns', 'environmental_factors'],
      lastTrained: 0
    });
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  private matchIntent(tokens: string[], intent: NLPIntent): { confidence: number; entities: Record<string, unknown> } {
    let totalMatches = 0;
    let totalWords = 0;
    const entities: Record<string, unknown> = {};

    for (const pattern of intent.patterns) {
      const patternTokens = this.tokenize(pattern);
      totalWords += patternTokens.length;

      for (let i = 0; i < patternTokens.length; i++) {
        const patternWord = patternTokens[i];
        const userWord = tokens[i];

        if (patternWord.startsWith('{') && patternWord.endsWith('}')) {
          // Entity extraction
          const entityName = patternWord.slice(1, -1);
          entities[entityName] = userWord;
          totalMatches++;
        } else if (patternWord === userWord) {
          totalMatches++;
        }
      }
    }

    const confidence = totalWords > 0 ? totalMatches / totalWords : 0;
    return { confidence, entities };
  }

  private async executeIntent(intentName: string, entities: Record<string, unknown>): Promise<unknown> {
    const intent = this.intents.get(intentName);
    if (!intent) {
      throw new Error(`Unknown intent: ${intentName}`);
    }

    return await intent.handler(entities);
  }

  private async analyzeComponentPlacement(context: { components: Component[] }): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Analyze component placement patterns
    const powerComponents = context.components.filter((c: Component) =>
      c.category.toLowerCase().includes('power') || c.category.toLowerCase().includes('regulator')
    );

    const sensitiveComponents = context.components.filter((c: Component) =>
      c.category.toLowerCase().includes('adc') || c.category.toLowerCase().includes('sensor')
    );

    if (powerComponents.length > 0 && sensitiveComponents.length > 0) {
      suggestions.push({
        id: `sugg_${Date.now()}_placement`,
        type: 'component',
        title: 'Improve Component Placement',
        description: 'Place sensitive analog components away from power supplies to reduce noise',
        confidence: 0.85,
        action: () => {
          // Implementation would move components
          console.log('Moving components for better placement');
        },
        metadata: { powerComponents: powerComponents.length, sensitiveComponents: sensitiveComponents.length }
      });
    }

    return suggestions;
  }

  private async analyzeConnections(context: { components: Component[]; wires: Wire[] }): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Check for missing bypass capacitors
    const icComponents = context.components.filter((c: Component) =>
      c.category.toLowerCase().includes('ic') || c.category.toLowerCase().includes('microcontroller')
    );

    const capacitors = context.components.filter((c: Component) =>
      c.category.toLowerCase().includes('capacitor')
    );

    for (const ic of icComponents) {
      const hasBypassCap = capacitors.some(() =>
        context.wires.some((wire: Wire) =>
          wire.netName?.toLowerCase().includes('vcc') || wire.netName?.toLowerCase().includes('power')
        )
      );

      if (!hasBypassCap) {
        suggestions.push({
          id: `sugg_${Date.now()}_bypass`,
          type: 'connection',
          title: 'Add Bypass Capacitor',
          description: `Add a bypass capacitor near ${ic.name} for power supply decoupling`,
          confidence: 0.9,
          action: () => {
            // Implementation would add capacitor component
            console.log('Adding bypass capacitor');
          },
          metadata: { component: ic.name }
        });
      }
    }

    return suggestions;
  }

  private async analyzeOptimizations(context: { components: Component[] }): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Power optimization suggestions
    const powerConsumption = this.estimatePowerConsumption(context.components);
    if (powerConsumption > 1.0) { // Watts
      suggestions.push({
        id: `sugg_${Date.now()}_power_opt`,
        type: 'optimization',
        title: 'Optimize Power Consumption',
        description: 'Consider using low-power components or implementing sleep modes',
        confidence: 0.75,
        action: () => {
          console.log('Optimizing power consumption');
        },
        metadata: { currentConsumption: powerConsumption }
      });
    }

    return suggestions;
  }

  private async generatePredictiveSuggestions(): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Use ML model for predictions
    const recommenderModel = this.mlModels.get('component_recommender');
    if (recommenderModel?.trained) {
      const prediction = await this.predictWithModel('component_recommender');

      if (prediction.prediction > 0.7) {
        suggestions.push({
          id: `sugg_${Date.now()}_ml_pred`,
          type: 'component',
          title: 'ML-Recommended Component',
          description: 'Based on your design patterns, consider adding a voltage regulator',
          confidence: prediction.confidence,
          action: () => {
            console.log('Adding ML-recommended component');
          },
          metadata: { model: 'component_recommender', prediction: prediction.prediction }
        });
      }
    }

    return suggestions;
  }

  private async predictPerformance(projectData: { components: Component[] }): Promise<PredictiveInsight> {
    const performance = this.estimatePerformance(projectData.components);

    return {
      id: `insight_${Date.now()}_perf`,
      type: 'performance',
      title: 'Performance Prediction',
      description: `Expected performance: ${performance.efficiency}% efficiency, ${performance.speed}MHz max speed`,
      confidence: 0.8,
      impact: performance.efficiency < 80 ? 'high' : 'medium',
      recommendation: performance.efficiency < 80 ? 'Consider optimizing component selection' : 'Performance looks good',
      data: performance
    };
  }

  private async predictTimeline(projectData: { components: Component[]; requirements?: string[] }): Promise<PredictiveInsight> {
    const timeline = this.estimateTimeline(projectData);

    return {
      id: `insight_${Date.now()}_timeline`,
      type: 'timeline',
      title: 'Timeline Prediction',
      description: `Estimated completion: ${timeline.days} days, ${timeline.confidence}% confidence`,
      confidence: timeline.confidence / 100,
      impact: timeline.days > 30 ? 'high' : 'medium',
      recommendation: timeline.days > 30 ? 'Consider breaking down into smaller tasks' : 'Timeline looks manageable',
      data: timeline
    };
  }

  private async predictCost(projectData: { components: Component[]; requirements?: string[]; budget: number }): Promise<PredictiveInsight> {
    const cost = this.estimateCost(projectData);

    return {
      id: `insight_${Date.now()}_cost`,
      type: 'cost',
      title: 'Cost Prediction',
      description: `Estimated cost: $${cost.total}, ${cost.confidence}% confidence`,
      confidence: cost.confidence / 100,
      impact: cost.total > projectData.budget ? 'high' : 'low',
      recommendation: cost.total > projectData.budget ? 'Consider cost optimization' : 'Cost is within budget',
      data: cost
    };
  }

  private async predictReliability(projectData: { components: Component[] }): Promise<PredictiveInsight> {
    const reliability = this.estimateReliability(projectData);

    return {
      id: `insight_${Date.now()}_reliability`,
      type: 'reliability',
      title: 'Reliability Prediction',
      description: `Expected MTBF: ${reliability.mtbf} hours, ${reliability.confidence}% confidence`,
      confidence: reliability.confidence / 100,
      impact: reliability.mtbf < 10000 ? 'high' : 'low',
      recommendation: reliability.mtbf < 10000 ? 'Consider reliability improvements' : 'Reliability looks good',
      data: reliability
    };
  }

  // Utility methods
  private estimatePowerConsumption(components: Component[]): number {
    return components.reduce((total, comp) => {
      return total + ((comp as any).parameters?.power || (comp as any).parameters?.current || 0.1);
    }, 0);
  }

  // Unused private method - kept for future use
  private inferCircuitType(_components: Component[]): string {
    const categories = _components.map(c => c.category.toLowerCase());
    if (categories.includes('microcontroller')) return 'embedded';
    if (categories.includes('opamp')) return 'analog';
    if (categories.includes('transistor')) return 'digital';
    return 'mixed';
  }

  private estimatePerformance(components: Component[]): { efficiency: number; speed: number; power: number } {
    return {
      efficiency: 85 + Math.random() * 10,
      speed: 16 + Math.random() * 48, // MHz
      power: this.estimatePowerConsumption(components)
    };
  }

  private estimateTimeline(projectData: { components: Component[]; requirements?: string[] }): { days: number; confidence: number } {
    const baseDays = projectData.components.length * 2;
    const complexityFactor = projectData.requirements?.length || 1;

    return {
      days: baseDays * complexityFactor,
      confidence: 70 + Math.random() * 20
    };
  }

  private estimateCost(projectData: { components: Component[]; requirements?: string[] }): { total: number; confidence: number } {
    const baseCost = projectData.components.length * 0.5;
    const premiumFactor = projectData.requirements?.includes('high-reliability') ? 2 : 1;

    return {
      total: baseCost * premiumFactor,
      confidence: 75 + Math.random() * 15
    };
  }

  private estimateReliability(projectData: { components: Component[] }): { mtbf: number; confidence: number } {
    const baseMTBF = 50000;
    const componentFactor = 1 / Math.sqrt(projectData.components.length);

    return {
      mtbf: baseMTBF * componentFactor,
      confidence: 65 + Math.random() * 20
    };
  }

  getVoiceCommands(): VoiceCommand[] {
    return Array.from(this.voiceCommands.values());
  }

  getMLModels(): MLModel[] {
    return Array.from(this.mlModels.values());
  }

  isVoiceListening(): boolean {
    return this.isListening;
  }
}

export const nlpService = new NLPService();