import * as THREE from 'three';

export interface VRSession {
  id: string;
  display: VRDisplay | null;
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  controllers: THREE.Object3D[];
  isPresenting: boolean;
  frameData?: VRFrameData;
}

export interface VRInteraction {
  controller: THREE.Object3D;
  target: THREE.Object3D | null;
  action: 'select' | 'grab' | 'scale' | 'rotate' | 'teleport';
  hand: 'left' | 'right';
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

export interface VRWorkspace {
  id: string;
  name: string;
  layout: 'circuit_design' | '3d_modeling' | 'simulation' | 'programming';
  tools: VRTool[];
  objects: THREE.Object3D[];
  lighting: VRLighting;
  boundaries: VRBoundaries;
}

export interface VRTool {
  id: string;
  name: string;
  type: 'pointer' | 'grabber' | 'scaler' | 'rotator' | 'drawer' | 'eraser' | 'inspector';
  model: THREE.Object3D;
  position: THREE.Vector3;
  isActive: boolean;
}

export interface VRLighting {
  ambient: THREE.AmbientLight;
  directional: THREE.DirectionalLight[];
  point: THREE.PointLight[];
  spot: THREE.SpotLight[];
}

export interface VRBoundaries {
  width: number;
  height: number;
  depth: number;
  showGrid: boolean;
  gridSize: number;
}

export class VirtualRealityManager {
  private sessions: Map<string, VRSession> = new Map();
  private workspaces: Map<string, VRWorkspace> = new Map();
  private activeInteractions: Map<string, VRInteraction> = new Map();
  private vrDisplays: VRDisplay[] = [];

  constructor() {
    this.initializeVR();
  }

  private async initializeVR(): Promise<void> {
    if ('getVRDisplays' in navigator) {
      try {
        this.vrDisplays = await (navigator as any).getVRDisplays();
        console.log('VR Displays found:', this.vrDisplays.length);
      } catch (error) {
        console.warn('Error getting VR displays:', error);
      }
    } else {
      console.warn('WebVR not supported');
    }
  }

  async createVRSession(sessionId: string, canvas: HTMLCanvasElement): Promise<VRSession | null> {
    if (this.vrDisplays.length === 0) {
      console.warn('No VR displays available');
      return null;
    }

    const display = this.vrDisplays[0]; // Use first available display

    // Create Three.js scene optimized for VR
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

    // Enable VR rendering
    renderer.vr.enabled = true;
    renderer.vr.setDevice(display);

    // Create controllers
    const controllers: THREE.Object3D[] = [];
    for (let i = 0; i < 2; i++) {
      const controller = renderer.vr.getController(i);
      controllers.push(controller);
      scene.add(controller);

      // Add controller models
      const controllerModel = this.createControllerModel(i === 0 ? 'left' : 'right');
      controller.add(controllerModel);
    }

    const session: VRSession = {
      id: sessionId,
      display,
      scene,
      camera,
      renderer,
      controllers,
      isPresenting: false
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  private createControllerModel(hand: 'left' | 'right'): THREE.Object3D {
    const group = new THREE.Group();

    // Simple controller representation
    const geometry = new THREE.CylinderGeometry(0.01, 0.01, 0.1, 8);
    const material = new THREE.MeshPhongMaterial({
      color: hand === 'left' ? 0x00ff00 : 0xff0000,
      transparent: true,
      opacity: 0.8
    });
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    // Add ray for pointing
    const rayGeometry = new THREE.CylinderGeometry(0.001, 0.001, 5, 4);
    const rayMaterial = new THREE.MeshBasicMaterial({
      color: hand === 'left' ? 0x00ff00 : 0xff0000,
      transparent: true,
      opacity: 0.3
    });
    const ray = new THREE.Mesh(rayGeometry, rayMaterial);
    ray.position.z = -2.5;
    ray.rotation.x = Math.PI / 2;
    group.add(ray);

    return group;
  }

  async startVRPresentation(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.display) return false;

    try {
      await session.display.requestPresent([{
        source: session.renderer.domElement
      }]);
      session.isPresenting = true;
      return true;
    } catch (error) {
      console.error('Error starting VR presentation:', error);
      return false;
    }
  }

  stopVRPresentation(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.display || !session.isPresenting) return;

    session.display.exitPresent();
    session.isPresenting = false;
  }

  createVRWorkspace(workspaceData: Omit<VRWorkspace, 'id'>): VRWorkspace {
    const workspace: VRWorkspace = {
      id: `vr-workspace-${Date.now()}`,
      ...workspaceData
    };

    // Initialize workspace scene
    this.initializeWorkspaceScene(workspace);

    this.workspaces.set(workspace.id, workspace);
    return workspace;
  }

  private initializeWorkspaceScene(workspace: VRWorkspace): void {
    // Set up lighting
    workspace.lighting.ambient = new THREE.AmbientLight(0x404040, 0.4);
    workspace.scene.add(workspace.lighting.ambient);

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    workspace.lighting.directional.push(directionalLight);
    workspace.scene.add(directionalLight);

    // Add boundaries visualization
    if (workspace.boundaries.showGrid) {
      this.createGridFloor(workspace);
    }

    // Add workspace tools
    workspace.tools.forEach(tool => {
      workspace.scene.add(tool.model);
      tool.model.position.copy(tool.position);
    });
  }

  private createGridFloor(workspace: VRWorkspace): void {
    const gridSize = workspace.boundaries.gridSize;
    const gridDivisions = Math.max(workspace.boundaries.width, workspace.boundaries.height) / gridSize;

    const gridHelper = new THREE.GridHelper(
      Math.max(workspace.boundaries.width, workspace.boundaries.height),
      gridDivisions,
      0x888888,
      0x444444
    );
    workspace.scene.add(gridHelper);
  }

  addVRInteraction(sessionId: string, interaction: Omit<VRInteraction, 'id'>): void {
    const interactionId = `interaction-${Date.now()}`;
    const fullInteraction: VRInteraction = {
      id: interactionId,
      ...interaction
    };

    this.activeInteractions.set(interactionId, fullInteraction);

    // Handle interaction based on type
    this.processVRInteraction(sessionId, fullInteraction);
  }

  private processVRInteraction(sessionId: string, interaction: VRInteraction): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    switch (interaction.action) {
      case 'select':
        this.handleVRSelect(session, interaction);
        break;
      case 'grab':
        this.handleVRGrab(session, interaction);
        break;
      case 'scale':
        this.handleVRScale(session, interaction);
        break;
      case 'rotate':
        this.handleVRRotate(session, interaction);
        break;
      case 'teleport':
        this.handleVRTeleport(session, interaction);
        break;
    }
  }

  private handleVRSelect(session: VRSession, interaction: VRInteraction): void {
    if (interaction.target) {
      // Highlight selected object
      const material = (interaction.target as THREE.Mesh).material as THREE.Material;
      if ('emissive' in material) {
        (material as any).emissive.setHex(0x444444);
      }

      // Trigger selection event
      this.emitVRInteractionEvent('select', interaction);
    }
  }

  private handleVRGrab(session: VRSession, interaction: VRInteraction): void {
    if (interaction.target) {
      // Attach object to controller
      interaction.controller.add(interaction.target);
      interaction.target.position.set(0, 0, -0.1); // Position in front of controller

      this.emitVRInteractionEvent('grab', interaction);
    }
  }

  private handleVRScale(session: VRSession, interaction: VRInteraction): void {
    if (interaction.target) {
      // Scale object based on controller distance
      const scale = interaction.controller.scale.x;
      interaction.target.scale.setScalar(scale);

      this.emitVRInteractionEvent('scale', interaction);
    }
  }

  private handleVRRotate(session: VRSession, interaction: VRInteraction): void {
    if (interaction.target) {
      // Rotate object with controller
      interaction.target.rotation.copy(interaction.rotation);

      this.emitVRInteractionEvent('rotate', interaction);
    }
  }

  private handleVRTeleport(session: VRSession, interaction: VRInteraction): void {
    // Move camera to teleport location
    session.camera.position.copy(interaction.position);
    session.camera.position.y += 1.6; // Eye level

    this.emitVRInteractionEvent('teleport', interaction);
  }

  private emitVRInteractionEvent(type: string, interaction: VRInteraction): void {
    // Emit custom event for VR interactions
    const event = new CustomEvent('vr-interaction', {
      detail: { type, interaction }
    });
    window.dispatchEvent(event);
  }

  renderVRFrame(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isPresenting) return;

    // Update controllers
    session.controllers.forEach((controller, index) => {
      const gamepad = session.renderer.vr.getController(index)?.userData?.gamepad;
      if (gamepad) {
        // Handle controller inputs
        this.handleControllerInput(session, controller, gamepad, index === 0 ? 'left' : 'right');
      }
    });

    // Render VR frame
    session.renderer.render(session.scene, session.camera);
  }

  private handleControllerInput(session: VRSession, controller: THREE.Object3D, gamepad: Gamepad, hand: 'left' | 'right'): void {
    // Handle trigger button
    if (gamepad.buttons[0]?.pressed) {
      this.handleVRTriggerPress(session, controller, hand);
    }

    // Handle grip button
    if (gamepad.buttons[1]?.pressed) {
      this.handleVRGripPress(session, controller, hand);
    }

    // Handle thumbstick
    const axes = gamepad.axes;
    if (Math.abs(axes[0]) > 0.1 || Math.abs(axes[1]) > 0.1) {
      this.handleVRThumbstick(session, controller, axes[0], axes[1], hand);
    }
  }

  private handleVRTriggerPress(session: VRSession, controller: THREE.Object3D, hand: 'left' | 'right'): void {
    // Raycast to find target
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), session.camera);

    const intersects = raycaster.intersectObjects(session.scene.children, true);
    const target = intersects.length > 0 ? intersects[0].object : null;

    this.addVRInteraction(session.id, {
      controller,
      target,
      action: 'select',
      hand,
      position: controller.position.clone(),
      rotation: controller.rotation.clone()
    });
  }

  private handleVRGripPress(session: VRSession, controller: THREE.Object3D, hand: 'left' | 'right'): void {
    // Find grabbable object
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), session.camera);

    const intersects = raycaster.intersectObjects(session.scene.children, true);
    const target = intersects.find(intersect =>
      intersect.object.userData?.grabbable === true
    )?.object || null;

    if (target) {
      this.addVRInteraction(session.id, {
        controller,
        target,
        action: 'grab',
        hand,
        position: controller.position.clone(),
        rotation: controller.rotation.clone()
      });
    }
  }

  private handleVRThumbstick(session: VRSession, controller: THREE.Object3D, x: number, y: number, hand: 'left' | 'right'): void {
    // Use thumbstick for movement/teleportation
    const moveSpeed = 0.1;
    const moveVector = new THREE.Vector3(x * moveSpeed, 0, -y * moveSpeed);

    // Apply movement to camera or teleport
    if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
      this.addVRInteraction(session.id, {
        controller,
        target: null,
        action: 'teleport',
        hand,
        position: session.camera.position.clone().add(moveVector),
        rotation: session.camera.rotation.clone()
      });
    }
  }

  // Workspace management
  getVRWorkspace(workspaceId: string): VRWorkspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  updateVRWorkspace(workspaceId: string, updates: Partial<VRWorkspace>): boolean {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return false;

    Object.assign(workspace, updates);
    return true;
  }

  deleteVRWorkspace(workspaceId: string): boolean {
    return this.workspaces.delete(workspaceId);
  }

  // Session management
  getVRSession(sessionId: string): VRSession | undefined {
    return this.sessions.get(sessionId);
  }

  endVRSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.stopVRPresentation(sessionId);
    session.renderer.dispose();
    this.sessions.delete(sessionId);
  }

  // Utility methods
  isVRSupported(): boolean {
    return this.vrDisplays.length > 0;
  }

  getAvailableVRDisplays(): VRDisplay[] {
    return [...this.vrDisplays];
  }

  getActiveInteractions(): VRInteraction[] {
    return Array.from(this.activeInteractions.values());
  }

  clearInteractions(): void {
    this.activeInteractions.clear();
  }
}

export const vrManager = new VirtualRealityManager();