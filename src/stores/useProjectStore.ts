import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { Component, Project, Schematic } from '../lib/supabase'

export interface CanvasComponent {
  id: string
  componentId: string
  component: Component
  x: number
  y: number
  rotation: number
  reference: string
  properties: Record<string, string | number | boolean>
  locked?: boolean
  visible?: boolean
}

export interface CanvasWire {
  id: string
  points: Array<{ x: number; y: number }>
  netName?: string
  connectedPins: Array<{ componentId: string; pinId: string }>
  style?: {
    color?: string
    width?: number
    dashArray?: number[]
  }
}

export interface SimulationResult {
  id: string
  type: 'dc' | 'ac' | 'transient' | 'noise'
  timestamp: number
  data: Record<string, unknown>
  waveforms?: Array<{
    name: string
    data: Array<{ x: number; y: number }>
    unit: string
    color: string
  }>
}

export interface ProjectState {
  // Current project
  currentProject: Project | null
  currentSchematic: Schematic | null
  
  // Canvas data
  components: CanvasComponent[]
  wires: CanvasWire[]
  
  // Component management
  addComponent: (component: CanvasComponent) => void
  updateComponent: (id: string, updates: Partial<CanvasComponent>) => void
  removeComponent: (id: string) => void
  duplicateComponent: (id: string) => void
  
  // Wire management
  addWire: (wire: CanvasWire) => void
  updateWire: (id: string, updates: Partial<CanvasWire>) => void
  removeWire: (id: string) => void
  
  // Project management
  setCurrentProject: (project: Project | null) => void
  setCurrentSchematic: (schematic: Schematic | null) => void
  
  // Simulation
  simulationResults: SimulationResult[]
  isSimulating: boolean
  addSimulationResult: (result: SimulationResult) => void
  clearSimulationResults: () => void
  setSimulating: (simulating: boolean) => void
  
  // Netlist generation
  generateNetlist: () => string
  
  // Component library
  componentLibrary: Component[]
  setComponentLibrary: (components: Component[]) => void
  
  // Auto-save
  isDirty: boolean
  lastSaved: number
  markDirty: () => void
  markClean: () => void
  
  // Statistics
  getComponentCount: () => number
  getWireCount: () => number
  getNetCount: () => number
  
  // Validation
  validateCircuit: () => Array<{ type: 'error' | 'warning'; message: string; componentId?: string }>
}

let componentCounter = 1

export const useProjectStore = create<ProjectState>()(
  devtools((set, get) => ({
    // Current project
    currentProject: null,
    currentSchematic: null,
    
    // Canvas data
    components: [],
    wires: [],
    
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
        
        const duplicate: CanvasComponent = {
          ...original,
          id: `comp-${Date.now()}-${Math.random()}`,
          x: original.x + 50,
          y: original.y + 50,
          reference: `${original.reference.replace(/\d+$/, '')}${componentCounter++}`
        }
        
        return {
          components: [...state.components, duplicate],
          isDirty: true
        }
      }),
    
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
    
    // Project management
    setCurrentProject: (project) => set({ currentProject: project }),
    setCurrentSchematic: (schematic) => set({ currentSchematic: schematic }),
    
    // Simulation
    simulationResults: [],
    isSimulating: false,
    addSimulationResult: (result) =>
      set((state) => ({
        simulationResults: [...state.simulationResults, result]
      })),
    clearSimulationResults: () => set({ simulationResults: [] }),
    setSimulating: (simulating) => set({ isSimulating: simulating }),
    
    // Netlist generation
    generateNetlist: () => {
      const { components, wires } = get()
      
      let netlist = '* Circuit Netlist\n'
      netlist += `* Generated on ${new Date().toISOString()}\n\n`
      
      // Add components
      components.forEach((comp) => {
        const pins = comp.component.pins.map((pin) => {
          const connectedWire = wires.find((wire) =>
            wire.connectedPins.some((p) => p.componentId === comp.id && p.pinId === pin.id)
          )
          return connectedWire?.netName || `net_${comp.id}_${pin.id}`
        })
        
        netlist += `${comp.reference} ${pins.join(' ')} ${comp.component.name}\n`
        
        // Add component parameters
        Object.entries(comp.properties).forEach(([key, value]) => {
          if (key === 'value' && value) {
            netlist += `+ ${key}=${value}\n`
          }
        })
      })
      
      netlist += '\n.end\n'
      return netlist
    },
    
    // Component library
    componentLibrary: [],
    setComponentLibrary: (components) => set({ componentLibrary: components }),
    
    // Auto-save
    isDirty: false,
    lastSaved: Date.now(),
    markDirty: () => set({ isDirty: true }),
    markClean: () => set({ isDirty: false, lastSaved: Date.now() }),
    
    // Statistics
    getComponentCount: () => get().components.length,
    getWireCount: () => get().wires.length,
    getNetCount: () => {
      const nets = new Set<string>()
      get().wires.forEach((wire) => {
        if (wire.netName) nets.add(wire.netName)
      })
      return nets.size
    },
    
    // Validation
    validateCircuit: () => {
      const { components, wires } = get()
      const issues: Array<{ type: 'error' | 'warning'; message: string; componentId?: string }> = []
      
      // Check for unconnected pins
      components.forEach((comp) => {
        comp.component.pins.forEach((pin) => {
          const isConnected = wires.some((wire) =>
            wire.connectedPins.some((p) => p.componentId === comp.id && p.pinId === pin.id)
          )
          
          if (!isConnected && pin.type !== 'nc') {
            issues.push({
              type: 'warning',
              message: `Pin ${pin.name} of ${comp.reference} is not connected`,
              componentId: comp.id
            })
          }
        })
      })
      
      // Check for floating nets
      wires.forEach((wire) => {
        if (wire.connectedPins.length < 2) {
          issues.push({
            type: 'warning',
            message: `Wire ${wire.id} has less than 2 connections`
          })
        }
      })
      
      // Check for missing ground connections
      const hasGround = components.some((comp) =>
        comp.component.name.toLowerCase().includes('ground')
      )
      
      if (!hasGround && components.length > 0) {
        issues.push({
          type: 'error',
          message: 'Circuit has no ground reference'
        })
      }
      
      return issues
    }
  }))
)