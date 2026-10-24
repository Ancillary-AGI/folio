import { Point, Size } from '../../types';
import * as THREE from 'three';
import { OBJExporter, type OBJMesh } from './objExporter';
import { STLExporter } from './stlExporter';

export interface ThreeDModel {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  mesh: THREE.Mesh;
  position: { x: number; y: number; z: number };
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

/** Printability metrics for a single model, computed from its mesh geometry. */
export interface ModelPrintability {
  id: string;
  name: string;
  /** Bounding-box extents in world units (y is the build direction). */
  size: { x: number; y: number; z: number };
  /** Combined area of downward faces tilted past the overhang limit. */
  overhangArea: number;
  /** Overhang area × drop height to the build plate — support material volume. */
  supportVolume: number;
  /** XZ footprint of the bounding box: the area a raft would cover. */
  raftFootprint: number;
  /** Smallest bounding-box extent (a lower bound on wall thickness). */
  minExtent: number;
  /** True when `minExtent` reaches the requested minimum wall thickness. */
  meetsMinimumWall: boolean;
}

export interface PrintabilityReport {
  sceneId: string;
  minWallThickness: number;
  maxOverhangAngleDeg: number;
  models: ModelPrintability[];
}

export class ThreeManager {
  private scenes: Map<string, ThreeDScene> = new Map();
  private activeScene: string | null = null;
  private modelCounter = 0;
  /** Fixed neutral palette — new models cycle through it deterministically. */
  private static readonly MODEL_COLORS = [0x4f7cff, 0x38bdf8, 0x34d399, 0xfbbf24, 0xf472b6, 0xa78bfa];

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
      color: ThreeManager.MODEL_COLORS[this.modelCounter % ThreeManager.MODEL_COLORS.length],
      shininess: 100,
      specular: 0x111111,
      transparent: false,
      opacity: 1.0
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.modelCounter += 1;
    const model: ThreeDModel = {
      id: `model_${Date.now()}_${this.modelCounter}`,
      name,
      geometry,
      material,
      mesh,
      position: { x: 0, y: 0, z: 0 },
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
    model.mesh.position.set(model.position.x, model.position.y, model.position.z);
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

  /** A mesh whose matrix is the model's world transform, without reparenting it. */
  private worldProxy(model: ThreeDModel): THREE.Mesh {
    model.mesh.updateWorldMatrix(true, false);
    const proxy = new THREE.Mesh(model.geometry, model.material);
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(model.mesh.matrixWorld);
    return proxy;
  }

  /**
   * Export the scene as ASCII STL through the shared {@link STLExporter}.
   *
   * The exporter applies each model's full world matrix (rotation included),
   * uses the real index buffer and rejects partial or non-finite geometry, so
   * this path cannot emit the malformed triangles the local writer used to.
   */
  exportToSTL(sceneId: string): string {
    const scene = this.scenes.get(sceneId);
    if (!scene) return '';
    if (scene.models.length === 0) throw new Error('Nothing to export: the scene has no models');

    const exportScene = new THREE.Scene();
    for (const model of scene.models) exportScene.add(this.worldProxy(model));
    return STLExporter.exportScene(exportScene) as string;
  }

  /** Convert one model to world-space OBJ vertices and triangles. */
  private worldOBJMesh(model: ThreeDModel): OBJMesh {
    model.mesh.updateWorldMatrix(true, false);
    const geometry = model.geometry.clone();
    try {
      geometry.applyMatrix4(model.mesh.matrixWorld);
      const position = geometry.getAttribute('position');
      if (!position) throw new Error(`Model ${model.name} has no position attribute`);

      const vertices = Array.from({ length: position.count }, (_, index) => ({
        x: position.getX(index),
        y: position.getY(index),
        z: position.getZ(index),
      }));

      const index = geometry.getIndex();
      const elementCount = index ? index.count : position.count;
      if (elementCount % 3 !== 0) {
        throw new Error(`Model ${model.name} geometry is not made of whole triangles`);
      }
      const faces: number[][] = [];
      for (let i = 0; i < elementCount; i += 3) {
        faces.push(
          index
            ? [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
            : [i, i + 1, i + 2],
        );
      }
      return { name: model.name, vertices, faces };
    } finally {
      geometry.dispose();
    }
  }

  // AR/VR Preview functionality
  enableVR(sceneId: string): boolean {
    try {
      const scene = this.scenes.get(sceneId);
      if (!scene) return false;

      // Check for WebXR support
      if ('xr' in navigator) {
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

  /**
   * Analyze every model in the scene for FDM printability. Every number comes
   * from the actual mesh triangles: overhang area from face normals in world
   * space, support volume from overhang area × mean drop height to the build
   * plate, and the wall check from the bounding-box extent (a slicer-grade
   * cross-section measurement would require the slicing engine itself).
   */
  optimizeFor3DPrinting(
    sceneId: string,
    minWallThickness = 0.8,
    maxOverhangAngleDeg = 45
  ): PrintabilityReport | null {
    const scene = this.scenes.get(sceneId);
    if (!scene) return null;

    const cosThreshold = Math.cos(THREE.MathUtils.degToRad(maxOverhangAngleDeg));
    const models: ModelPrintability[] = scene.models.map(model => {
      const geometry = model.mesh.geometry;
      geometry.computeBoundingBox();
      const localBox = geometry.boundingBox;
      if (!localBox) {
        throw new Error(`Model ${model.name} has no computable bounding box`);
      }
      model.mesh.updateMatrixWorld(true);
      const worldBox = localBox.clone().applyMatrix4(model.mesh.matrixWorld);
      const size = worldBox.getSize(new THREE.Vector3());

      const positions = geometry.getAttribute('position');
      const index = geometry.getIndex();
      const triangleCount = index ? index.count / 3 : positions.count / 3;
      const matrix = model.mesh.matrixWorld;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const ab = new THREE.Vector3();
      const ac = new THREE.Vector3();
      const cross = new THREE.Vector3();
      let overhangArea = 0;
      let supportVolume = 0;

      for (let triangle = 0; triangle < triangleCount; triangle++) {
        const i0 = index ? index.getX(triangle * 3) : triangle * 3;
        const i1 = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
        const i2 = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
        a.fromBufferAttribute(positions, i0).applyMatrix4(matrix);
        b.fromBufferAttribute(positions, i1).applyMatrix4(matrix);
        c.fromBufferAttribute(positions, i2).applyMatrix4(matrix);

        ab.subVectors(b, a);
        ac.subVectors(c, a);
        cross.crossVectors(ab, ac);
        const length = cross.length();
        if (length === 0) continue;

        // Faces tilted less than `maxOverhangAngleDeg` from the build plate
        // (normalY < −cosθ) cannot be printed without support material.
        if (cross.y / length >= -cosThreshold) continue;

        const area = length * 0.5;
        const dropHeight = (a.y + b.y + c.y) / 3 - worldBox.min.y;
        if (dropHeight <= 1e-6) continue; // resting on the build plate
        overhangArea += area;
        supportVolume += area * dropHeight;
      }

      const minExtent = Math.min(size.x, size.y, size.z);
      return {
        id: model.id,
        name: model.name,
        size: { x: size.x, y: size.y, z: size.z },
        overhangArea,
        supportVolume,
        raftFootprint: size.x * size.z,
        minExtent,
        meetsMinimumWall: minExtent >= minWallThickness
      };
    });

    return { sceneId, minWallThickness, maxOverhangAngleDeg, models };
  }

  // Advanced rendering features
  /**
   * Enable real renderer-level tone mapping, color space and shadow settings
   * for the scene. Full-screen passes (bloom, SSAO) would require
   * `EffectComposer`, which this app does not bundle.
   */
  addPostProcessing(sceneId: string): void {
    const scene = this.scenes.get(sceneId);
    if (!scene) return;

    scene.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    scene.renderer.toneMappingExposure = 1.0;
    scene.renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene.renderer.shadowMap.enabled = true;
    scene.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

  /**
   * Export every model as world-space OBJ through the shared {@link OBJExporter}.
   *
   * Vertices are baked with each model's full world matrix, faces come from the
   * real index buffer, and face indices stay correct across multiple meshes —
   * the local writer emitted untransformed vertices and a single shared `vn`
   * index space for every model.
   */
  exportToOBJ(sceneId: string): string {
    const scene = this.scenes.get(sceneId);
    if (!scene) return '';
    if (scene.models.length === 0) throw new Error('Nothing to export: the scene has no models');

    const meshes = scene.models.map((model) => this.worldOBJMesh(model));
    return new OBJExporter().exportMeshes(meshes, 'folio').obj;
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