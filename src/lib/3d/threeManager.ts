import { Point, Size } from '../types';
import * as THREE from 'three';

export interface ThreeDModel {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  mesh: THREE.Mesh;
  position: Point;
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
}

export interface ThreeDScene {
  id: string;
  name: string;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  models: ThreeDModel[];
  lights: THREE.Light[];
}

export class ThreeManager {
  private scenes: Map<string, ThreeDScene> = new Map();
  private activeScene: string | null = null;

  createScene(name: string, canvas: HTMLCanvasElement): ThreeDScene {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);

    const camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(canvas.width, canvas.height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const threeDScene: ThreeDScene = {
      id: `scene_${Date.now()}`,
      name,
      scene,
      camera,
      renderer,
      models: [],
      lights: []
    };

    // Add default lighting
    this.addDefaultLighting(threeDScene);

    this.scenes.set(threeDScene.id, threeDScene);
    return threeDScene;
  }

  private addDefaultLighting(scene: ThreeDScene): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.4);
    scene.scene.add(ambientLight);
    scene.lights.push(ambientLight);

    // Directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.scene.add(directionalLight);
    scene.lights.push(directionalLight);

    // Point light
    const pointLight = new THREE.PointLight(0xffaa00, 0.6, 100);
    pointLight.position.set(-10, 10, -10);
    scene.scene.add(pointLight);
    scene.lights.push(pointLight);
  }

  createModel(name: string, geometryType: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus', size: Size): ThreeDModel {
    let geometry: THREE.BufferGeometry;

    switch (geometryType) {
      case 'box':
        geometry = new THREE.BoxGeometry(size.width, size.height, 10);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(size.width / 2, 32, 32);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(size.width / 2, size.width / 2, size.height, 32);
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(size.width / 2, size.height, 32);
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(size.width / 2, size.width / 4, 16, 100);
        break;
      default:
        geometry = new THREE.BoxGeometry(size.width, size.height, 10);
    }

    const material = new THREE.MeshPhongMaterial({
      color: Math.random() * 0xffffff,
      shininess: 100,
      specular: 0x111111
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const model: ThreeDModel = {
      id: `model_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      geometry,
      material,
      mesh,
      position: { x: 0, y: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    };

    return model;
  }

  addModelToScene(sceneId: string, model: ThreeDModel): void {
    const scene = this.scenes.get(sceneId);
    if (scene) {
      scene.scene.add(model.mesh);
      scene.models.push(model);
      this.updateModelTransform(model);
    }
  }

  updateModelTransform(model: ThreeDModel): void {
    model.mesh.position.set(model.position.x, model.position.y, 0);
    model.mesh.rotation.set(model.rotation.x, model.rotation.y, model.rotation.z);
    model.mesh.scale.set(model.scale.x, model.scale.y, model.scale.z);
  }

  createComponentModel(componentType: string, size: Size): ThreeDModel {
    let geometryType: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' = 'box';

    // Map component types to 3D geometries
    switch (componentType.toLowerCase()) {
      case 'resistor':
        geometryType = 'cylinder';
        break;
      case 'capacitor':
        geometryType = 'cylinder';
        break;
      case 'inductor':
        geometryType = 'torus';
        break;
      case 'diode':
        geometryType = 'cone';
        break;
      case 'transistor':
        geometryType = 'box';
        break;
      case 'ic':
      case 'chip':
        geometryType = 'box';
        break;
      case 'led':
        geometryType = 'sphere';
        break;
      default:
        geometryType = 'box';
    }

    return this.createModel(`${componentType}_${Date.now()}`, geometryType, size);
  }

  renderScene(sceneId: string): void {
    const scene = this.scenes.get(sceneId);
    if (scene) {
      scene.renderer.render(scene.scene, scene.camera);
    }
  }

  animateScene(sceneId: string): void {
    const scene = this.scenes.get(sceneId);
    if (scene) {
      // Add orbital controls or animations
      scene.models.forEach(model => {
        model.rotation.y += 0.01;
        this.updateModelTransform(model);
      });
    }
  }

  exportToSTL(sceneId: string): string {
    const scene = this.scenes.get(sceneId);
    if (!scene) return '';

    // Simple STL export (binary format would be more complex)
    let stlContent = 'solid CircuitCAD_Model\n';

    scene.models.forEach(model => {
      const geometry = model.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position;

      if (positions) {
        // Convert to triangles (simplified)
        for (let i = 0; i < positions.count; i += 3) {
          stlContent += '  facet normal 0 0 1\n';
          stlContent += '    outer loop\n';
          for (let j = 0; j < 3; j++) {
            const idx = i + j;
            if (idx < positions.count) {
              const x = positions.getX(idx) * model.scale.x + model.position.x;
              const y = positions.getY(idx) * model.scale.y + model.position.y;
              const z = positions.getZ(idx) * model.scale.z;
              stlContent += `      vertex ${x} ${y} ${z}\n`;
            }
          }
          stlContent += '    endloop\n';
          stlContent += '  endfacet\n';
        }
      }
    });

    stlContent += 'endsolid CircuitCAD_Model\n';
    return stlContent;
  }

  exportToOBJ(sceneId: string): string {
    const scene = this.scenes.get(sceneId);
    if (!scene) return '';

    let objContent = `# Circuit CAD 3D Model Export\n# Generated on ${new Date().toISOString()}\n\n`;
    let vertexOffset = 1;

    scene.models.forEach((model, modelIndex) => {
      objContent += `o ${model.name}\n`;

      const geometry = model.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position;
      const normals = geometry.attributes.normal;

      if (positions) {
        // Write vertices
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i) * model.scale.x + model.position.x;
          const y = positions.getY(i) * model.scale.y + model.position.y;
          const z = positions.getZ(i) * model.scale.z;
          objContent += `v ${x} ${y} ${z}\n`;
        }

        // Write normals if available
        if (normals) {
          for (let i = 0; i < normals.count; i++) {
            const nx = normals.getX(i);
            const ny = normals.getY(i);
            const nz = normals.getZ(i);
            objContent += `vn ${nx} ${ny} ${nz}\n`;
          }
        }

        // Write faces (assuming triangular faces)
        objContent += 's 1\n'; // Smoothing group
        for (let i = 0; i < positions.count; i += 3) {
          const v1 = vertexOffset + i;
          const v2 = vertexOffset + i + 1;
          const v3 = vertexOffset + i + 2;
          objContent += `f ${v1}//${v1} ${v2}//${v2} ${v3}//${v3}\n`;
        }

        vertexOffset += positions.count;
      }

      objContent += '\n';
    });

    return objContent;
  }

  setActiveScene(sceneId: string): void {
    this.activeScene = sceneId;
  }

  getActiveScene(): ThreeDScene | null {
    return this.activeScene ? this.scenes.get(this.activeScene) || null : null;
  }

  getScene(sceneId: string): ThreeDScene | undefined {
    return this.scenes.get(sceneId);
  }

  getAllScenes(): ThreeDScene[] {
    return Array.from(this.scenes.values());
  }

  disposeScene(sceneId: string): void {
    const scene = this.scenes.get(sceneId);
    if (scene) {
      // Dispose of geometries and materials
      scene.models.forEach(model => {
        model.geometry.dispose();
        if (Array.isArray(model.material)) {
          model.material.forEach(mat => mat.dispose());
        } else {
          model.material.dispose();
        }
      });

      // Dispose of lights
      scene.lights.forEach(light => {
        // Lights don't need explicit disposal in Three.js
      });

      // Dispose of renderer
      scene.renderer.dispose();

      this.scenes.delete(sceneId);
    }
  }
}

export const threeManager = new ThreeManager();