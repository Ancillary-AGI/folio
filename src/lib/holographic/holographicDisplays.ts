import * as THREE from 'three';

export interface HolographicDisplay {
  id: string;
  name: string;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  content: HolographicContent;
  effects: HolographicEffects;
  visible: boolean;
}

export interface HolographicContent {
  type: 'circuit' | 'component' | 'data' | 'text' | 'model';
  data: Record<string, unknown>;
  material?: THREE.Material;
  geometry?: THREE.BufferGeometry;
}

export interface HolographicEffects {
  glow: boolean;
  scanlines: boolean;
  flicker: boolean;
  depth: number;
  opacity: number;
  color: string;
  animation: boolean;
}

export class HolographicDisplayManager {
  private displays: Map<string, HolographicDisplay> = new Map();
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.renderer = renderer;
  }

  createHolographicDisplay(display: Omit<HolographicDisplay, 'id'>): HolographicDisplay {
    const holoDisplay: HolographicDisplay = {
      id: `holo-display-${Date.now()}`,
      ...display
    };

    this.displays.set(holoDisplay.id, holoDisplay);
    this.renderHolographicDisplay(holoDisplay);

    return holoDisplay;
  }

  private renderHolographicDisplay(display: HolographicDisplay): void {
    const group = new THREE.Group();

    // Create base geometry based on content type
    let geometry: THREE.BufferGeometry;
    let material: THREE.Material;

    switch (display.content.type) {
      case 'circuit':
        geometry = new THREE.PlaneGeometry(display.scale.x, display.scale.y);
        material = new THREE.MeshBasicMaterial({
          color: display.effects.color,
          transparent: true,
          opacity: display.effects.opacity,
          side: THREE.DoubleSide
        });
        break;

      case 'component':
        geometry = new THREE.BoxGeometry(display.scale.x, display.scale.y, display.scale.z);
        material = new THREE.MeshPhongMaterial({
          color: display.effects.color,
          transparent: true,
          opacity: display.effects.opacity,
          emissive: display.effects.glow ? display.effects.color : '#000000'
        });
        break;

      case 'text':
        // Simple text representation
        geometry = new THREE.PlaneGeometry(display.scale.x, display.scale.y);
        material = new THREE.MeshBasicMaterial({
          color: display.effects.color,
          transparent: true,
          opacity: display.effects.opacity
        });
        break;

      default:
        geometry = new THREE.SphereGeometry(display.scale.x / 2);
        material = new THREE.MeshBasicMaterial({
          color: display.effects.color,
          transparent: true,
          opacity: display.effects.opacity
        });
    }

    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    // Add holographic effects
    if (display.effects.glow) {
      const glowMaterial = new THREE.MeshBasicMaterial({
        color: display.effects.color,
        transparent: true,
        opacity: 0.3,
        side: THREE.BackSide
      });
      const glowMesh = new THREE.Mesh(geometry.clone().scale(1.2, 1.2, 1.2), glowMaterial);
      group.add(glowMesh);
    }

    if (display.effects.scanlines) {
      // Add scanline effect
      const scanlineGeometry = new THREE.PlaneGeometry(display.scale.x, display.scale.y);
      const scanlineMaterial = new THREE.MeshBasicMaterial({
        color: display.effects.color,
        transparent: true,
        opacity: 0.1,
        wireframe: true
      });
      const scanlineMesh = new THREE.Mesh(scanlineGeometry, scanlineMaterial);
      group.add(scanlineMesh);
    }

    if (display.effects.flicker) {
      // Add flicker animation
      const flickerMaterial = material.clone();
      flickerMaterial.opacity = Math.random() * 0.5 + 0.5;
      mesh.material = flickerMaterial;
    }

    group.position.copy(display.position);
    group.rotation.copy(display.rotation);
    group.scale.copy(display.scale);

    if (display.visible) {
      this.scene.add(group);
    }

    // Store reference for updates
    (display as any).threeGroup = group;
  }

  updateHolographicDisplay(displayId: string, updates: Partial<HolographicDisplay>): boolean {
    const display = this.displays.get(displayId);
    if (!display) return false;

    Object.assign(display, updates);

    // Remove old display
    if ((display as any).threeGroup) {
      this.scene.remove((display as any).threeGroup);
    }

    // Re-render
    this.renderHolographicDisplay(display);
    return true;
  }

  removeHolographicDisplay(displayId: string): boolean {
    const display = this.displays.get(displayId);
    if (!display) return false;

    if ((display as any).threeGroup) {
      this.scene.remove((display as any).threeGroup);
    }

    this.displays.delete(displayId);
    return true;
  }

  setDisplayVisibility(displayId: string, visible: boolean): boolean {
    const display = this.displays.get(displayId);
    if (!display) return false;

    display.visible = visible;

    if ((display as any).threeGroup) {
      (display as any).threeGroup.visible = visible;
    }

    return true;
  }

  animateDisplays(): void {
    this.displays.forEach(display => {
      if (display.effects.animation && (display as any).threeGroup) {
        const group = (display as any).threeGroup;
        group.rotation.y += 0.01;

        // Flicker effect
        if (display.effects.flicker && group.children[0]) {
          const material = group.children[0].material as THREE.Material;
          if ('opacity' in material) {
            (material as any).opacity = Math.random() * 0.3 + 0.7;
          }
        }
      }
    });
  }

  getAllDisplays(): HolographicDisplay[] {
    return Array.from(this.displays.values());
  }

  getDisplay(displayId: string): HolographicDisplay | undefined {
    return this.displays.get(displayId);
  }
}

export const createHolographicManager = (scene: THREE.Scene, renderer: THREE.WebGLRenderer) => {
  return new HolographicDisplayManager(scene, renderer);
};