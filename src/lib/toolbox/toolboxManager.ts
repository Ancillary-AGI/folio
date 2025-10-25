import { Toolbox, ToolboxComponent, ToolboxTool, ToolboxSimulation, RoboticComponent, CodeBlock, BoardType, MechanicalComponent, MultiPhysicsSimulation, ComponentPort } from '../../types/toolbox'

export class ToolboxManager {
  private toolboxes: Map<string, Toolbox> = new Map()
  private activeToolboxes: Set<string> = new Set()

  constructor() {
    this.initializeDefaultToolboxes()
  }

  private initializeDefaultToolboxes(): void {
    // Electronics Toolbox
    this.registerToolbox({
      id: 'electronics',
      name: 'Electronics Design',
      description: 'Circuit design and simulation tools',
      icon: 'circuit',
      category: 'electronics',
      version: '1.0.0',
      enabled: true,
      components: [],
      tools: [],
      simulations: []
    })

    // Robotics Toolbox
    this.registerToolbox({
      id: 'robotics',
      name: 'Robotics & Automation',
      description: 'Robotic system design and simulation',
      icon: 'robot',
      category: 'robotics',
      version: '1.0.0',
      enabled: true,
      components: [],
      tools: [],
      simulations: []
    })

    // Programming Toolbox
    this.registerToolbox({
      id: 'programming',
      name: 'Visual Programming',
      description: 'Drag-and-drop programming interface',
      icon: 'code',
      category: 'programming',
      version: '1.0.0',
      enabled: true,
      components: [],
      tools: [],
      simulations: []
    })

    // Mechanics Toolbox
    this.registerToolbox({
      id: 'mechanics',
      name: 'Mechanical Design',
      description: '3D mechanical design and analysis',
      icon: 'cog',
      category: 'mechanics',
      version: '1.0.0',
      enabled: true,
      components: [],
      tools: [],
      simulations: []
    })

    // Multi-Physics Toolbox
    this.registerToolbox({
      id: 'multiphysics',
      name: 'Multi-Physics Simulation',
      description: 'Coupled physics simulation engine',
      icon: 'atom',
      category: 'simulation',
      version: '1.0.0',
      enabled: true,
      components: [],
      tools: [],
      simulations: []
    })
  }

  registerToolbox(toolbox: Toolbox): void {
    this.toolboxes.set(toolbox.id, toolbox)
    if (toolbox.enabled) {
      this.activeToolboxes.add(toolbox.id)
    }
  }

  unregisterToolbox(toolboxId: string): void {
    this.toolboxes.delete(toolboxId)
    this.activeToolboxes.delete(toolboxId)
  }

  enableToolbox(toolboxId: string): void {
    const toolbox = this.toolboxes.get(toolboxId)
    if (toolbox) {
      toolbox.enabled = true
      this.activeToolboxes.add(toolboxId)
    }
  }

  disableToolbox(toolboxId: string): void {
    const toolbox = this.toolboxes.get(toolboxId)
    if (toolbox) {
      toolbox.enabled = false
      this.activeToolboxes.delete(toolboxId)
    }
  }

  getToolbox(toolboxId: string): Toolbox | undefined {
    return this.toolboxes.get(toolboxId)
  }

  getAllToolboxes(): Toolbox[] {
    return Array.from(this.toolboxes.values())
  }

  getActiveToolboxes(): Toolbox[] {
    return Array.from(this.activeToolboxes)
      .map(id => this.toolboxes.get(id))
      .filter(Boolean) as Toolbox[]
  }

  getToolboxComponents(toolboxId: string): ToolboxComponent[] {
    const toolbox = this.toolboxes.get(toolboxId)
    return toolbox?.components || []
  }

  getToolboxTools(toolboxId: string): ToolboxTool[] {
    const toolbox = this.toolboxes.get(toolboxId)
    return toolbox?.tools || []
  }

  getToolboxSimulations(toolboxId: string): ToolboxSimulation[] {
    const toolbox = this.toolboxes.get(toolboxId)
    return toolbox?.simulations || []
  }

  // Robotics-specific methods
  addRoboticComponent(toolboxId: string, component: RoboticComponent): void {
    const toolbox = this.toolboxes.get(toolboxId)
    if (toolbox) {
      toolbox.components.push({
        id: component.id,
        name: component.model,
        type: 'robotic',
        category: component.type,
        properties: component.specifications,
        ports: [] // Will be populated based on component type
      })
    }
  }

  getRoboticComponents(toolboxId: string): RoboticComponent[] {
    return this.getToolboxComponents(toolboxId)
      .filter(comp => comp.type === 'robotic')
      .map(comp => ({
        id: comp.id,
        type: comp.category as RoboticComponent['type'],
        model: comp.name,
        specifications: comp.properties as RoboticComponent['specifications']
      }))
  }

  // Programming-specific methods
  addCodeBlock(toolboxId: string, codeBlock: CodeBlock): void {
    const toolbox = this.toolboxes.get(toolboxId)
    if (toolbox) {
      toolbox.components.push({
        id: codeBlock.id,
        name: codeBlock.name,
        type: 'software',
        category: codeBlock.category,
        properties: {
          inputs: codeBlock.inputs,
          outputs: codeBlock.outputs,
          parameters: codeBlock.parameters,
          code: codeBlock.code
        },
        ports: [
          ...codeBlock.inputs.map(input => ({
            id: input.id,
            name: input.name,
            type: input.type as ComponentPort['type'],
            direction: 'input' as const,
            position: input.position
          })),
          ...codeBlock.outputs.map(output => ({
            id: output.id,
            name: output.name,
            type: output.type as ComponentPort['type'],
            direction: 'output' as const,
            position: output.position
          }))
        ]
      })
    }
  }

  // Board programming methods
  addBoardType(toolboxId: string, board: BoardType): void {
    const toolbox = this.toolboxes.get(toolboxId)
    if (toolbox) {
      toolbox.components.push({
        id: board.id,
        name: board.name,
        type: 'robotic', // Boards are considered robotic controllers
        category: 'controller',
        properties: {
          manufacturer: board.manufacturer,
          architecture: board.architecture,
          specifications: board.specifications,
          supportedLanguages: board.supportedLanguages
        },
        ports: board.pins.map(pin => ({
          id: `pin_${pin.number}`,
          name: pin.name,
          type: pin.type as ComponentPort['type'],
          direction: 'bidirectional' as const,
          position: pin.position
        }))
      })
    }
  }

  // Mechanical design methods
  addMechanicalComponent(toolboxId: string, component: MechanicalComponent): void {
    const toolbox = this.toolboxes.get(toolboxId)
    if (toolbox) {
      toolbox.components.push({
        id: component.id,
        name: component.name,
        type: 'mechanical',
        category: component.type,
        model3d: component.geometry?.mesh,
        properties: {
          ...component.properties,
          material: component.material,
          constraints: component.constraints
        },
        ports: [] // Mechanical connections will be handled differently
      })
    }
  }

  // Multi-physics simulation methods
  addMultiPhysicsSimulation(toolboxId: string, simulation: MultiPhysicsSimulation): void {
    const toolbox = this.toolboxes.get(toolboxId)
    if (toolbox) {
      toolbox.simulations.push({
        id: simulation.id,
        name: simulation.name,
        type: 'multiphysics',
        engine: 'custom',
        parameters: {},
        results: simulation.results || []
      })
    }
  }

  // Utility methods
  searchComponents(query: string, toolboxIds?: string[]): ToolboxComponent[] {
    const toolboxes = toolboxIds
      ? toolboxIds.map(id => this.toolboxes.get(id)).filter(Boolean) as Toolbox[]
      : this.getActiveToolboxes()

    const allComponents = toolboxes.flatMap(tb => tb.components)
    const lowerQuery = query.toLowerCase()

    return allComponents.filter(comp =>
      comp.name.toLowerCase().includes(lowerQuery) ||
      comp.category.toLowerCase().includes(lowerQuery) ||
      comp.type.toLowerCase().includes(lowerQuery)
    )
  }

  getComponentsByCategory(category: string, toolboxIds?: string[]): ToolboxComponent[] {
    const toolboxes = toolboxIds
      ? toolboxIds.map(id => this.toolboxes.get(id)).filter(Boolean) as Toolbox[]
      : this.getActiveToolboxes()

    return toolboxes.flatMap(tb => tb.components.filter(comp => comp.category === category))
  }

  getComponentsByType(type: ToolboxComponent['type'], toolboxIds?: string[]): ToolboxComponent[] {
    const toolboxes = toolboxIds
      ? toolboxIds.map(id => this.toolboxes.get(id)).filter(Boolean) as Toolbox[]
      : this.getActiveToolboxes()

    return toolboxes.flatMap(tb => tb.components.filter(comp => comp.type === type))
  }
}

export const toolboxManager = new ToolboxManager()