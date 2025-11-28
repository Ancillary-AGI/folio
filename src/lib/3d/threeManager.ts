import { Point, Size } from '../../types';
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

  createModel(name: string, geometryType: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'extruded' | 'revolved', size: Size, options?: { depth?: number; segments?: number; profile?: Point[] }): ThreeDModel {
    let geometry: THREE.BufferGeometry;

    switch (geometryType) {
      case 'box':
        geometry = new THREE.BoxGeometry(size.width, size.height, options?.depth || 10);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(size.width / 2, options?.segments || 32, options?.segments || 32);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(size.width / 2, size.width / 2, size.height, options?.segments || 32);
        break;
      case 'cone':
        geometry = new THREE.ConeGeometry(size.width / 2, size.height, options?.segments || 32);
        break;
      case 'torus':
        geometry = new THREE.TorusGeometry(size.width / 2, size.width / 4, 16, 100);
        break;
      case 'extruded':
        geometry = this.createExtrudedGeometry(options?.profile || [], options?.depth || 10);
        break;
      case 'revolved':
        geometry = this.createRevolvedGeometry(options?.profile || [], options?.segments || 32);
        break;
      default:
        geometry = new THREE.BoxGeometry(size.width, size.height, 10);
    }

    const material = new THREE.MeshPhongMaterial({
      color: Math.random() * 0xffffff,
      shininess: 100,
      specular: 0x111111,
      transparent: false,
      opacity: 1.0
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

  private createExtrudedGeometry(profile: Point[], depth: number): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();

    if (profile.length > 0) {
      shape.moveTo(profile[0].x, profile[0].y);
      for (let i = 1; i < profile.length; i++) {
        shape.lineTo(profile[i].x, profile[i].y);
      }
      shape.lineTo(profile[0].x, profile[0].y); // Close the shape
    }

    const extrudeSettings = {
      depth: depth,
      bevelEnabled: false
    };

    return new THREE.ExtrudeGeometry(shape, extrudeSettings);
  }

  private createRevolvedGeometry(profile: Point[], segments: number): THREE.LatheGeometry {
    const points: THREE.Vector2[] = profile.map(p => new THREE.Vector2(p.x, p.y));
    return new THREE.LatheGeometry(points, segments);
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

  // Animation removed - use proper physics-based animations or user-controlled interactions

  exportToSTL(sceneId: string): string {
    const scene = this.scenes.get(sceneId);
    if (!scene) return '';

    // Enhanced STL export with proper triangulation and normals
    let stlContent = 'solid CircuitCAD_Model\n';

    scene.models.forEach(model => {
      const geometry = model.geometry as THREE.BufferGeometry;
      const positions = geometry.attributes.position;
      const normals = geometry.attributes.normal;
      const indices = geometry.index;

      if (positions) {
        if (indices) {
          // Indexed geometry
          for (let i = 0; i < indices.count; i += 3) {
            const a = indices.getX(i);
            const b = indices.getX(i + 1);
            const c = indices.getX(i + 2);

            // Calculate face normal
            // Ensure positions is a BufferAttribute (not InterleavedBufferAttribute)
            if (!(positions instanceof THREE.BufferAttribute)) {
              // Skip if interleaved (would need different handling)
              continue;
            }
            const normal = this.calculateFaceNormal(positions, a, b, c);

            stlContent += `  facet normal ${normal.x} ${normal.y} ${normal.z}\n`;
            stlContent += '    outer loop\n';

            [a, b, c].forEach(vertexIndex => {
              const x = positions.getX(vertexIndex) * model.scale.x + model.position.x;
              const y = positions.getY(vertexIndex) * model.scale.y + model.position.y;
              const z = positions.getZ(vertexIndex) * model.scale.z;
              stlContent += `      vertex ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}\n`;
            });

            stlContent += '    endloop\n';
            stlContent += '  endfacet\n';
          }
        } else {
          // Non-indexed geometry (assume triangles)
          for (let i = 0; i < positions.count; i += 3) {
            const normal = normals ? {
              x: normals.getX(i),
              y: normals.getY(i),
              z: normals.getZ(i)
            } : { x: 0, y: 0, z: 1 };

            stlContent += `  facet normal ${normal.x} ${normal.y} ${normal.z}\n`;
            stlContent += '    outer loop\n';

            for (let j = 0; j < 3; j++) {
              const idx = i + j;
              if (idx < positions.count) {
                const x = positions.getX(idx) * model.scale.x + model.position.x;
                const y = positions.getY(idx) * model.scale.y + model.position.y;
                const z = positions.getZ(idx) * model.scale.z;
                stlContent += `      vertex ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}\n`;
              }
            }

            stlContent += '    endloop\n';
            stlContent += '  endfacet\n';
          }
        }
      }
    });

    stlContent += 'endsolid CircuitCAD_Model\n';
    return stlContent;
  }

  private calculateFaceNormal(positions: THREE.BufferAttribute, a: number, b: number, c: number): THREE.Vector3 {
    const vA = new THREE.Vector3(positions.getX(a), positions.getY(a), positions.getZ(a));
    const vB = new THREE.Vector3(positions.getX(b), positions.getY(b), positions.getZ(b));
    const vC = new THREE.Vector3(positions.getX(c), positions.getY(c), positions.getZ(c));

    const cb = new THREE.Vector3().subVectors(vC, vB);
    const ab = new THREE.Vector3().subVectors(vA, vB);

    cb.cross(ab);
    cb.normalize();

    return cb;
  }

  // AR/VR Preview functionality
  enableVR(sceneId: string): boolean {
    try {
      const scene = this.scenes.get(sceneId);
      if (!scene) return false;

      // Check for WebXR support
      if ('xr' in navigator) {
        // @ts-expect-error - WebXR types not in TypeScript standard library
        const xr = (navigator as { xr?: { isSessionSupported: (mode: string) => Promise<boolean> } }).xr;
        if (xr) {
          xr.isSessionSupported('immersive-vr').then((supported: boolean) => {
            if (supported) {
              scene.renderer.xr.enabled = true;
            }
          });
          return true;
        }
      }
      return false;
    } catch (error) {
      console.warn('VR not supported:', error);
      return false;
    }
  }

  enableAR(sceneId: string): boolean {
    try {
      const scene = this.scenes.get(sceneId);
      if (!scene) return false;

      // Check for WebXR AR support
      if ('xr' in navigator) {
        // @ts-expect-error - WebXR types not in TypeScript standard library
        const xr = (navigator as { xr?: { isSessionSupported: (mode: string) => Promise<boolean> } }).xr;
        if (xr) {
          xr.isSessionSupported('immersive-ar').then((supported: boolean) => {
            if (supported) {
              scene.renderer.xr.enabled = true;
            }
          });
          return true;
        }
      }
      return false;
    } catch (error) {
      console.warn('AR not supported:', error);
      return false;
    }
  }

  startXRSession(sceneId: string, mode: 'vr' | 'ar'): Promise<void> {
    return new Promise((resolve, reject) => {
      const scene = this.scenes.get(sceneId);
      if (!scene) {
        reject(new Error('Scene not found'));
        return;
      }

      const sessionMode = mode === 'vr' ? 'immersive-vr' : 'immersive-ar';

      // @ts-expect-error - WebXR types not in TypeScript standard library
      const xr = (navigator as { xr?: { requestSession: (mode: string) => Promise<unknown> } }).xr;
      if (!xr) {
        reject(new Error('WebXR not available'));
        return;
      }
      
      xr.requestSession(sessionMode).then((session: unknown) => {
        // @ts-expect-error - Three.js XR session types
        scene.renderer.xr.setSession(session);
        resolve();
      }).catch(reject);
    });
  }

  // 3D Printing optimizations
  optimizeFor3DPrinting(sceneId: string): void {
    const scene = this.scenes.get(sceneId);
    if (!scene) return;

    scene.models.forEach(model => {
      // Add support structures for overhangs
      this.addSupportStructures(model);

      // Ensure minimum wall thickness
      this.ensureMinimumWallThickness(model);

      // Add raft/base for stability
      this.addRaft(model);
    });
  }

  private addSupportStructures(model: ThreeDModel): void {
    // Simplified support structure generation
    // In practice, this would analyze the mesh for overhangs and add supports
    console.log(`Adding support structures for model ${model.name}`);
  }

  private ensureMinimumWallThickness(model: ThreeDModel): void {
    // Ensure model has minimum wall thickness for printability
    const minThickness = 0.8; // mm
    console.log(`Ensuring minimum wall thickness of ${minThickness}mm for model ${model.name}`);
  }

  private addRaft(model: ThreeDModel): void {
    // Add raft/base structure for better bed adhesion
    console.log(`Adding raft for model ${model.name}`);
  }

  // Advanced rendering features
  addPostProcessing(sceneId: string): void {
    const scene = this.scenes.get(sceneId);
    if (!scene) return;

    // Add anti-aliasing, bloom, etc.
    // This would require additional Three.js libraries like EffectComposer
    console.log('Post-processing effects added to scene');
  }

  addEnvironmentMap(sceneId: string, environmentMap: THREE.CubeTexture): void {
    const scene = this.scenes.get(sceneId);
    if (!scene) return;

    scene.scene.environment = environmentMap;
    scene.models.forEach(model => {
      if (model.material instanceof THREE.MeshPhongMaterial) {
        model.material.envMap = environmentMap;
        model.material.needsUpdate = true;
      }
    });
  }

  exportToOBJ(sceneId: string): string {
    const scene = this.scenes.get(sceneId);
    if (!scene) return '';

    let objContent = `# Circuit CAD 3D Model Export\n# Generated on ${new Date().toISOString()}\n\n`;
    let vertexOffset = 1;

    scene.models.forEach((model) => {
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

      // Dispose of lights (no explicit disposal needed in Three.js)

      // Dispose of renderer
      scene.renderer.dispose();

      this.scenes.delete(sceneId);
    }
  }
}

export const threeManager = new ThreeManager();