/**
 * Toolbox Manager - Manages different toolboxes for various engineering domains
 */

export interface ToolboxItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  action: () => void;
}

export interface Toolbox {
  id: string;
  name: string;
  category: 'electronics' | 'mechanics' | 'robotics' | 'programming' | 'simulation' | 'collaboration';
  description: string;
  tools: ToolboxItem[];
  components: unknown[];
}

class ToolboxManager {
  private toolboxes: Map<string, Toolbox> = new Map();

  constructor() {
    this.initializeDefaultToolboxes();
  }

  private initializeDefaultToolboxes(): void {
    // Electronics Toolbox
    this.registerToolbox({
      id: 'electronics',
      name: 'Electronics',
      category: 'electronics',
      description: 'Circuit design and PCB layout tools',
      tools: [
        {
          id: 'schematic',
          name: 'Schematic Editor',
          description: 'Design circuit schematics',
          icon: '⚡',
          category: 'electronics',
          action: () => console.log('Open schematic editor')
        },
        {
          id: 'pcb',
          name: 'PCB Layout',
          description: 'Design PCB layouts',
          icon: '🔧',
          category: 'electronics',
          action: () => console.log('Open PCB layout')
        }
      ],
      components: []
    });

    // Mechanics Toolbox
    this.registerToolbox({
      id: 'mechanics',
      name: 'Mechanics',
      category: 'mechanics',
      description: 'Mechanical design and simulation tools',
      tools: [
        {
          id: 'cad',
          name: '3D CAD',
          description: '3D mechanical design',
          icon: '🎨',
          category: 'mechanics',
          action: () => console.log('Open 3D CAD')
        },
        {
          id: 'fea',
          name: 'FEA Analysis',
          description: 'Finite element analysis',
          icon: '📊',
          category: 'mechanics',
          action: () => console.log('Open FEA')
        }
      ],
      components: []
    });

    // Robotics Toolbox
    this.registerToolbox({
      id: 'robotics',
      name: 'Robotics',
      category: 'robotics',
      description: 'Robot simulation and control',
      tools: [
        {
          id: 'robot-sim',
          name: 'Robot Simulator',
          description: '6-DOF robot simulation',
          icon: '🤖',
          category: 'robotics',
          action: () => console.log('Open robot simulator')
        },
        {
          id: 'kinematics',
          name: 'Kinematics',
          description: 'Forward/inverse kinematics',
          icon: '🔄',
          category: 'robotics',
          action: () => console.log('Open kinematics')
        }
      ],
      components: []
    });

    // Programming Toolbox
    this.registerToolbox({
      id: 'programming',
      name: 'Programming',
      category: 'programming',
      description: 'Embedded programming tools',
      tools: [
        {
          id: 'arduino',
          name: 'Arduino IDE',
          description: 'Program Arduino boards',
          icon: '💻',
          category: 'programming',
          action: () => console.log('Open Arduino IDE')
        },
        {
          id: 'visual-prog',
          name: 'Visual Programming',
          description: 'Block-based programming',
          icon: '🧩',
          category: 'programming',
          action: () => console.log('Open visual programming')
        }
      ],
      components: []
    });

    // Simulation Toolbox
    this.registerToolbox({
      id: 'simulation',
      name: 'Simulation',
      category: 'simulation',
      description: 'Multi-physics simulation tools',
      tools: [
        {
          id: 'spice',
          name: 'SPICE Simulator',
          description: 'Circuit simulation',
          icon: '📈',
          category: 'simulation',
          action: () => console.log('Open SPICE')
        },
        {
          id: 'thermal',
          name: 'Thermal Analysis',
          description: 'Thermal simulation',
          icon: '🌡️',
          category: 'simulation',
          action: () => console.log('Open thermal analysis')
        }
      ],
      components: []
    });

    // Collaboration Toolbox
    this.registerToolbox({
      id: 'collaboration',
      name: 'Collaboration',
      category: 'collaboration',
      description: 'Team collaboration tools',
      tools: [
        {
          id: 'realtime',
          name: 'Real-time Editing',
          description: 'Multi-user collaboration',
          icon: '👥',
          category: 'collaboration',
          action: () => console.log('Open collaboration')
        },
        {
          id: 'version-control',
          name: 'Version Control',
          description: 'Git-like versioning',
          icon: '📝',
          category: 'collaboration',
          action: () => console.log('Open version control')
        }
      ],
      components: []
    });
  }

  registerToolbox(toolbox: Toolbox): void {
    this.toolboxes.set(toolbox.id, toolbox);
  }

  getToolbox(id: string): Toolbox | undefined {
    return this.toolboxes.get(id);
  }

  getAllToolboxes(): Toolbox[] {
    return Array.from(this.toolboxes.values());
  }

  getToolboxesByCategory(category: string): Toolbox[] {
    return Array.from(this.toolboxes.values()).filter(
      toolbox => toolbox.category === category
    );
  }

  addToolToToolbox(toolboxId: string, tool: ToolboxItem): void {
    const toolbox = this.toolboxes.get(toolboxId);
    if (toolbox) {
      toolbox.tools.push(tool);
    }
  }

  removeToolFromToolbox(toolboxId: string, toolId: string): void {
    const toolbox = this.toolboxes.get(toolboxId);
    if (toolbox) {
      toolbox.tools = toolbox.tools.filter(tool => tool.id !== toolId);
    }
  }

  getToolboxComponents(toolboxId: string): unknown[] {
    const toolbox = this.toolboxes.get(toolboxId);
    return toolbox?.components || [];
  }

  addComponentToToolbox(toolboxId: string, component: unknown): void {
    const toolbox = this.toolboxes.get(toolboxId);
    if (toolbox) {
      toolbox.components.push(component);
    }
  }
}

export const toolboxManager = new ToolboxManager();
