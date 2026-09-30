/**
 * src/types/domain.ts
 *
 * Re-exports every type needed by the domain layer (services, stores, AI) from
 * the canonical types/index.ts so every service can do a single import from
 * '../../types/domain' and get the correct, consistent definitions.
 */

export type {
  // Category helpers
  CategoryLike,
  // Core geometry
  Point,
  Size,
  Bounds,
  Viewport,
  Selection,
  Tool,
  ApplicationSettings,
  // Component model
  Pin,
  ComponentSymbol,
  ComponentProperties,
  Component,
  ComponentLibrary,
  PlacedComponent,
  // Domain-layer aliases (richer category type)
  DomainComponent,
  DomainWire,
  DomainNet,
  // Circuit graph
  Wire,
  Net,
  // Project hierarchy
  Schematic,
  Project,
  // Simulation
  Simulation,
  SimulationParameters,
  SimulationResult,
  SimulationNode,
  SimulationWaveform,
  SimulationModel,
  // Validation
  ValidationError,
  ValidationResult,
  ValidationRule,
  // AI
  AIMessage,
  CircuitAnalysis,
  ComponentSuggestion,
  // Collaboration
  User,
  UserPreferences,
  CollaborativeUser,
  CollaborationSession,
  Comment,
  // Export/Import
  ExportOptions,
  ImportResult,
  // Plugin
  Plugin,
  PluginAPI,
} from './index'

export { getCategoryName, getCategoryId } from './index'
