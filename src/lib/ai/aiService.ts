import type { Component, Wire, Net } from '../../types';
import { parseSpiceValue } from '../simulation/devices';

export interface AIAgent {
  id: string;
  name: string;
  type: 'optimization' | 'design' | 'analysis' | 'prediction';
  capabilities: string[];
  model: string;
  parameters: Record<string, unknown>;
}

export interface DesignOptimizationRequest {
  components: Component[];
  constraints: Record<string, unknown>;
  objectives: string[];
  currentDesign?: Record<string, unknown>;
}

export interface OptimizationResult {
  optimizedDesign: Record<string, unknown>;
  improvements: Array<{
    parameter: string;
    originalValue: unknown;
    optimizedValue: unknown;
    improvement: number;
  }>;
  confidence: number;
  reasoning: string;
}

/**
 * A maintenance prediction is a category-level heuristic, not a datasheet
 * reliability calculation, and it says so: `basis` records which inputs the
 * stress multiplier could actually be evaluated against and which the design
 * left undeclared.
 */
export interface PredictiveMaintenancePrediction {
  componentId: string;
  failureProbability: number;
  timeToFailure: number; // hours
  failureMode: string;
  /** 0.2 per stress axis the design answered (thermal, voltage, current), max 0.8. */
  confidence: number;
  basis: string;
  inputsMissing: string[];
  recommendations: string[];
}

export interface SmartSuggestion {
  type: 'component' | 'connection' | 'layout' | 'parameter';
  confidence: number;
  suggestion: string;
  reasoning: string;
  location?: { x: number; y: number };
  action?: () => void;
}

function getCategoryName(component: Component): string {
  const category: unknown = component.category
  if (typeof category === 'string') return category
  if (category && typeof category === 'object' && 'name' in category && typeof category.name === 'string') {
    return category.name
  }
  return 'unknown'
}

/** Short human handle for a component in a gap message: name when known, else id. */
function partLabel(component: Component): string {
  return typeof component.name === 'string' && component.name.trim() !== ''
    ? `${component.name} (${component.id})`
    : component.id
}

/** How a prediction came out, including which inputs were missing. */
interface StressAssessment {
  factor: number;
  /** Stress axes with enough declared data to be compared at all (0–3). */
  evaluatedAxes: number;
  evidence: string[];
  gaps: string[];
}

/**
 * Rule-based design assistant. Everything here is deterministic heuristics
 * (keyword matching, declared-property estimates, threshold rules); it makes
 * no model or network call, so results are advisory and not statistical
 * predictions. The heuristic thresholds are documented where they are used.
 */
export class AIService {
  private agents: Map<string, AIAgent> = new Map();

  constructor() {
    this.initializeAgents();
  }

  private initializeAgents(): void {
    // Design optimization agent
    this.agents.set('design_optimizer', {
      id: 'design_optimizer',
      name: 'Design Optimization Agent',
      type: 'optimization',
      capabilities: ['circuit_optimization', 'layout_optimization', 'thermal_optimization', 'power_optimization'],
      model: 'rule-based-heuristics', // no model call is made by this service
      parameters: {}
    });

    // Predictive maintenance agent
    this.agents.set('predictive_maintenance', {
      id: 'predictive_maintenance',
      name: 'Predictive Maintenance Agent',
      type: 'prediction',
      capabilities: ['failure_prediction', 'lifetime_estimation', 'maintenance_scheduling'],
      model: 'rule-based-heuristics', // no model call is made by this service
      parameters: {}
    });

    // Smart suggestions agent
    this.agents.set('smart_suggestions', {
      id: 'smart_suggestions',
      name: 'Smart Suggestions Agent',
      type: 'design',
      capabilities: ['component_recommendation', 'connection_suggestion', 'design_improvement'],
      model: 'rule-based-heuristics', // no model call is made by this service
      parameters: {}
    });

    // Analysis agent
    this.agents.set('circuit_analyzer', {
      id: 'circuit_analyzer',
      name: 'Circuit Analysis Agent',
      type: 'analysis',
      capabilities: ['circuit_analysis', 'debugging', 'performance_analysis'],
      model: 'rule-based-heuristics', // no model call is made by this service
      parameters: {}
    });
  }

  async recommendComponents(query: string): Promise<Array<{
    component: string;
    reason: string;
    confidence: number;
    alternatives?: Array<{ component: string; reason: string; confidence: number }>;
    cost?: number;
    availability?: string;
  }>> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    // Component recommendation based on query
    const queryLower = query.toLowerCase();
    const recommendations: Array<{
      component: string;
      reason: string;
      confidence: number;
      alternatives?: Array<{ component: string; reason: string; confidence: number }>;
      cost?: number;
      availability?: string;
    }> = [];

    // Simple keyword-based matching (in production, this would use ML/NLP)
    if (queryLower.includes('resistor') || queryLower.includes('10k')) {
      recommendations.push({
        component: 'Resistor 10kΩ',
        reason: 'Matches query for resistor component',
        confidence: 0.9,
        alternatives: [
          { component: 'Resistor 1kΩ', reason: 'Alternative resistance value', confidence: 0.7 },
          { component: 'Resistor 100kΩ', reason: 'Alternative resistance value', confidence: 0.7 }
        ],
        cost: 0.1,
        availability: 'available'
      });
    }

    if (queryLower.includes('capacitor')) {
      recommendations.push({
        component: 'Capacitor 100nF',
        reason: 'Matches query for capacitor component',
        confidence: 0.85,
        cost: 0.15,
        availability: 'available'
      });
    }

    if (queryLower.includes('led')) {
      recommendations.push({
        component: 'LED Red 5mm',
        reason: 'Matches query for LED component',
        confidence: 0.9,
        cost: 0.2,
        availability: 'available'
      });
    }

    // Default recommendation if no specific match
    if (recommendations.length === 0) {
      recommendations.push({
        component: 'Generic Component',
        reason: 'General purpose component recommendation',
        confidence: 0.5,
        cost: 1.0,
        availability: 'available'
      });
    }

    return recommendations;
  }

  async optimizeDesign(request: DesignOptimizationRequest): Promise<OptimizationResult> {
    const agent = this.agents.get('design_optimizer');
    if (!agent) throw new Error('Design optimization agent not found');

    try {
      // Analyze current design
      const analysis = await this.analyzeDesign(request.components);

      // Generate optimization suggestions
      const suggestions = await this.generateOptimizationSuggestions(request, analysis);

      // Apply optimizations
      const optimizedDesign = await this.applyOptimizations(request, suggestions);

      // Calculate improvements
      const improvements = this.calculateImprovements(request.currentDesign, optimizedDesign, request.objectives);

      return {
        optimizedDesign,
        improvements,
        confidence: 0.85, // Heuristic score from rule coverage, not a measured probability
        reasoning: suggestions.length > 0
          ? `Advisory passes flagged: ${suggestions.map(s => s.type.replace(/_/g, ' ')).join(', ')}. Measured deltas are reported only when the supplied baseline defines the corresponding objective.`
          : 'No optimization rule was triggered by this design (power ≤ 1 W, estimated temperature ≤ 70 °C, cost ≤ 50).'
      };
    } catch (error) {
      console.error('Design optimization failed:', error);
      throw error;
    }
  }

  /**
   * Predict for the component records the caller actually has.
   *
   * The previous single-id overload built a stand-in `Component` (category
   * "unknown", availability "available", empty properties) so a bare id could
   * still produce a number. That number was about a part nobody declared, so the
   * overload is gone: pass the design's components, or nothing is predicted.
   */
  async predictMaintenance(
    components: Component[],
    operatingConditions?: Record<string, unknown>
  ): Promise<PredictiveMaintenancePrediction[]> {
    const agent = this.agents.get('predictive_maintenance');
    if (!agent) throw new Error('Predictive maintenance agent not found');

    const predictions: PredictiveMaintenancePrediction[] = [];
    for (const component of components) {
      predictions.push(await this.predictComponentFailure(component, operatingConditions || {}));
    }
    return predictions;
  }

  async getSmartSuggestions(context: {
    components: Component[];
    wires: Wire[];
    currentAction?: string;
    cursorPosition?: { x: number; y: number };
  }): Promise<SmartSuggestion[]> {
    const agent = this.agents.get('smart_suggestions');
    if (!agent) throw new Error('Smart suggestions agent not found');

    const suggestions: SmartSuggestion[] = [];

    // Component placement suggestions
    const placementSuggestions = await this.analyzeComponentPlacement(context.components);
    suggestions.push(...placementSuggestions);

    // Connection suggestions
    const connectionSuggestions = await this.analyzeConnections(context.components, context.wires);
    suggestions.push(...connectionSuggestions);

    // Parameter optimization suggestions
    const parameterSuggestions = await this.analyzeParameters(context.components);
    suggestions.push(...parameterSuggestions);

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  // Alias for backward compatibility
  async suggestComponents(query: string, constraints?: Record<string, unknown>): Promise<Array<{
    component: string;
    reason: string;
    confidence: number;
    alternatives?: Array<{ component: string; reason: string; confidence: number }>;
    cost?: number;
    availability?: string;
  }>> {
    const recommendations = await this.recommendComponents(query)
    const details = Object.entries(constraints ?? {})
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ')
    if (!details) return recommendations
    return recommendations.map((recommendation) => ({
      ...recommendation,
      reason: `${recommendation.reason}; design constraints considered: ${details}`,
    }))
  }

  async analyzeCircuit(components: Component[], wires: Wire[], nets: Net[]): Promise<{
    analysis: string;
    issues: Array<{ severity: 'error' | 'warning' | 'info'; message: string }>;
    recommendations: string[];
  }> {
    const agent = this.agents.get('circuit_analyzer');
    if (!agent) throw new Error('Circuit analyzer agent not found');

    // Perform comprehensive circuit analysis
    const analysis = await this.performCircuitAnalysis(components, wires, nets);
    const issues = await this.identifyCircuitIssues(components, wires, nets);
    const recommendations = await this.generateCircuitRecommendations(analysis, issues);

    return {
      analysis,
      issues,
      recommendations
    };
  }

  private async analyzeDesign(components: Component[]): Promise<{
    componentCount: number;
    powerConsumption: number;
    thermalProfile: { maxTemp: number; hotspots: unknown[]; averageTemp: number };
    complexity: number;
    cost: number;
  }> {
    // Analyze design characteristics
    const analysis = {
      componentCount: components.length,
      powerConsumption: this.estimatePowerConsumption(components),
      thermalProfile: this.analyzeThermalProfile(components),
      complexity: this.calculateDesignComplexity(components),
      cost: this.estimateDesignCost(components)
    };

    return analysis;
  }

  private async generateOptimizationSuggestions(
    _request: DesignOptimizationRequest, 
    analysis: { powerConsumption: number; thermalProfile: { maxTemp: number }; cost: number }
  ): Promise<Array<{
    type: string;
    target: string;
    suggestion: string;
    potentialSavings?: number;
    potentialImprovement?: number;
  }>> {
    const suggestions = [];

    // Power optimization
    if (analysis.powerConsumption > 1.0) { // Watts
      suggestions.push({
        type: 'power_optimization',
        target: 'power_consumption',
        suggestion: 'Consider using low-power components or sleep modes',
        potentialSavings: analysis.powerConsumption * 0.3
      });
    }

    // Thermal optimization
    if (analysis.thermalProfile.maxTemp > 70) { // Celsius
      suggestions.push({
        type: 'thermal_optimization',
        target: 'thermal_management',
        suggestion: 'Add heat sinks or improve ventilation',
        potentialImprovement: analysis.thermalProfile.maxTemp - 60
      });
    }

    // Cost optimization
    if (analysis.cost > 50) { // Dollars
      suggestions.push({
        type: 'cost_optimization',
        target: 'component_selection',
        suggestion: 'Consider cheaper alternatives for non-critical components',
        potentialSavings: analysis.cost * 0.2
      });
    }

    return suggestions;
  }

  private async applyOptimizations(
    request: DesignOptimizationRequest, 
    suggestions: Array<{ type: string; target?: string; suggestion?: string }>
  ): Promise<Record<string, unknown>> {
    // Apply selected optimizations to create optimized design
    let optimizedDesign = { ...request.currentDesign } as Record<string, unknown>;

    for (const suggestion of suggestions) {
      switch (suggestion.type) {
        case 'power_optimization':
          optimizedDesign = this.applyPowerOptimization(optimizedDesign);
          break;
        case 'thermal_optimization':
          optimizedDesign = this.applyThermalOptimization(optimizedDesign);
          break;
        case 'cost_optimization':
          optimizedDesign = this.applyCostOptimization(optimizedDesign);
          break;
      }
    }

    return optimizedDesign;
  }

  private calculateImprovements(
    original: Record<string, unknown> | undefined, 
    optimized: Record<string, unknown>, 
    objectives: string[]
  ): Array<{
    parameter: string;
    originalValue: unknown;
    optimizedValue: unknown;
    improvement: number;
  }> {
    const improvements = [];

    for (const objective of objectives) {
      const originalValue = this.getObjectiveValue(original, objective);
      const optimizedValue = this.getObjectiveValue(optimized, objective);

      // Only report a measured delta when a baseline value actually exists;
      // a fabricated default would advertise an improvement that never happened.
      if (originalValue !== undefined && optimizedValue !== undefined && originalValue !== 0) {
        const improvement = this.calculateImprovementMetric(objective, originalValue, optimizedValue);
        improvements.push({
          parameter: objective,
          originalValue,
          optimizedValue,
          improvement
        });
      }
    }

    return improvements;
  }

  /**
   * Stress-adjusted MTBF turned into a probability over a stated mission window.
   *
   * The number is only as good as the inputs behind it: `confidence` counts the
   * stress axes the design actually answered (max 0.8 for all three), and `basis`
   * names the MTBF source, the multiplier's evidence and the mission hours.
   * Undeclared inputs are no longer replaced by invented ones.
   */
  private async predictComponentFailure(component: Component, conditions: Record<string, unknown>): Promise<PredictiveMaintenancePrediction> {
    const category = getCategoryName(component);
    const mtbf = this.getMeanTimeBetweenFailures(category);
    const stress = this.assessStress(component, conditions);
    const horizon = this.missionHorizon(conditions);
    const stressedMtbfHours = mtbf.hours / stress.factor;
    const failureProbability = 1 - Math.exp(-horizon.hours / stressedMtbfHours);
    const confidence = Math.round((0.2 + 0.2 * stress.evaluatedAxes) * 100) / 100;

    const basis = [
      `Baseline MTBF ${mtbf.hours.toLocaleString()} h for "${category}"${mtbf.declared ? '' : ' (generic — this model has no figure for that category)'}.`,
      `Stress x${stress.factor.toFixed(2)} → ${Math.round(stressedMtbfHours).toLocaleString()} h MTBF.`,
      stress.evidence.length > 0 ? `Evidence: ${stress.evidence.join('; ')}.` : 'No declared operating data, so no derating was applied.',
      horizon.declared
        ? `Probability over the declared ${horizon.hours.toLocaleString()} h mission.`
        : `Probability over the 8,760 h (one year) window used when no mission length is declared.`,
      'Constant-failure-rate exponential model — a category heuristic, not a datasheet reliability calculation.',
      stress.gaps.length > 0 ? `Not evaluated: ${stress.gaps.join('; ')}.` : '',
    ].filter(Boolean).join(' ');

    return {
      componentId: component.id,
      failureProbability,
      timeToFailure: stressedMtbfHours,
      failureMode: this.predictFailureMode(component),
      confidence,
      basis,
      inputsMissing: stress.gaps,
      recommendations: this.generateMaintenanceRecommendations(component, failureProbability),
    };
  }

  private async analyzeComponentPlacement(components: Component[]): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Check for components that should be placed near each other
    const powerComponents = components.filter(c => getCategoryName(c).toLowerCase().includes('power'));
    const sensitiveComponents = components.filter(c =>
      getCategoryName(c).toLowerCase().includes('adc') ||
      getCategoryName(c).toLowerCase().includes('sensor')
    );

    if (powerComponents.length > 0 && sensitiveComponents.length > 0) {
      suggestions.push({
        type: 'layout',
        confidence: 0.8,
        suggestion: 'Place sensitive analog components away from power supplies to reduce noise',
        reasoning: 'Power supplies can introduce electrical noise that affects analog signal integrity'
      });
    }

    return suggestions;
  }

  private async analyzeConnections(components: Component[], wires: Wire[]): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Check for missing bypass capacitors
    const icComponents = components.filter(c => getCategoryName(c).toLowerCase().includes('ic'));
    const capacitors = components.filter(c => getCategoryName(c).toLowerCase().includes('capacitor'));

    for (const ic of icComponents) {
      const hasBypassCap = capacitors.some(cap =>
        wires.some(wire =>
          (wire.connectedPins.some((pin: { componentId: string }) => pin.componentId === ic.id) &&
           wire.connectedPins.some((pin: { componentId: string }) => pin.componentId === cap.id))
        )
      );

      if (!hasBypassCap) {
        suggestions.push({
          type: 'component',
          confidence: 0.9,
          suggestion: `Add bypass capacitor near ${ic.name} for power supply decoupling`,
          reasoning: 'Bypass capacitors reduce power supply noise and improve circuit stability'
        });
      }
    }

    return suggestions;
  }

  private async analyzeParameters(components: Component[]): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = [];

    // Check resistor values for standard values
    const resistors = components.filter(c => getCategoryName(c).toLowerCase().includes('resistor'));

    for (const resistor of resistors) {
      const value = typeof resistor.properties?.value === 'number' ? resistor.properties.value : undefined;
      if (value && !this.isStandardResistorValue(value)) {
        const nearestStandard = this.findNearestStandardValue(value);
        suggestions.push({
          type: 'parameter',
          confidence: 0.7,
          suggestion: `Change ${resistor.name} from ${value}Ω to ${nearestStandard}Ω (standard value)`,
          reasoning: 'Using standard resistor values reduces cost and improves availability'
        });
      }
    }

    return suggestions;
  }

  private async performCircuitAnalysis(components: Component[], wires: Wire[], nets: Net[]): Promise<string> {
    // Guard the empty-canvas case: dividing by zero would print Infinity.
    const averageConnections = components.length === 0
      ? 0
      : (wires.length * 2) / components.length;
    // Generate comprehensive circuit analysis
    const analysis = `
Circuit Analysis Report:
- Total Components: ${components.length}
- Total Nets: ${nets.length}
- Total Connections: ${wires.length}

Power Analysis:
- Estimated Power Consumption: ${this.estimatePowerConsumption(components)}W

Signal Integrity:
- Timing-Sensitive Nets: ${this.identifyTimingSensitiveNets(wires).length}
- Potential Noise Sources: ${this.identifyNoiseSources(components).length}

Design Complexity:
- Component Diversity: ${new Set(components.map(c => c.category)).size} categories
- Average Connections per Component: ${averageConnections}
    `.trim();

    return analysis;
  }

  private async identifyCircuitIssues(components: Component[], wires: Wire[], nets: Net[]): Promise<Array<{ severity: 'error' | 'warning' | 'info'; message: string }>> {
    const issues: Array<{ severity: 'error' | 'warning' | 'info'; message: string }> = [];

    // Check for floating inputs
    const floatingInputs = this.findFloatingInputs(components, wires);
    floatingInputs.forEach(input => {
      issues.push({
        severity: 'warning',
        message: `Input pin ${input.pin} of ${input.component} is not connected`
      });
    });

    // Check for short circuits
    const shortCircuits = this.detectShortCircuits(components, nets);
    shortCircuits.forEach(short => {
      issues.push({
        severity: 'error',
        message: `Potential short circuit on net ${short.netName}: ${short.reason}`
      });
    });

    return issues;
  }

  private async generateCircuitRecommendations(_analysis: string, issues: Array<{ severity: string; message: string }>): Promise<string[]> {
    const recommendations = [];

    if (issues.some(issue => issue.severity === 'error')) {
      recommendations.push('Fix all critical errors before proceeding');
    }

    if (issues.some(issue => issue.message.includes('floating'))) {
      recommendations.push('Connect all floating inputs to prevent undefined behavior');
    }

    if (issues.some(issue => issue.message.includes('short'))) {
      recommendations.push('Review power and ground connections to eliminate short circuits');
    }

    recommendations.push('Consider adding decoupling capacitors for IC power pins');
    recommendations.push('Review trace widths for power and signal integrity');

    return recommendations;
  }

  // Utility methods
  private estimatePowerConsumption(components: Component[]): number {
    let totalPower = 0;
    for (const comp of components) {
      const declaredPower = typeof comp.properties?.power === 'number' ? comp.properties.power : 0;
      if (declaredPower !== 0) {
        totalPower += declaredPower;
        continue;
      }
      // Without a declared dissipation, I·V is the only computable estimate.
      // A current with no voltage is not power and must not be added as if it were.
      const current = typeof comp.properties?.current === 'number' ? comp.properties.current : 0;
      const voltage = typeof comp.properties?.voltage === 'number' ? comp.properties.voltage : 0;
      totalPower += current * voltage;
    }
    return totalPower;
  }

  private analyzeThermalProfile(components: Component[] = []): { maxTemp: number; hotspots: unknown[]; averageTemp: number } {
    // First-order estimate from declared dissipation; a real thermal solve
    // needs package models, layout and boundary conditions.
    const watts = components.reduce((sum, comp) => {
      const power = typeof comp.properties?.power === 'number' ? comp.properties.power : 0;
      return sum + power;
    }, 0);
    const risePerWatt = 12; // K/W board-level heuristic, documented in the panel copy
    const averageTemp = 25 + watts * risePerWatt;
    return {
      maxTemp: Math.round((averageTemp + watts * 4) * 10) / 10,
      hotspots: [],
      averageTemp: Math.round(averageTemp * 10) / 10
    };
  }

  private calculateDesignComplexity(components: Component[]): number {
    return components.length * 0.1; // Simplified metric
  }

  private estimateDesignCost(components: Component[]): number {
    let totalCost = 0;
    components.forEach(comp => {
      const cost = typeof comp.properties.cost === 'number' ? comp.properties.cost : typeof comp.cost === 'number' ? comp.cost : 1.0;
      totalCost += cost;
    });
    return totalCost;
  }

  private applyPowerOptimization(design: Record<string, unknown>): Record<string, unknown> {
    // Apply power optimization logic
    return { ...design, powerOptimized: true };
  }

  private applyThermalOptimization(design: Record<string, unknown>): Record<string, unknown> {
    // Apply thermal optimization logic
    return { ...design, thermalOptimized: true };
  }

  private applyCostOptimization(design: Record<string, unknown>): Record<string, unknown> {
    // Apply cost optimization logic
    return { ...design, costOptimized: true };
  }

  private getObjectiveValue(design: Record<string, unknown> | undefined, objective: string): number | undefined {
    if (!design) return undefined;
    switch (objective) {
      case 'power': return typeof design.powerConsumption === 'number' ? design.powerConsumption : undefined;
      case 'cost': return typeof design.cost === 'number' ? design.cost : undefined;
      case 'performance': return typeof design.performance === 'number' ? design.performance : undefined;
      default: return undefined;
    }
  }

  private calculateImprovementMetric(objective: string, original: number, optimized: number): number {
    switch (objective) {
      case 'power':
      case 'cost':
        return ((original - optimized) / original) * 100; // Percentage improvement
      case 'performance':
        return ((optimized - original) / original) * 100; // Percentage improvement
      default:
        return 0;
    }
  }

  /**
   * Category MTBFs in hours. These are generic handbook-scale figures, not
   * part-specific ratings, so callers get `declared: false` whenever the part's
   * category has no entry and the number is the catch-all 100 kh.
   */
  private getMeanTimeBetweenFailures(category: string): { hours: number; declared: boolean } {
    const mtbf: Record<string, number> = {
      'capacitor': 100000,
      'resistor': 500000,
      'ic': 50000,
      'transistor': 100000,
      'diode': 200000
    };
    const hours = mtbf[category.toLowerCase()];
    return hours === undefined ? { hours: 100000, declared: false } : { hours, declared: true };
  }

  /**
   * The window the failure probability is quoted over. A probability without a
   * mission time is meaningless, so the horizon is either supplied by the caller
   * or stated as the one year default used here.
   */
  private missionHorizon(conditions: Record<string, unknown>): { hours: number; declared: boolean } {
    const hours = this.declaredNumber(conditions.missionHours);
    return hours === null || hours <= 0
      ? { hours: 8760, declared: false }
      : { hours, declared: true };
  }

  /**
   * Stress multipliers only from data the design supplies.
   *
   * Each axis needs both ends of the comparison: an applied value and a rating.
   * Missing either one records a gap instead of substituting the 25 °C / 5 V /
   * 0.1 A the previous version assumed, which turned an undeclared design into a
   * confidently "stressed" or "unstressed" one depending on nobody's input.
   */
  private assessStress(component: Component, conditions: Record<string, unknown>): StressAssessment {
    let factor = 1.0;
    let evaluatedAxes = 0;
    const evidence: string[] = [];
    const gaps: string[] = [];

    const temperature = this.declaredNumber(conditions.temperature);
    if (temperature === null) {
      gaps.push('operating temperature was not supplied, so thermal stress is unevaluated');
    } else if (temperature > 70) {
      factor *= 2.0;
      evaluatedAxes += 1;
      evidence.push(`${temperature} °C exceeds the 70 °C derating knee (x2.0)`);
    } else if (temperature > 50) {
      factor *= 1.5;
      evaluatedAxes += 1;
      evidence.push(`${temperature} °C exceeds the 50 °C knee (x1.5)`);
    } else {
      evaluatedAxes += 1;
      evidence.push(`${temperature} °C is below the 50 °C knee (no thermal multiplier)`);
    }

    const appliedVoltage = this.declaredNumber(conditions.voltage);
    const ratedVoltage = this.declaredNumber(component.properties?.voltage);
    if (appliedVoltage === null) {
      gaps.push('applied voltage was not supplied');
    } else if (ratedVoltage === null) {
      gaps.push(`${partLabel(component)} declares no voltage rating, so ${appliedVoltage} V cannot be compared to one`);
    } else {
      evaluatedAxes += 1;
      if (appliedVoltage > ratedVoltage * 1.1) {
        factor *= 1.8;
        evidence.push(`${appliedVoltage} V on a ${ratedVoltage} V part is over the 110% limit (x1.8)`);
      } else {
        evidence.push(`${appliedVoltage} V against a ${ratedVoltage} V rating (no voltage multiplier)`);
      }
    }

    const appliedCurrent = this.declaredNumber(conditions.current);
    const ratedCurrent = this.declaredNumber(component.properties?.current);
    if (appliedCurrent === null) {
      gaps.push('load current was not supplied');
    } else if (ratedCurrent === null) {
      gaps.push(`${partLabel(component)} declares no current rating, so ${appliedCurrent} A cannot be compared to one`);
    } else {
      evaluatedAxes += 1;
      if (appliedCurrent > ratedCurrent * 0.8) {
        factor *= 1.6;
        evidence.push(`${appliedCurrent} A on a ${ratedCurrent} A part exceeds 80% of rating (x1.6)`);
      } else {
        evidence.push(`${appliedCurrent} A against a ${ratedCurrent} A rating (no current multiplier)`);
      }
    }

    return { factor, evaluatedAxes, evidence, gaps };
  }

  /**
   * Declared values arrive either as numbers or as SPICE-style strings ("50V",
   * "100u"). Anything absent, unparsable or non-finite is reported as missing —
   * the caller sees a gap rather than a fabricated number.
   */
  private declaredNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '') return null;
    try {
      const parsed = parseSpiceValue(value, 'declared value');
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private predictFailureMode(component: Component): string {
    const categoryName = getCategoryName(component);
    switch (categoryName.toLowerCase()) {
      case 'capacitor': return 'Electrolytic failure';
      case 'resistor': return 'Open circuit';
      case 'ic': return 'Logic failure';
      case 'transistor': return 'Short circuit';
      case 'diode': return 'Reverse breakdown';
      default: return 'Component failure';
    }
  }

  private generateMaintenanceRecommendations(_component: Component, failureProb: number): string[] {
    const recommendations = [];

    if (failureProb > 0.1) {
      recommendations.push('Schedule immediate inspection');
    } else if (failureProb > 0.05) {
      recommendations.push('Monitor component parameters closely');
    }

    recommendations.push('Check operating conditions are within specifications');
    recommendations.push('Consider component replacement during next maintenance cycle');

    return recommendations;
  }

  private isStandardResistorValue(value: number): boolean {
    const standardValues = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82,
                           100, 120, 150, 180, 220, 270, 330, 390, 470, 560, 680, 820];
    const multipliers = [1, 10, 100, 1000, 10000];

    for (const multiplier of multipliers) {
      for (const stdValue of standardValues) {
        if (Math.abs(value - stdValue * multiplier) < 0.1) {
          return true;
        }
      }
    }

    return false;
  }

  private findNearestStandardValue(value: number): number {
    const standardValues = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82,
                           100, 120, 150, 180, 220, 270, 330, 390, 470, 560, 680, 820];
    const multipliers = [1, 10, 100, 1000, 10000];

    let nearest = value;
    let minDiff = Infinity;

    for (const multiplier of multipliers) {
      for (const stdValue of standardValues) {
        const stdResistor = stdValue * multiplier;
        const diff = Math.abs(value - stdResistor);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = stdResistor;
        }
      }
    }

    return nearest;
  }

  private identifyTimingSensitiveNets(wires: Wire[]): Wire[] {
    // Clock/data-named nets are flagged for review; this is a naming heuristic,
    // not a timing analysis of the routed connectivity.
    return wires.filter(wire => wire.netName?.toLowerCase().includes('clock') ||
                  wire.netName?.toLowerCase().includes('data'));
  }

  private identifyNoiseSources(components: Component[]): Component[] {
    return components.filter(c => getCategoryName(c).toLowerCase().includes('motor') ||
                                 getCategoryName(c).toLowerCase().includes('relay') ||
                                 getCategoryName(c).toLowerCase().includes('switch'));
  }

  private findFloatingInputs(components: Component[], wires: Wire[]): Array<{ component: string; pin: string }> {
    const floatingInputs: Array<{ component: string; pin: string }> = [];

    for (const component of components) {
      if (component.pins) {
        for (const pin of component.pins) {
          if (pin.type === 'input') {
            const isConnected = wires.some(wire =>
              wire.connectedPins.some((cp: { componentId: string; pinId: string }) => cp.componentId === component.id && cp.pinId === pin.id)
            );

            if (!isConnected) {
              floatingInputs.push({
                component: component.name,
                pin: pin.name
              });
            }
          }
        }
      }
    }

    return floatingInputs;
  }

  private detectShortCircuits(
    components: Component[],
    nets: Net[],
  ): Array<{ netName: string; reason: string }> {
    const pinType = new Map<string, string>();
    for (const component of components) {
      for (const pin of component.pins ?? []) {
        pinType.set(`${component.id}:${pin.id}`, pin.type);
      }
    }

    const shorts: Array<{ netName: string; reason: string }> = [];
    for (const net of nets) {
      const types = net.connectedPins.map(
        cp => pinType.get(`${cp.componentId}:${cp.pinId}`),
      );
      const outputPins = types.filter(type => type === 'output').length;
      if (types.includes('power') && types.includes('ground')) {
        shorts.push({ netName: net.name, reason: 'the net ties a power pin to a ground pin' });
      } else if (outputPins > 1) {
        shorts.push({ netName: net.name, reason: `${outputPins} output pins drive the same net` });
      }
    }

    return shorts;
  }

  /**
   * Generate a contextual natural-language response for general queries that don't
   * match a specific structured action. In production this would call an LLM API;
   * here we produce a high-quality heuristic response using the available circuit
   * context and the resolved NLP intent.
   */
  async generateContextualResponse(
    query: string,
    nlpResult: { intent: string; entities: Record<string, unknown>; confidence: number },
    ctx: { components: Component[]; wires: Wire[]; workspaceMode: string },
  ): Promise<string> {
    const { components, wires, workspaceMode } = ctx
    const lower = query.toLowerCase()

    // ── Intent-driven structured answers ──────────────────────────────────────
    if (nlpResult.intent === 'add_component' && nlpResult.confidence > 0.4) {
      const recs = await this.recommendComponents(query)
      if (recs.length) {
        return `To add a ${nlpResult.entities.component_type || 'component'} I recommend:\n\n` +
          recs.slice(0, 3).map((r, i) => `${i + 1}. **${r.component}** — ${r.reason}`).join('\n') +
          '\n\nDrag the component from the library panel onto the canvas to place it.'
      }
    }

    if (nlpResult.intent === 'simulate_circuit') {
      return `To run a simulation:\n1. Open the **Schematic** workspace\n2. Open **Simulation** from the toolbar\n3. Pick an analysis (DC, DC sweep, transient, AC, noise, Monte Carlo, digital timing) and run it\n4. Inspect node voltages/waveforms and resolve any singular-circuit error\n\nThe solver covers passives, diodes, BJTs, MOSFETs, JFETs, op-amps, switches and behavioral sources with DC/PULSE/SINE/EXP/SFFM/PWL excitation. This design has **${components.length} components** and **${wires.length} wires**; results still depend on correct connectivity and component values.`
    }

    if (nlpResult.intent === 'export_design') {
      const fmt = String(nlpResult.entities.format || '').toUpperCase()
      return `To export as **${fmt || 'your chosen format'}**:\n• Click the **Export** button in the top toolbar\n• Select the desired format (Gerber, Netlist, JSON, Image, BOM)\n\nAvailable formats: PNG image, SPICE netlist, JSON schematic, Gerber PCB layers, Bill of Materials CSV.`
    }

    // ── Workspace-aware context answers ───────────────────────────────────────
    if (workspaceMode === 'siem' && (lower.includes('threat') || lower.includes('securit') || lower.includes('compli'))) {
      return `In the **SIEM workspace** you can:\n• View real-time security events and anomaly alerts\n• Run compliance checks against ISO 27001, IEC 62443, NIST frameworks\n• Review audit trails for all design actions\n• Monitor IoT/robotic fleet devices for unusual behaviour\n\nClick **Inject probe event** to test threat detection, or **Run compliance check** for a full audit.`
    }

    if (workspaceMode === 'fpga' && (lower.includes('hdl') || lower.includes('vhdl') || lower.includes('verilog') || lower.includes('fpga'))) {
      return `In the **FPGA workspace** you can write structural HDL (VHDL or Verilog) and elaborate it for a target device.\n\nSupported targets: Xilinx XC7A35T (Artix-7), Intel Cyclone 10, Lattice ECP5, Gowin GW1N-9.\n\nThe elaboration reports:\n• Parsed gate count and LUT estimate\n• Flip-flop count\n• A portable design manifest\n\nTiming/Fmax, BRAM/DSP inference, vendor bitstream assembly and device programming require the vendor place-and-route toolchain and are not fabricated here.`
    }

    if (workspaceMode === 'robotics' && (lower.includes('kinematic') || lower.includes('robot') || lower.includes('joint'))) {
      return `The **Robotics workspace** supports:\n• 6-DOF arm forward & inverse kinematics\n• Joint angle control with drag sliders\n• Trajectory planning and collision checking\n• Digital twin synchronisation with physical devices\n• Agentic AI-driven motion optimisation\n\nUse the joint sliders to set a target pose or enter Cartesian coordinates for IK solving.`
    }

    // ── Generic context-aware fallback ────────────────────────────────────────
    const compCount = components.length
    const wireCount = wires.length
    const netCount = new Set(wires.map(w => w.netName).filter(Boolean)).size

    if (compCount === 0) {
      return `Your design canvas is empty. To get started:\n1. Browse the **Component Library** (left sidebar)\n2. Drag components onto the **Schematic** canvas\n3. Use the **Wire** tool to connect pins\n4. Run **Simulation** to validate\n\nI can help you pick components — just describe what you're building!`
    }

    // Build a brief design summary as the response
    const categories = [...new Set(components.map(component => component.category))]
    const summary = [
      `Here's what I see in your current design:\n`,
      `• **${compCount} components** across ${categories.length} categories: ${categories.slice(0, 5).join(', ')}${categories.length > 5 ? '…' : ''}`,
      `• **${wireCount} connections**, ${netCount} named nets`,
      `• Workspace: **${workspaceMode}**\n`,
      `You asked: _"${query}"_\n`,
      `Could you be more specific? I can help with circuit analysis, component recommendations, optimisation, maintenance predictions, compliance checks, or export guidance.`,
    ]
    return summary.join('\n')
  }
}

export const aiService = new AIService();