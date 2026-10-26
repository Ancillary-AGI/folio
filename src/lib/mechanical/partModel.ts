/**
 * The mechanical part model shared by the design panel, the project store, and
 * the agent tools.
 *
 * A part is a solid rectangular prism (beam or plate) with SI dimensions and a
 * material from the engineering catalogue. Mass properties are derived here so
 * the viewport, the analyser, and an agent's observation can never disagree
 * about which body they are looking at.
 */
import type { Material } from '../../types/toolbox'
import { getMaterial } from './materials'
import {
  analyseBeam,
  beamBucklingLoad,
  beamNaturalFrequencies,
  type BeamSupport,
} from './mechanicalAnalysis'

export interface PartLoads {
  forces: Array<{ x: number; y: number; z: number; magnitude: number }>
  moments: Array<{ x: number; y: number; z: number; magnitude: number }>
  pressure: number
  temperature: number
}

export interface PartConstraints {
  fixed: boolean
  pinned: boolean
  roller: boolean
  displacement: { x: boolean; y: boolean; z: boolean }
  rotation: { x: boolean; y: boolean; z: boolean }
}

export interface PartProperties {
  mass: number
  volume: number
  centerOfMass: [number, number, number]
  momentOfInertia: [number, number, number]
}

export interface PartDimensions {
  length: number
  width: number
  height: number
}

export type MechanicalPartKind = 'beam' | 'plate'

export interface MechanicalPart {
  id: string
  name: string
  kind: MechanicalPartKind
  dimensions: PartDimensions
  position: [number, number, number]
  rotation: [number, number, number]
  materialKey: string
  material: Material
  properties: PartProperties
  loads: PartLoads
  constraints: PartConstraints
}

/** The support a part's constraint flags describe, or `null` when unsupported. */
export function supportFor(part: MechanicalPart): BeamSupport | null {
  if (part.constraints.fixed) return 'cantilever'
  if (part.constraints.pinned || part.constraints.roller) return 'simply-supported'
  return null
}

/** Derived mass properties for a prism at a position. */
export function partProperties(
  dimensions: PartDimensions,
  material: Material,
  position: readonly [number, number, number],
): PartProperties {
  const { length, width, height } = dimensions
  const volume = length * width * height
  const mass = volume * material.density
  return {
    mass,
    volume,
    centerOfMass: [position[0], position[1], position[2]],
    momentOfInertia: [
      (mass * (width ** 2 + height ** 2)) / 12,
      (mass * (length ** 2 + height ** 2)) / 12,
      (mass * (length ** 2 + width ** 2)) / 12,
    ],
  }
}

/** Constraint flags for a named support. */
export function constraintsFor(
  support: 'fixed' | 'pinned' | 'roller' | 'free',
): Pick<PartConstraints, 'fixed' | 'pinned' | 'roller'> {
  return {
    fixed: support === 'fixed',
    pinned: support === 'pinned',
    roller: support === 'roller',
  }
}

export function buildPart(config: {
  id: string
  name: string
  kind: MechanicalPartKind
  dimensions: PartDimensions
  position: [number, number, number]
  materialKey: string
  pressure?: number
  forces?: PartLoads['forces']
  constraints: Pick<PartConstraints, 'fixed' | 'pinned' | 'roller'>
}): MechanicalPart {
  const material = getMaterial(config.materialKey)
  return {
    id: config.id,
    name: config.name,
    kind: config.kind,
    dimensions: config.dimensions,
    position: config.position,
    rotation: [0, 0, 0],
    materialKey: config.materialKey,
    material,
    properties: partProperties(config.dimensions, material, config.position),
    loads: {
      forces: config.forces ?? [],
      moments: [],
      pressure: config.pressure ?? 0,
      temperature: 293.15,
    },
    constraints: {
      ...config.constraints,
      displacement: { x: config.constraints.fixed, y: true, z: config.constraints.fixed },
      rotation: { x: true, y: config.constraints.pinned, z: true },
    },
  }
}

/** The two demo parts the mechanical workspace opens with. */
export function createDefaultMechanicalParts(): MechanicalPart[] {
  return [
    buildPart({
      id: 'beam-1',
      name: 'Main Beam',
      kind: 'beam',
      dimensions: { length: 2, width: 0.1, height: 0.1 },
      position: [1, 0, 0],
      materialKey: 'aluminum',
      forces: [{ x: 0, y: -1, z: 0, magnitude: 1000 }],
      constraints: constraintsFor('fixed'),
    }),
    buildPart({
      id: 'plate-1',
      name: 'Support Plate',
      kind: 'plate',
      dimensions: { length: 0.5, width: 0.5, height: 0.02 },
      position: [1, -0.06, 0],
      materialKey: 'aluminum',
      pressure: 10000,
      constraints: constraintsFor('pinned'),
    }),
  ]
}

/* ------------------------------------------------------------------ *
 * Closed-form analysis
 * ------------------------------------------------------------------ */

export interface PartAnalysis {
  partId: string
  partName: string
  support: BeamSupport
  /** Bending span, metres (the part's length). */
  spanM: number
  transverseForceN: number
  distributedLoadNm: number
  stressPa: number
  /** Signed total stress (axial + bending), pascals. */
  signedStressPa: number
  deflectionM: number
  safetyFactor: number | null
  yields: boolean
  naturalFrequenciesHz: number[]
  bucklingLoadN: number
}

/**
 * Beam-theory analysis of one part. This is the same reduction the panel's
 * static/modal/fatigue views read, so an agent observing a part sees exactly
 * the numbers a human sees in the same workspace.
 */
export function analysePart(part: MechanicalPart): PartAnalysis {
  const support = supportFor(part)
  if (!support) {
    throw new Error(
      `"${part.name}" has no support. Set it to fixed, pinned, or roller before analysing.`,
    )
  }
  const span = part.dimensions.length
  const section = {
    width: part.dimensions.width,
    height: span,
    depth: part.dimensions.height,
  }
  const material = {
    youngsModulus: part.material.youngsModulus,
    yieldStrength: part.material.yieldStrength,
    density: part.material.density,
  }
  const transverseForce = part.loads.forces.reduce((sum, load) => sum + load.magnitude, 0)
  const appliedMoment = part.loads.moments.reduce((sum, load) => sum + load.magnitude, 0)
  // Pressure acts on the span × width face, so it is a line load of p·b N/m.
  const distributedLoad = part.loads.pressure * part.dimensions.width
  const beam = analyseBeam(
    section,
    material,
    { transverseForce, moment: appliedMoment, distributedLoad, span },
    { support },
  )
  return {
    partId: part.id,
    partName: part.name,
    support,
    spanM: span,
    transverseForceN: transverseForce,
    distributedLoadNm: distributedLoad,
    stressPa: Math.abs(beam.totalStress),
    signedStressPa: beam.totalStress,
    deflectionM: beam.deflection,
    safetyFactor: beam.safetyFactor,
    yields: beam.yields,
    naturalFrequenciesHz: beamNaturalFrequencies(section, material, support, span),
    bucklingLoadN: beamBucklingLoad(section, material, support, span),
  }
}
