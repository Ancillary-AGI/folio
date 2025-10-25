import * as THREE from 'three';

export interface ARSession {
  id: string;
  name: string;
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  controller?: XRInputSource;
  hitTestSource?: XRHitTestSource;
  referenceSpace?: XRReferenceSpace;
  isActive: boolean;
}

export interface ARMarker {
  id: string;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  type: 'circuit' | 'component' | 'measurement' | 'annotation';
  data: Record<string, unknown>;
  visible: boolean;
}

export interface ARDesignPreview {
  id: string;
  name: string;
  circuitId: string;
  markers: ARMarker[];
  lighting: {
    intensity: number;
    color: string;
    shadows: boolean;
  };
  interactions: {
    pinchToZoom: boolean;
    dragToMove: boolean;
    tapToSelect: boolean;
  };
  overlays: {
    measurements: boolean;
    grid: boolean;
    annotations: boolean;
  };
}

export class AugmentedRealityManager {
  private sessions: Map<string, ARSession> = new Map();
  private previews: Map<string, ARDesignPreview> = new Map();
  private xrSession: XRSession | null = null;

  constructor() {}

  async initializeAR(): Promise<boolean> {
    if (!navigator.xr) {
      console.warn('WebXR not supported');
      return false;
    }

    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      return supported;
    } catch (error) {
      console.error('Error checking AR support:', error);
      return false;
    }
  }

  async startARSession(sessionId: string, canvas: HTMLCanvasElement): Promise<ARSession | null> {
    try {
      if (!navigator.xr) {
        throw new Error('WebXR not supported');
      }

      this.xrSession = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: canvas.parentElement! }
      });

      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local');
      renderer.xr.setSession(this.xrSession);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

      // Set up lighting
      const light = new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1);
      scene.add(light);

      const session: ARSession = {
        id: sessionId,
        name: `AR Session ${sessionId}`,
        scene,
        camera,
        renderer,
        isActive: true
      };

      this.sessions.set(sessionId, session);

      // Set up hit testing
      this.setupHitTesting(session);

      return session;
    } catch (error) {
      console.error('Error starting AR session:', error);
      return null;
    }
  }

  private setupHitTesting(session: ARSession): void {
    if (!this.xrSession) return;

    this.xrSession.requestReferenceSpace('viewer').then((viewerSpace) => {
      if (this.xrSession) {
        this.xrSession.requestHitTestSource({ space: viewerSpace }).then((hitTestSource) => {
          session.hitTestSource = hitTestSource;
        });
      }
    });
  }

  createDesignPreview(preview: Omit<ARDesignPreview, 'id'>): ARDesignPreview {
    const arPreview: ARDesignPreview = {
      id: `ar-preview-${Date.now()}`,
      ...preview
    };

    this.previews.set(arPreview.id, arPreview);
    return arPreview;
  }

  addMarkerToPreview(previewId: string, marker: Omit<ARMarker, 'id'>): ARMarker | null {
    const preview = this.previews.get(previewId);
    if (!preview) return null;

    const arMarker: ARMarker = {
      id: `marker-${Date.now()}`,
      ...marker
    };

    preview.markers.push(arMarker);
    return arMarker;
  }

  renderARFrame(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isActive) return;

    session.renderer.render(session.scene, session.camera);
  }

  placeCircuitInAR(sessionId: string, previewId: string, position: THREE.Vector3): boolean {
    const session = this.sessions.get(sessionId);
    const preview = this.previews.get(previewId);

    if (!session || !preview) return false;

    // Create circuit visualization in AR
    const circuitGroup = new THREE.Group();

    // Add circuit components as 3D objects
    preview.markers.forEach(marker => {
      if (marker.type === 'circuit' || marker.type === 'component') {
        const geometry = new THREE.BoxGeometry(marker.scale.x, marker.scale.y, marker.scale.z);
        const material = new THREE.MeshPhongMaterial({ color: 0x00ff00, transparent: true, opacity: 0.7 });
        const mesh = new THREE.Mesh(geometry, material);

        mesh.position.copy(marker.position);
        mesh.rotation.copy(marker.rotation);
        mesh.scale.copy(marker.scale);

        circuitGroup.add(mesh);
      }
    });

    circuitGroup.position.copy(position);
    session.scene.add(circuitGroup);

    return true;
  }

  updateMarker(sessionId: string, markerId: string, updates: Partial<ARMarker>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // Find marker in all previews
    for (const preview of this.previews.values()) {
      const marker = preview.markers.find(m => m.id === markerId);
      if (marker) {
        Object.assign(marker, updates);
        return true;
      }
    }

    return false;
  }

  removeMarker(sessionId: string, markerId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    for (const preview of this.previews.values()) {
      const index = preview.markers.findIndex(m => m.id === markerId);
      if (index !== -1) {
        preview.markers.splice(index, 1);
        return true;
      }
    }

    return false;
  }

  endARSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (this.xrSession) {
      this.xrSession.end();
      this.xrSession = null;
    }

    session.isActive = false;
    session.renderer.dispose();
    this.sessions.delete(sessionId);
  }

  getARSession(sessionId: string): ARSession | undefined {
    return this.sessions.get(sessionId);
  }

  getDesignPreview(previewId: string): ARDesignPreview | undefined {
    return this.previews.get(previewId);
  }

  getAllPreviews(): ARDesignPreview[] {
    return Array.from(this.previews.values());
  }

  getAllSessions(): ARSession[] {
    return Array.from(this.sessions.values());
  }

  // Utility methods
  isARSupported(): Promise<boolean> {
    return this.initializeAR();
  }

  getARCapabilities(): Promise<boolean> {
    return navigator.xr?.isSessionSupported('immersive-ar') || Promise.resolve(false);
  }
}

export const arManager = new AugmentedRealityManager();