/**
 * types/mechanical.ts
 *
 * The geometry and material shapes shared by the mechanical 3D view and the
 * part model: where a body sits, what it is made of, how it is constrained.
 */
import type { Size } from './index'

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Quaternion {
  w: number
  x: number
  y: number
  z: number
}

export interface MeshGeometry {
  type: 'box' | 'cylinder' | 'sphere' | 'mesh'
  dimensions?: Size
  /** Third box dimension, metres; falls back to `radius * 2` or 0.25. */
  depth?: number
  radius?: number
  /** Placement in the assembly, metres. Omit for automatic layout in a grid. */
  position?: Vector3
  /** Rotation in radians. */
  rotation?: Vector3
  /** URL to an imported STL/OBJ file, for `type: 'mesh'`. */
  mesh?: string
}

export interface Material {
  name: string
  density: number
  youngsModulus: number
  poissonRatio: number
  yieldStrength: number
  ultimateStrength: number
  thermalConductivity: number
  specificHeat: number
  color?: number
}

export interface MechanicalConstraint {
  type: 'fixed' | 'revolute' | 'prismatic' | 'spherical' | 'planar'
  position: Vector3
  orientation: Quaternion
  limits?: {
    min: number
    max: number
  }
}

export interface MechanicalComponent {
  id: string
  name: string
  type: 'structural' | 'fastener' | 'bearing' | 'gear' | 'motor' | 'sensor'
  geometry: MeshGeometry
  material: Material
  constraints: MechanicalConstraint[]
  properties: Record<string, unknown>
}
