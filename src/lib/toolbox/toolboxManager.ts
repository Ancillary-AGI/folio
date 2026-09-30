/**
 * Toolbox Manager - Manages different toolboxes for various engineering domains
 */

export interface ToolboxItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  /**
   * Optional host hook. `ToolboxPanel` never calls this directly — it forwards
   * `tool.id` through `onToolSelect` so the mounted workspace decides what a tool
   * means. Kept optional so default toolboxes don't ship dead `console.log`
   * pseudo-actions.
   */
  action?: () => void;
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
          icon: 'SCH',
          category: 'electronics',

        },
        {
          id: 'pcb',
          name: 'PCB Layout',
          description: 'Design PCB layouts',
          icon: 'PCB',
          category: 'electronics',

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
          icon: 'CAD',
          category: 'mechanics',

        },
        {
          id: 'fea',
          name: 'FEA Analysis',
          description: 'Finite element analysis',
          icon: 'FEA',
          category: 'mechanics',

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
          icon: 'ROBOT',
          category: 'robotics',

        },
        {
          id: 'kinematics',
          name: 'Kinematics',
          description: 'Forward/inverse kinematics',
          icon: 'KIN',
          category: 'robotics',

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
          icon: 'MCU',
          category: 'programming',

        },
        {
          id: 'visual-prog',
          name: 'Visual Programming',
          description: 'Block-based programming',
          icon: 'BLOCK',
          category: 'programming',

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
          icon: 'SPICE',
          category: 'simulation',

        },
        {
          id: 'thermal',
          name: 'Thermal Analysis',
          description: 'Thermal simulation',
          icon: 'TEMP',
          category: 'simulation',

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
          icon: 'TEAM',
          category: 'collaboration',

        },
        {
          id: 'version-control',
          name: 'Version Control',
          description: 'Git-like versioning',
          icon: 'VCS',
          category: 'collaboration',

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
