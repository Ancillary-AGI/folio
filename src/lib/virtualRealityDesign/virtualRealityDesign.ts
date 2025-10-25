import { Component } from '../../types';

export interface VRDevice {
  id: string;
  type: 'hmd' | 'controller' | 'tracker' | 'hand_tracking';
  name: string;
  capabilities: Array<{
    type: 'position_tracking' | 'rotation_tracking' | 'button_input' | 'gesture_recognition' | 'haptic_feedback' | 'eye_tracking';
    supported: boolean;
    accuracy?: number;
  }>;
  calibration: {
    completed: boolean;
    quality: number;
    lastCalibrated: Date;
  };
  battery?: {
    level: number;
    isCharging: boolean;
  };
  connection: {
    status: 'connected' | 'disconnected' | 'connecting';
    signalStrength?: number;
    latency: number;
  };
  metadata: {
    manufacturer: string;
    model: string;
    firmware: string;
    serialNumber: string;
  };
}

export interface VRScene {
  id: string;
  name: string;
  description: string;
  type: 'circuit_design' | 'simulation' | 'assembly' | 'testing' | 'training';
  environment: {
    lighting: 'natural' | 'studio' | 'workshop' | 'custom';
    scale: number;
    gravity: boolean;
    physics: boolean;
  };
  objects: VRObject[];
  interactions: VRInteraction[];
  waypoints: Array<{
    id: string;
    name: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    description: string;
  }>;
  metadata: {
    created: Date;
    updated: Date;
    createdBy: string;
    duration: number; // estimated viewing time
    difficulty: 'beginner' | 'intermediate' | 'expert';
  };
}

export interface VRObject {
  id: string;
  name: string;
  type: 'component' | 'wire' | 'board' | 'tool' | 'measurement' | 'annotation' | 'effect';
  sourceId?: string; // ID from the main application
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
  material: {
    color: string;
    texture?: string;
    metallic: number;
    roughness: number;
    transparency: number;
  };
  physics: {
    enabled: boolean;
    mass: number;
    friction: number;
    restitution: number;
    kinematic: boolean;
  };
  interactions: Array<{
    type: 'grab' | 'touch' | 'look' | 'proximity';
    enabled: boolean;
    callback?: string;
  }>;
  animations?: Array<{
    name: string;
    type: 'rotation' | 'translation' | 'scale' | 'color';
    duration: number;
    loop: boolean;
    easing: string;
  }>;
  metadata: {
    layer: string;
    visible: boolean;
    selectable: boolean;
    collidable: boolean;
  };
}

export interface VRInteraction {
  id: string;
  type: 'grab' | 'place' | 'connect' | 'measure' | 'annotate' | 'simulate' | 'teleport';
  trigger: {
    type: 'gesture' | 'voice' | 'button' | 'proximity' | 'timer';
    condition: string;
    parameters: Record<string, unknown>;
  };
  action: {
    type: 'transform_object' | 'create_object' | 'delete_object' | 'change_scene' | 'play_animation' | 'run_simulation';
    target: string;
    parameters: Record<string, unknown>;
  };
  feedback: {
    visual: boolean;
    audio: boolean;
    haptic: boolean;
    duration: number;
  };
  conditions: Array<{
    type: 'user_role' | 'scene_state' | 'object_state' | 'time_limit';
    condition: string;
    value: unknown;
  }>;
  metadata: {
    enabled: boolean;
    priority: number;
    cooldown: number;
    usage: number;
  };
}

export interface VRSession {
  id: string;
  userId: string;
  sceneId: string;
  deviceId: string;
  startTime: Date;
  endTime?: Date;
  duration: number;
  userPosition: Array<{
    timestamp: Date;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
  }>;
  interactions: Array<{
    timestamp: Date;
    type: string;
    objectId?: string;
    position?: { x: number; y: number; z: number };
    data: Record<string, unknown>;
  }>;
  performance: {
    fps: number[];
    latency: number[];
    comfort: number; // 0-1, user comfort rating
    completion: number; // 0-1, task completion rate
  };
  feedback: {
    usability: number; // 1-5
    immersion: number; // 1-5
    effectiveness: number; // 1-5
    comments: string;
  };
  metadata: {
    headset: string;
    controllers: string[];
    trackingQuality: number;
    environment: string;
  };
}

export class VirtualRealityDesignManager {
  private devices: Map<string, VRDevice> = new Map();
  private scenes: Map<string, VRScene> = new Map();
  private sessions: Map<string, VRSession> = new Map();
  private objects: Map<string, VRObject> = new Map();

  registerVRDevice(device: Omit<VRDevice, 'id'>): VRDevice {
    const newDevice: VRDevice = {
      ...device,
      id: `vr_device_${Date.now()}`
    };

    this.devices.set(newDevice.id, newDevice);
    return newDevice;
  }

  createVRScene(scene: Omit<VRScene, 'id'>): VRScene {
    const newScene: VRScene = {
      ...scene,
      id: `vr_scene_${Date.now()}`
    };

    this.scenes.set(newScene.id, newScene);
    return newScene;
  }

  createVRObject(object: Omit<VRObject, 'id'>): VRObject {
    const newObject: VRObject = {
      ...object,
      id: `vr_object_${Date.now()}`
    };

    this.objects.set(newObject.id, newObject);
    return newObject;
  }

  startVRSession(session: Omit<VRSession, 'id' | 'startTime' | 'duration' | 'userPosition' | 'interactions'>): VRSession {
    const newSession: VRSession = {
      ...session,
      id: `vr_session_${Date.now()}`,
      startTime: new Date(),
      duration: 0,
      userPosition: [],
      interactions: []
    };

    this.sessions.set(newSession.id, newSession);
    return newSession;
  }

  endVRSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || session.endTime) return false;

    session.endTime = new Date();
    session.duration = session.endTime.getTime() - session.startTime.getTime();
    return true;
  }

  convertCircuitToVR(circuitId: string, options?: {
    scale?: number;
    layout?: '3d' | 'stacked' | 'radial';
    includeWires?: boolean;
    includeBoard?: boolean;
    interactive?: boolean;
  }): Promise<VRScene> {
    return new Promise((resolve) => {
      // Simulate circuit to VR conversion
      setTimeout(() => {
        const scene = this.generateVRSceneFromCircuit(circuitId, options);
        this.scenes.set(scene.id, scene);
        resolve(scene);
      }, 2000 + Math.random() * 3000); // 2-5 seconds
    });
  }

  private generateVRSceneFromCircuit(circuitId: string, options?: any): VRScene {
    const defaultOptions = {
      scale: 1.0,
      layout: '3d',
      includeWires: true,
      includeBoard: true,
      interactive: true,
      ...options
    };

    const objects: VRObject[] = [];

    // Add PCB board
    if (defaultOptions.includeBoard) {
      objects.push({
        id: `board_${circuitId}`,
        name: 'PCB Board',
        type: 'board',
        sourceId: circuitId,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 10, y: 0.2, z: 8 },
        material: {
          color: '#2D5A27',
          metallic: 0.1,
          roughness: 0.8,
          transparency: 0
        },
        physics: {
          enabled: true,
          mass: 1,
          friction: 0.5,
          restitution: 0.1,
          kinematic: false
        },
        interactions: [
          { type: 'grab', enabled: true },
          { type: 'touch', enabled: true }
        ],
        metadata: {
          layer: 'board',
          visible: true,
          selectable: true,
          collidable: true
        }
      });
    }

    // Add sample components
    const components = [
      { name: 'Resistor R1', type: 'resistor', pos: { x: -3, y: 0.3, z: -2 } },
      { name: 'Capacitor C1', type: 'capacitor', pos: { x: 0, y: 0.3, z: -2 } },
      { name: 'Transistor Q1', type: 'transistor', pos: { x: 3, y: 0.3, z: -2 } },
      { name: 'IC U1', type: 'ic', pos: { x: 0, y: 0.3, z: 2 } }
    ];

    components.forEach((comp, index) => {
      objects.push({
        id: `comp_${circuitId}_${index}`,
        name: comp.name,
        type: 'component',
        sourceId: `comp_${index}`,
        position: comp.pos,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 0.5, z: 0.5 },
        material: {
          color: this.getComponentColor(comp.type),
          metallic: 0.3,
          roughness: 0.4,
          transparency: 0
        },
        physics: {
          enabled: true,
          mass: 0.1,
          friction: 0.3,
          restitution: 0.2,
          kinematic: false
        },
        interactions: [
          { type: 'grab', enabled: true },
          { type: 'touch', enabled: true }
        ],
        metadata: {
          layer: 'components',
          visible: true,
          selectable: true,
          collidable: true
        }
      });
    });

    // Add wires if requested
    if (defaultOptions.includeWires) {
      const wires = [
        { from: components[0].pos, to: components[1].pos, color: '#FFD700' },
        { from: components[1].pos, to: components[2].pos, color: '#FF6B6B' },
        { from: components[2].pos, to: components[3].pos, color: '#4ECDC4' }
      ];

      wires.forEach((wire, index) => {
        const distance = Math.sqrt(
          Math.pow(wire.to.x - wire.from.x, 2) +
          Math.pow(wire.to.z - wire.from.z, 2)
        );

        objects.push({
          id: `wire_${circuitId}_${index}`,
          name: `Wire ${index + 1}`,
          type: 'wire',
          position: {
            x: (wire.from.x + wire.to.x) / 2,
            y: 0.25,
            z: (wire.from.z + wire.to.z) / 2
          },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: distance, y: 0.05, z: 0.05 },
          material: {
            color: wire.color,
            metallic: 0.8,
            roughness: 0.2,
            transparency: 0
          },
          physics: {
            enabled: false,
            mass: 0,
            friction: 0,
            restitution: 0,
            kinematic: true
          },
          interactions: [
            { type: 'touch', enabled: true }
          ],
          metadata: {
            layer: 'wires',
            visible: true,
            selectable: true,
            collidable: false
          }
        });
      });
    }

    const interactions: VRInteraction[] = [
      {
        id: `interaction_${circuitId}_1`,
        type: 'grab',
        trigger: {
          type: 'gesture',
          condition: 'grab_gesture',
          parameters: { minConfidence: 0.8 }
        },
        action: {
          type: 'transform_object',
          target: 'component',
          parameters: { allowTranslation: true, allowRotation: true }
        },
        feedback: {
          visual: true,
          audio: true,
          haptic: true,
          duration: 200
        },
        conditions: [],
        metadata: {
          enabled: true,
          priority: 1,
          cooldown: 0,
          usage: 0
        }
      }
    ];

    return {
      id: `scene_${circuitId}`,
      name: `VR Circuit: ${circuitId}`,
      description: '3D visualization of circuit design in virtual reality',
      type: 'circuit_design',
      environment: {
        lighting: 'studio',
        scale: defaultOptions.scale,
        gravity: true,
        physics: true
      },
      objects,
      interactions,
      waypoints: [
        {
          id: 'waypoint_overview',
          name: 'Overview',
          position: { x: 0, y: 5, z: 10 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          description: 'Overview of the entire circuit'
        },
        {
          id: 'waypoint_detail',
          name: 'Component Detail',
          position: { x: 0, y: 2, z: 0 },
          rotation: { x: -0.3, y: 0, z: 0, w: 0.95 },
          description: 'Close-up view of components'
        }
      ],
      metadata: {
        created: new Date(),
        updated: new Date(),
        createdBy: 'system',
        duration: 600, // 10 minutes
        difficulty: 'intermediate'
      }
    };
  }

  private getComponentColor(type: string): string {
    const colors: Record<string, string> = {
      resistor: '#8B4513',
      capacitor: '#4169E1',
      transistor: '#228B22',
      ic: '#696969',
      diode: '#DC143C',
      inductor: '#DAA520'
    };
    return colors[type] || '#808080';
  }

  runVRSimulation(sceneId: string, parameters: {
    duration?: number;
    recordInteractions?: boolean;
    physicsEnabled?: boolean;
    realTime?: boolean;
  }): Promise<SimulationResult> {
    return new Promise((resolve) => {
      // Simulate VR simulation
      setTimeout(() => {
        const result = this.simulateVRScene(sceneId, parameters);
        resolve(result);
      }, 1000 + Math.random() * 4000); // 1-5 seconds
    });
  }

  private simulateVRScene(sceneId: string, parameters: any): SimulationResult {
    const scene = this.scenes.get(sceneId);
    if (!scene) {
      return {
        success: false,
        error: 'VR scene not found',
        simulationTime: Date.now()
      };
    }

    // Simulate physics and interactions
    const interactions = Math.floor(Math.random() * 20) + 5;
    const physicsEvents = Math.floor(Math.random() * 50) + 10;
    const duration = parameters.duration || 30000; // 30 seconds default

    return {
      success: true,
      sceneId,
      duration,
      interactions,
      physicsEvents,
      performance: {
        averageFPS: 85 + Math.random() * 10,
        minFPS: 70 + Math.random() * 10,
        maxLatency: 20 + Math.random() * 10,
        stability: 0.9 + Math.random() * 0.08
      },
      events: Array.from({ length: interactions }, (_, i) => ({
        timestamp: Date.now() + (i * duration / interactions),
        type: ['grab', 'place', 'touch'][Math.floor(Math.random() * 3)],
        objectId: scene.objects[Math.floor(Math.random() * scene.objects.length)].id,
        data: { confidence: 0.8 + Math.random() * 0.15 }
      })),
      simulationTime: Date.now()
    };
  }

  getVRDevice(id: string): VRDevice | undefined {
    return this.devices.get(id);
  }

  getVRScene(id: string): VRScene | undefined {
    return this.scenes.get(id);
  }

  getVRSession(id: string): VRSession | undefined {
    return this.sessions.get(id);
  }

  getVRObject(id: string): VRObject | undefined {
    return this.objects.get(id);
  }

  getAllVRDevices(): VRDevice[] {
    return Array.from(this.devices.values());
  }

  getAllVRScenes(): VRScene[] {
    return Array.from(this.scenes.values());
  }

  getAllVRSessions(): VRSession[] {
    return Array.from(this.sessions.values());
  }

  getAllVRObjects(): VRObject[] {
    return Array.from(this.objects.values());
  }

  updateVRScene(id: string, updates: Partial<VRScene>): boolean {
    const scene = this.scenes.get(id);
    if (!scene) return false;

    Object.assign(scene, updates);
    scene.metadata.updated = new Date();
    return true;
  }

  deleteVRScene(id: string): boolean {
    return this.scenes.delete(id);
  }

  exportVRConfiguration(): Record<string, unknown> {
    return {
      devices: Array.from(this.devices.values()),
      scenes: Array.from(this.scenes.values()),
      sessions: Array.from(this.sessions.values()),
      objects: Array.from(this.objects.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface SimulationResult {
  success: boolean;
  error?: string;
  sceneId?: string;
  duration?: number;
  interactions?: number;
  physicsEvents?: number;
  performance?: {
    averageFPS: number;
    minFPS: number;
    maxLatency: number;
    stability: number;
  };
  events?: Array<{
    timestamp: number;
    type: string;
    objectId: string;
    data: Record<string, unknown>;
  }>;
  simulationTime: number;
}

interface VRProcessingResult {
  success: boolean;
  error?: string;
  scene?: VRScene;
  session?: VRSession;
  result?: SimulationResult;
  processingTime?: number;
}

export const virtualRealityDesignManager = new VirtualRealityDesignManager();