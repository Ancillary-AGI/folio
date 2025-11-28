/**
 * Main export file for all library services
 * Provides centralized access to all platform services
 */

// Hardware Interfaces
export * from './hardware/hardwareInterfaces';
export { hardwareInterfaceManager } from './hardware/hardwareInterfaces';

// Robotics Simulation
export * from './robotics/roboticsSimulation';
export { roboticsSimulationService } from './robotics/roboticsSimulation';

// Optimization
export * from './optimization/evolutionaryOptimization';
export { 
  evolutionaryOptimizer, 
  reinforcementLearningOptimizer 
} from './optimization/evolutionaryOptimization';

// PCB Analysis
export * from './pcb/thermalAnalysis';
export { thermalAnalysisEngine } from './pcb/thermalAnalysis';
export * from './pcb/signalIntegrity';
export { signalIntegrityAnalyzer } from './pcb/signalIntegrity';

// 3D Export
export * from './3d/gcodeExporter';
export { gcodeExporter } from './3d/gcodeExporter';

// Plugin System
export * from './plugins/pluginSystem';
export { pluginManager } from './plugins/pluginSystem';

// Existing services
export * from './ai/aiService';
export { aiService } from './ai/aiService';

export * from './collaboration/collaborationService';
export { collaborationService } from './collaboration/collaborationService';

export * from './digitalTwin/digitalTwinService';
export { digitalTwinService } from './digitalTwin/digitalTwinService';

export * from './siem/siemService';
export { siemService } from './siem/siemService';

export * from './nlp/nlpService';
export { nlpService } from './nlp/nlpService';

export * from './3d/threeManager';
export { threeManager } from './3d/threeManager';

export * from './programming/boardProgrammer';
export { boardProgrammer } from './programming/boardProgrammer';

export * from './schematicToPcb/schematicToPcbConverter';
export { schematicToPcbConverter } from './schematicToPcb/schematicToPcbConverter';

export * from './simulation/multiphysics';
export { multiphysicsEngine } from './simulation/multiphysics';

export * from './mechanical/mechanicalDesign';
export { mechanicalDesignEngine } from './mechanical/mechanicalDesign';

export * from './manufacturing/footprintLibrary';
export { footprintLibrary } from './manufacturing/footprintLibrary';

