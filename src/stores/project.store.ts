import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  Project,
  Schematic,
  PlacedComponent,
  Wire,
  Net,
  Simulation,
  Component,
  ComponentLibrary,
  ValidationError
} from '../types/domain'

interface ProjectState {
  // Current project and schematic
  currentProject: Project | null
  currentSchematic: Schematic | null

  // Canvas data
  components: PlacedComponent[]
  wires: Wire[]
  nets: Net[]

  // Component libraries
  componentLibraries: ComponentLibrary[]
  availableComponents: Component[]

  // Simulations
  simulations: Simulation[]
  currentSimulation: Simulation | null

  // UI state
  isDirty: boolean
  isLoading: boolean
  lastSaved: Date | null

  // Actions
  setCurrentProject: (project: Project | null) => void
  setCurrentSchematic: (schematic: Schematic | null) => void

  // Component management
  addComponent: (component: PlacedComponent) => void
  updateComponent: (id: string, updates: Partial<PlacedComponent>) => void
  removeComponent: (id: string) => void
  duplicateComponent: (id: string) => void
  moveComponent: (id: string, position: { x: number; y: number }) => void
  rotateComponent: (id: string, rotation: number) => void

  // Wire management
  addWire: (wire: Wire) => void
  updateWire: (id: string, updates: Partial<Wire>) => void
  removeWire: (id: string) => void
  connectWire: (wireId: string, componentId: string, pinId: string) => void
  disconnectWire: (wireId: string, componentId: string, pinId: string) => void

  // Net management
  addNet: (net: Net) => void
  updateNet: (id: string, updates: Partial<Net>) => void
  removeNet: (id: string) => void

  // Library management
  addComponentLibrary: (library: ComponentLibrary) => void
  removeComponentLibrary: (id: string) => void
  searchComponents: (query: string) => Component[]

  // Simulation management
  addSimulation: (simulation: Simulation) => void
  updateSimulation: (id: string, updates: Partial<Simulation>) => void
  removeSimulation: (id: string) => void
  setCurrentSimulation: (simulation: Simulation | null) => void

  // Project operations
  saveProject: () => Promise<void>
  loadProject: (projectId: string) => Promise<void>
  exportProject: (format: string) => Promise<Blob>
  validateProject: () => ValidationError[]

  // Utility functions
  getComponentById: (id: string) => PlacedComponent | undefined
  getWireById: (id: string) => Wire | undefined
  getNetById: (id: string) => Net | undefined
  getConnectedComponents: (wireId: string) => PlacedComponent[]
  getComponentConnections: (componentId: string) => Wire[]

  // Statistics
  getStats: () => {
    componentCount: number
    wireCount: number
    netCount: number
    simulationCount: number
    totalCost: number
  }

  // State management
  markDirty: () => void
  markClean: () => void
  reset: () => void
}

export const useProjectStore = create<ProjectState>()(
  devtools(
    (set, get) => ({
      // Initial state
      currentProject: null,
      currentSchematic: null,
      components: [],
      wires: [],
      nets: [],
      componentLibraries: [],
      availableComponents: [],
      simulations: [],
      currentSimulation: null,
      isDirty: false,
      isLoading: false,
      lastSaved: null,

      // Project management
      setCurrentProject: (project) => set({ currentProject: project }),

      setCurrentSchematic: (schematic) => set({ currentSchematic: schematic }),

      // Component management
      addComponent: (component) =>
        set((state) => ({
          components: [...state.components, component],
          isDirty: true
        })),

      updateComponent: (id, updates) =>
        set((state) => ({
          components: state.components.map((comp) =>
            comp.id === id ? { ...comp, ...updates } : comp
          ),
          isDirty: true
        })),

      removeComponent: (id) =>
        set((state) => ({
          components: state.components.filter((comp) => comp.id !== id),
          wires: state.wires.filter((wire) =>
            !wire.connectedPins.some((pin) => pin.componentId === id)
          ),
          isDirty: true
        })),

      duplicateComponent: (id) =>
        set((state) => {
          const original = state.components.find((comp) => comp.id === id)
          if (!original) return state

          const duplicate: PlacedComponent = {
            ...original,
            id: `comp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            position: {
              x: original.position.x + 50,
              y: original.position.y + 50
            },
            reference: `${original.reference}_copy`,
            selected: false
          }

          return {
            components: [...state.components, duplicate],
            isDirty: true
          }
        }),

      moveComponent: (id, position) =>
        set((state) => ({
          components: state.components.map((comp) =>
            comp.id === id ? { ...comp, position } : comp
          ),
          isDirty: true
        })),

      rotateComponent: (id, rotation) =>
        set((state) => ({
          components: state.components.map((comp) =>
            comp.id === id ? { ...comp, rotation } : comp
          ),
          isDirty: true
        })),

      // Wire management
      addWire: (wire) =>
        set((state) => ({
          wires: [...state.wires, wire],
          isDirty: true
        })),

      updateWire: (id, updates) =>
        set((state) => ({
          wires: state.wires.map((wire) =>
            wire.id === id ? { ...wire, ...updates } : wire
          ),
          isDirty: true
        })),

      removeWire: (id) =>
        set((state) => ({
          wires: state.wires.filter((wire) => wire.id !== id),
          isDirty: true
        })),

      connectWire: (wireId, componentId, pinId) =>
        set((state) => ({
          wires: state.wires.map((wire) =>
            wire.id === wireId ? {
              ...wire,
              connectedPins: [
                ...wire.connectedPins,
                { componentId, pinId, position: { x: 0, y: 0 } } // Position will be calculated
              ]
            } : wire
          ),
          isDirty: true
        })),

      disconnectWire: (wireId, componentId, pinId) =>
        set((state) => ({
          wires: state.wires.map((wire) =>
            wire.id === wireId ? {
              ...wire,
              connectedPins: wire.connectedPins.filter(
                (pin) => !(pin.componentId === componentId && pin.pinId === pinId)
              )
            } : wire
          ),
          isDirty: true
        })),

      // Net management
      addNet: (net) =>
        set((state) => ({
          nets: [...state.nets, net],
          isDirty: true
        })),

      updateNet: (id, updates) =>
        set((state) => ({
          nets: state.nets.map((net) =>
            net.id === id ? { ...net, ...updates } : net
          ),
          isDirty: true
        })),

      removeNet: (id) =>
        set((state) => ({
          nets: state.nets.filter((net) => net.id !== id),
          isDirty: true
        })),

      // Library management
      addComponentLibrary: (library) =>
        set((state) => ({
          componentLibraries: [...state.componentLibraries, library],
          availableComponents: [...state.availableComponents, ...library.components]
        })),

      removeComponentLibrary: (id) =>
        set((state) => ({
          componentLibraries: state.componentLibraries.filter((lib) => lib.id !== id),
          availableComponents: state.availableComponents.filter(
            (comp) => !state.componentLibraries
              .find((lib) => lib.id === id)?.components
              .some((libComp) => libComp.id === comp.id)
          )
        })),

      searchComponents: (query) => {
        const { availableComponents } = get()
        const lowercaseQuery = query.toLowerCase()
        return availableComponents.filter((comp) =>
          comp.name.toLowerCase().includes(lowercaseQuery) ||
          comp.description?.toLowerCase().includes(lowercaseQuery) ||
          comp.tags.some((tag) => tag.toLowerCase().includes(lowercaseQuery))
        )
      },

      // Simulation management
      addSimulation: (simulation) =>
        set((state) => ({
          simulations: [...state.simulations, simulation]
        })),

      updateSimulation: (id, updates) =>
        set((state) => ({
          simulations: state.simulations.map((sim) =>
            sim.id === id ? { ...sim, ...updates } : sim
          )
        })),

      removeSimulation: (id) =>
        set((state) => ({
          simulations: state.simulations.filter((sim) => sim.id !== id),
          currentSimulation: state.currentSimulation?.id === id ? null : state.currentSimulation
        })),

      setCurrentSimulation: (simulation) => set({ currentSimulation: simulation }),

      // Project operations
      saveProject: async () => {
        const { currentProject, components, wires, nets } = get()
        if (!currentProject) throw new Error('No current project')

        // Implementation would save to backend
        console.log('Saving project:', currentProject.name)
        set({ lastSaved: new Date(), isDirty: false })
      },

      loadProject: async (projectId) => {
        // Implementation would load from backend
        console.log('Loading project:', projectId)
        set({ isLoading: true })

        // Mock loading
        setTimeout(() => {
          set({ isLoading: false })
        }, 1000)
      },

      exportProject: async (format) => {
        const { currentProject, components, wires, nets } = get()
        if (!currentProject) throw new Error('No current project')
        if (!format) throw new Error('Export format required')

        // Implementation would generate export file based on format
        const data = JSON.stringify({
          project: currentProject,
          components,
          wires,
          nets,
          format,
          exportedAt: new Date().toISOString()
        })

        return new Blob([data], { type: 'application/json' })
      },

      validateProject: () => {
        const { components, wires, nets } = get()
        const errors: ValidationError[] = []

        // Basic validation rules
        components.forEach((comp) => {
          if (!comp.reference) {
            errors.push({
              id: `comp_${comp.id}_ref`,
              type: 'schematic',
              severity: 'error',
              message: `Component ${comp.component.name} is missing a reference designator`,
              location: { componentId: comp.id }
            })
          }
        })

        wires.forEach((wire) => {
          if (wire.connectedPins.length < 2) {
            errors.push({
              id: `wire_${wire.id}_conn`,
              type: 'schematic',
              severity: 'warning',
              message: 'Wire has less than 2 connections',
              location: { elementId: wire.id }
            })
          }
        })

        // Check for nets without connections
        nets.forEach((net) => {
          if (net.connectedPins.length === 0) {
            errors.push({
              id: `net_${net.id}_empty`,
              type: 'schematic',
              severity: 'warning',
              message: `Net "${net.name}" has no connections`,
              location: { elementId: net.id }
            })
          }
        })

        return errors
      },

      // Utility functions
      getComponentById: (id) => get().components.find((comp) => comp.id === id),

      getWireById: (id) => get().wires.find((wire) => wire.id === id),

      getNetById: (id) => get().nets.find((net) => net.id === id),

      getConnectedComponents: (wireId) => {
        const wire = get().getWireById(wireId)
        if (!wire) return []

        return wire.connectedPins
          .map((pin) => get().getComponentById(pin.componentId))
          .filter((comp): comp is PlacedComponent => comp !== undefined)
      },

      getComponentConnections: (componentId) => {
        return get().wires.filter((wire) =>
          wire.connectedPins.some((pin) => pin.componentId === componentId)
        )
      },

      // Statistics
      getStats: () => {
        const { components, wires, nets, simulations } = get()

        return {
          componentCount: components.length,
          wireCount: wires.length,
          netCount: nets.length,
          simulationCount: simulations.length,
          totalCost: components.reduce((sum, comp) => sum + (comp.component.cost?.amount || 0), 0)
        }
      },

      // State management
      markDirty: () => set({ isDirty: true }),

      markClean: () => set({ isDirty: false, lastSaved: new Date() }),

      reset: () => set({
        currentProject: null,
        currentSchematic: null,
        components: [],
        wires: [],
        nets: [],
        simulations: [],
        currentSimulation: null,
        isDirty: false,
        isLoading: false,
        lastSaved: null
      })
    }),
    {
      name: 'circuit-cad-project'
    }
  )
)