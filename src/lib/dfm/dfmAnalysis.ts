import { Component } from '../../types';

export interface DFMAnalysis {
  id: string;
  designId: string;
  manufacturingProcess: 'smt' | 'through_hole' | 'mixed' | 'chip_on_board';
  analysis: {
    assemblyTime: number; // minutes
    assemblyCost: number; // dollars
    componentCount: number;
    uniqueComponents: number;
    complexityScore: number; // 1-10 scale
    yield: number; // percentage
    testability: number; // percentage
  };
  recommendations: Array<{
    type: 'component' | 'layout' | 'process' | 'material';
    priority: 'low' | 'medium' | 'high';
    description: string;
    impact: number; // cost/time savings percentage
    implementation: string;
  }>;
  costBreakdown: {
    components: number;
    assembly: number;
    testing: number;
    overhead: number;
    total: number;
  };
  generated: Date;
}

export interface ComponentPlacement {
  componentId: string;
  x: number;
  y: number;
  rotation: number;
  side: 'top' | 'bottom';
  process: 'smt' | 'through_hole';
  difficulty: 'easy' | 'medium' | 'hard';
  accessibility: number; // 1-10 scale
}

export interface AssemblySequence {
  id: string;
  name: string;
  steps: Array<{
    step: number;
    action: string;
    components: string[];
    time: number; // seconds
    tools: string[];
    skill: 'low' | 'medium' | 'high';
  }>;
  totalTime: number;
  bottlenecks: string[];
}

export class DFMAnalyzer {
  private analyses: Map<string, DFMAnalysis> = new Map();

  analyzeDesign(components: Component[], placements: ComponentPlacement[], process: DFMAnalysis['manufacturingProcess']): DFMAnalysis {
    const componentCount = components.length;
    const uniqueComponents = new Set(components.map(c => c.name)).size;

    // Calculate assembly time
    const assemblyTime = this.calculateAssemblyTime(placements, process);

    // Calculate assembly cost
    const assemblyCost = this.calculateAssemblyCost(placements, process);

    // Calculate complexity score
    const complexityScore = this.calculateComplexityScore(components, placements);

    // Estimate yield
    const yieldEstimate = this.estimateYield(components, placements, process);

    // Calculate testability
    const testability = this.calculateTestability(components, placements);

    // Generate recommendations
    const recommendations = this.generateRecommendations(components, placements, process);

    // Cost breakdown
    const costBreakdown = this.calculateCostBreakdown(components, assemblyCost);

    const analysis: DFMAnalysis = {
      id: `dfm_${Date.now()}`,
      designId: 'design_1',
      manufacturingProcess: process,
      analysis: {
        assemblyTime,
        assemblyCost,
        componentCount,
        uniqueComponents,
        complexityScore,
        yield: yieldEstimate,
        testability
      },
      recommendations,
      costBreakdown,
      generated: new Date()
    };

    this.analyses.set(analysis.id, analysis);
    return analysis;
  }

  private calculateAssemblyTime(placements: ComponentPlacement[], process: string): number {
    let totalTime = 0;

    placements.forEach(placement => {
      let baseTime = 0;

      switch (placement.process) {
        case 'smt':
          baseTime = 5; // 5 seconds for SMT placement
          break;
        case 'through_hole':
          baseTime = 30; // 30 seconds for through-hole
          break;
      }

      // Adjust for difficulty
      switch (placement.difficulty) {
        case 'easy':
          baseTime *= 1.0;
          break;
        case 'medium':
          baseTime *= 1.5;
          break;
        case 'hard':
          baseTime *= 2.5;
          break;
      }

      // Adjust for accessibility
      baseTime *= (11 - placement.accessibility) / 5; // Worse accessibility = more time

      totalTime += baseTime;
    });

    // Add setup time (10% of total)
    totalTime *= 1.1;

    return totalTime / 60; // Convert to minutes
  }

  private calculateAssemblyCost(placements: ComponentPlacement[], process: string): number {
    let totalCost = 0;

    placements.forEach(placement => {
      switch (placement.process) {
        case 'smt':
          totalCost += 0.01; // $0.01 per SMT component
          break;
        case 'through_hole':
          totalCost += 0.05; // $0.05 per through-hole component
          break;
      }
    });

    // Add equipment depreciation and labor
    totalCost *= 2.0; // Double for overhead

    return totalCost;
  }

  private calculateComplexityScore(components: Component[], placements: ComponentPlacement[]): number {
    let score = 1;

    // Component count factor
    if (components.length > 100) score += 2;
    else if (components.length > 50) score += 1;

    // Unique components factor
    const uniqueCount = new Set(components.map(c => c.name)).size;
    if (uniqueCount > 20) score += 2;
    else if (uniqueCount > 10) score += 1;

    // Package type complexity
    const smtCount = placements.filter(p => p.process === 'smt').length;
    const smtRatio = smtCount / placements.length;
    if (smtRatio < 0.5) score += 1; // Mixed technology penalty

    // Fine pitch components
    const finePitchCount = placements.filter(p => p.difficulty === 'hard').length;
    if (finePitchCount > 10) score += 2;
    else if (finePitchCount > 5) score += 1;

    return Math.min(score, 10);
  }

  private estimateYield(components: Component[], placements: ComponentPlacement[], process: string): number {
    let baseYield = 0.98; // 98% base yield for SMT

    if (process === 'through_hole') {
      baseYield = 0.95; // 95% for through-hole
    } else if (process === 'mixed') {
      baseYield = 0.92; // 92% for mixed technology
    }

    // Component count penalty
    const componentPenalty = Math.max(0, (components.length - 50) * 0.001);
    baseYield -= componentPenalty;

    // Complexity penalty
    const complexityPenalty = this.calculateComplexityScore(components, placements) * 0.005;
    baseYield -= complexityPenalty;

    // Fine pitch penalty
    const finePitchCount = placements.filter(p => p.difficulty === 'hard').length;
    const finePitchPenalty = finePitchCount * 0.002;
    baseYield -= finePitchPenalty;

    return Math.max(baseYield * 100, 50); // Minimum 50%
  }

  private calculateTestability(components: Component[], placements: ComponentPlacement[]): number {
    let testability = 100;

    // BGA components reduce testability
    const bgaCount = components.filter(c => c.package?.includes('BGA')).length;
    testability -= bgaCount * 5;

    // Bottom-side components reduce testability
    const bottomSideCount = placements.filter(p => p.side === 'bottom').length;
    testability -= (bottomSideCount / placements.length) * 20;

    // Fine pitch components harder to test
    const finePitchCount = placements.filter(p => p.difficulty === 'hard').length;
    testability -= (finePitchCount / placements.length) * 15;

    return Math.max(testability, 0);
  }

  private generateRecommendations(components: Component[], placements: ComponentPlacement[], process: string): DFMAnalysis['recommendations'] {
    const recommendations = [];

    // Component consolidation
    const uniqueComponents = new Set(components.map(c => c.name)).size;
    if (uniqueComponents > 20) {
      recommendations.push({
        type: 'component',
        priority: 'high',
        description: `Consolidate ${uniqueComponents} unique components to reduce assembly complexity`,
        impact: 15,
        implementation: 'Standardize on fewer component variants and use parametric components'
      });
    }

    // SMT preference
    const smtCount = placements.filter(p => p.process === 'smt').length;
    const smtRatio = smtCount / placements.length;
    if (smtRatio < 0.8) {
      recommendations.push({
        type: 'process',
        priority: 'medium',
        description: 'Increase SMT component ratio to improve automation',
        impact: 25,
        implementation: 'Replace through-hole components with SMT equivalents where possible'
      });
    }

    // Component placement optimization
    const hardPlacements = placements.filter(p => p.difficulty === 'hard').length;
    if (hardPlacements > 5) {
      recommendations.push({
        type: 'layout',
        priority: 'medium',
        description: 'Optimize placement of difficult components',
        impact: 10,
        implementation: 'Group fine-pitch components and improve access for assembly'
      });
    }

    // Testability improvements
    const testability = this.calculateTestability(components, placements);
    if (testability < 80) {
      recommendations.push({
        type: 'layout',
        priority: 'high',
        description: 'Improve testability by reducing bottom-side components',
        impact: 20,
        implementation: 'Move test points to top side and add test pads for BGA components'
      });
    }

    // Material selection
    if (process === 'mixed') {
      recommendations.push({
        type: 'material',
        priority: 'low',
        description: 'Consider single technology to reduce process complexity',
        impact: 30,
        implementation: 'Use either pure SMT or through-hole technology'
      });
    }

    return recommendations;
  }

  private calculateCostBreakdown(components: Component[], assemblyCost: number): DFMAnalysis['costBreakdown'] {
    // Estimate component costs
    let componentCost = 0;
    components.forEach(component => {
      componentCost += component.cost || 0.1; // Default $0.10 per component
    });

    const testingCost = componentCost * 0.1; // 10% of component cost
    const overheadCost = (componentCost + assemblyCost + testingCost) * 0.2; // 20% overhead

    const total = componentCost + assemblyCost + testingCost + overheadCost;

    return {
      components: componentCost,
      assembly: assemblyCost,
      testing: testingCost,
      overhead: overheadCost,
      total
    };
  }

  generateAssemblySequence(placements: ComponentPlacement[]): AssemblySequence {
    // Sort placements by process, size, and accessibility
    const sortedPlacements = [...placements].sort((a, b) => {
      // SMT before through-hole
      if (a.process !== b.process) {
        return a.process === 'smt' ? -1 : 1;
      }
      // Larger components first
      // Easier placements first
      return b.accessibility - a.accessibility;
    });

    const steps = [];
    let currentStep = 1;
    let currentProcess = '';
    let stepComponents = [];

    sortedPlacements.forEach((placement, index) => {
      if (placement.process !== currentProcess && stepComponents.length > 0) {
        // Create step for previous process
        steps.push({
          step: currentStep++,
          action: `Place ${currentProcess.toUpperCase()} components`,
          components: stepComponents,
          time: stepComponents.length * 5, // 5 seconds per component
          tools: currentProcess === 'smt' ? ['pick-and-place'] : ['soldering iron'],
          skill: 'medium'
        });
        stepComponents = [];
      }

      currentProcess = placement.process;
      stepComponents.push(placement.componentId);

      // Create step every 10 components or at the end
      if (stepComponents.length >= 10 || index === sortedPlacements.length - 1) {
        steps.push({
          step: currentStep++,
          action: `Place ${currentProcess.toUpperCase()} components`,
          components: stepComponents,
          time: stepComponents.length * (currentProcess === 'smt' ? 5 : 30),
          tools: currentProcess === 'smt' ? ['pick-and-place'] : ['soldering iron', 'multimeter'],
          skill: currentProcess === 'smt' ? 'low' : 'high'
        });
        stepComponents = [];
      }
    });

    const totalTime = steps.reduce((sum, step) => sum + step.time, 0);
    const bottlenecks = this.identifyBottlenecks(steps);

    return {
      id: `assembly_${Date.now()}`,
      name: 'Optimized Assembly Sequence',
      steps,
      totalTime,
      bottlenecks
    };
  }

  private identifyBottlenecks(steps: AssemblySequence['steps']): string[] {
    const bottlenecks = [];

    steps.forEach(step => {
      if (step.skill === 'high') {
        bottlenecks.push(`Step ${step.step}: Requires high skill level`);
      }
      if (step.time > 300) { // More than 5 minutes
        bottlenecks.push(`Step ${step.step}: Long execution time (${step.time}s)`);
      }
      if (step.tools.length > 2) {
        bottlenecks.push(`Step ${step.step}: Requires multiple tools`);
      }
    });

    return bottlenecks;
  }

  optimizeForCost(analysis: DFMAnalysis): DFMAnalysis {
    const optimized = { ...analysis };

    // Find cost-saving recommendations
    const costRecommendations = analysis.recommendations.filter(r =>
      r.impact > 20 && (r.type === 'component' || r.type === 'process')
    );

    // Apply optimizations
    optimized.analysis.assemblyCost *= 0.8; // 20% cost reduction
    optimized.costBreakdown.total *= 0.85; // 15% total cost reduction

    return optimized;
  }

  optimizeForYield(analysis: DFMAnalysis): DFMAnalysis {
    const optimized = { ...analysis };

    // Focus on yield-improving recommendations
    optimized.analysis.yield += 5; // 5% yield improvement
    optimized.analysis.assemblyTime *= 0.9; // 10% time reduction from better yield

    return optimized;
  }

  getAnalysis(id: string): DFMAnalysis | undefined {
    return this.analyses.get(id);
  }

  getAllAnalyses(): DFMAnalysis[] {
    return Array.from(this.analyses.values());
  }
}

export const dfmAnalyzer = new DFMAnalyzer();