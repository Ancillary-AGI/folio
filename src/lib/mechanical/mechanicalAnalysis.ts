/**
 * Mechanical analysis in SI units, built on the closed forms in `./structural`.
 *
 * `mechanicalDesign.analyzeThermalBehavior` and `analyzeStructuralIntegrity` reached for
 * hardcoded constants instead of the part's own dimensions: a 10 mm thickness in
 * `width * 0.01`, a 5 mm extreme fibre in `moment * 0.005`, a 100 mm span in
 * `Math.pow(0.1, 3)`, and a conduction resistance of `1/(kA)` with no thickness term at
 * all. Those numbers describe one specific part, so every other part was analysed
 * against the wrong geometry while looking authoritative.
 *
 * Everything here takes the real dimensions and returns a result traceable to a textbook
 * formula, so the companion test can recompute each number independently. Units are SI
 * throughout: metres, pascals, watts, kelvin.
 */

import {
  axialStress,
  bendingStress,
  cantileverTipDeflection,
  cantileverUniformDeflection,
  circleInertia,
  rectangleInertia,
  sectionModulus,
} from './structural';
import { boxInertia, cylinderInertia, sphereInertia } from './dynamics';

/** A rectangular prism in metres. */
export interface PrismDimensions {
  width: number;
  height: number;
  depth: number;
}

/** A cylinder in metres, its axis along `height`. */
export interface CylinderDimensions {
  /** Diameter, metres. */
  diameter: number;
  height: number;
}

export interface ThermalMaterial {
  thermalConductivity: number;
  specificHeat: number;
}

export interface StructuralMaterial {
  youngsModulus: number;
  yieldStrength: number;
  density: number;
}

export interface ConductiveResult {
  /** `L/(kA)`, kelvin per watt. */
  thermalResistance: number;
  temperatureRise: number;
  steadyStateTemp: number;
  /** `C/R` in seconds, where `C = m·c_p`. */
  timeConstant: number;
  /** Watts per square metre leaving the conducting face. */
  heatFlux: number;
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number, got ${value}.`);
  }
}

function nonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number, got ${value}.`);
  }
}

/** Area of the face heat leaves through, square metres. */
function conductingArea(dimensions: PrismDimensions): number {
  return dimensions.width * dimensions.height;
}

/**
 * One-dimensional conduction from the hot face to ambient.
 *
 * `R = L/(kA)` with `L` the thickness the heat crosses — the term the old code dropped.
 * `τ = m·c_p/R`, and the steady rise is `P·R`.
 */
export function analyseConduction(
  dimensions: PrismDimensions,
  material: ThermalMaterial,
  mass: number,
  ambientTemp: number,
  powerDissipation: number,
): ConductiveResult {
  positive(dimensions.width, 'width');
  positive(dimensions.height, 'height');
  positive(dimensions.depth, 'depth');
  positive(material.thermalConductivity, 'thermalConductivity');
  positive(material.specificHeat, 'specificHeat');
  positive(mass, 'mass');
  nonNegative(powerDissipation, 'powerDissipation');
  if (!Number.isFinite(ambientTemp)) {
    throw new Error(`ambientTemp must be finite, got ${ambientTemp}.`);
  }

  const area = conductingArea(dimensions);
  const thermalResistance = dimensions.depth / (material.thermalConductivity * area);
  const temperatureRise = powerDissipation * thermalResistance;
  const heatCapacity = mass * material.specificHeat;
  return {
    thermalResistance,
    temperatureRise,
    steadyStateTemp: ambientTemp + temperatureRise,
    timeConstant: heatCapacity * thermalResistance,
    heatFlux: powerDissipation / area,
  };
}

/**
 * Support condition for `analyseBeam`.
 *
 * `cantilever` is fixed at the root and free at the tip. `simply-supported` rests
 * on a pin and a roller, so the point load acts at midspan and the distributed
 * load may run the full span. Other boundary conditions are rejected rather than
 * silently approximated by the nearest of these two.
 */
export type BeamSupport = 'cantilever' | 'simply-supported';

export interface BeamLoad {
  /** Axial force, newtons. Changes axial stress only, never transverse deflection. */
  force?: number;
  /** Transverse load at the free end (cantilever) or midspan (simply supported), newtons. */
  transverseForce?: number;
  /** Uniformly distributed transverse load, newtons per metre. */
  distributedLoad?: number;
  /** Applied end moment, newton-metres. Bends the beam without axial stress. */
  moment?: number;
  /** Unsupported span, metres. Defaults to the height. */
  span?: number;
}

export interface BeamResult {
  /** Cross-sectional area, square metres. */
  area: number;
  /** Second moment of area about the bending axis, metres⁴. */
  inertia: number;
  /** Distance to the extreme fibre, metres. */
  extremeFibre: number;
  /** Elastic section modulus `I/c`, metres³. */
  sectionModulus: number;
  /** Peak bending moment used for the section stress, N·m (signed). */
  bendingMoment: number;
  axialStress: number;
  bendingStress: number;
  totalStress: number;
  /** `yield / |total|`, or `null` when nothing is loaded. */
  safetyFactor: number | null;
  /** Peak transverse deflection of the span, metres. */
  deflection: number;
  /** True when the total stress exceeds yield. */
  yields: boolean;
}

/** Second moment of area of a rectangular section, `b·h³/12`, metres⁴. */
export function prismInertia(dimensions: PrismDimensions): number {
  positive(dimensions.width, 'width');
  positive(dimensions.depth, 'depth');
  return rectangleInertia(dimensions.width, dimensions.depth);
}

/** Second moment of area of a circular section, `πd⁴/64`, metres⁴. */
export function cylinderSectionInertia(dimensions: CylinderDimensions): number {
  positive(dimensions.diameter, 'diameter');
  return circleInertia(dimensions.diameter);
}

/** Peak |M| of a simply supported span under an end moment, a midspan point load, and a uniform load. */
function simplySupportedPeakMoment(
  moment: number,
  pointLoad: number,
  distributedLoad: number,
  span: number,
): number {
  const momentAt = (x: number): number =>
    moment * (1 - x / span) +
    (pointLoad / 2) * Math.min(x, span - x) +
    (distributedLoad / 2) * x * (span - x);

  const candidates = [0, span / 2, span];
  if (distributedLoad !== 0) {
    // Stationary points of the two parabolic halves of the moment diagram.
    const left = (-moment / span + pointLoad / 2 + (distributedLoad * span) / 2) / distributedLoad;
    const right = (-moment / span - pointLoad / 2 + (distributedLoad * span) / 2) / distributedLoad;
    if (left > 0 && left < span / 2) candidates.push(left);
    if (right > span / 2 && right < span) candidates.push(right);
  }

  let peak = 0;
  for (const x of candidates) {
    const value = momentAt(x);
    if (Math.abs(value) > Math.abs(peak)) peak = value;
  }
  return peak;
}

function simplySupportedDeflection(
  moment: number,
  pointLoad: number,
  distributedLoad: number,
  span: number,
  modulus: number,
  inertia: number,
): number {
  // Each term is the peak of that load case. The point and uniform peaks both
  // occur at midspan, so their sum is exact; the end-moment peak sits elsewhere,
  // making the combined value a conservative upper bound.
  return (
    (pointLoad * span ** 3) / (48 * modulus * inertia) +
    (5 * distributedLoad * span ** 4) / (384 * modulus * inertia) +
    (moment * span ** 2) / (9 * Math.sqrt(3) * modulus * inertia)
  );
}

function cantileverDeflection(
  moment: number,
  pointLoad: number,
  distributedLoad: number,
  span: number,
  modulus: number,
  inertia: number,
): number {
  return (
    (pointLoad === 0 ? 0 : cantileverTipDeflection(pointLoad, span, modulus, inertia)) +
    (distributedLoad === 0
      ? 0
      : cantileverUniformDeflection(distributedLoad, span, modulus, inertia)) +
    (moment === 0 ? 0 : (moment * span ** 2) / (2 * modulus * inertia))
  );
}

/**
 * Axial plus bending analysis of a rectangular section.
 *
 * `σ_axial = P/A` and `σ_bending = Mc/I` with the peak bending moment of the chosen
 * support condition. Axial force never contributes to transverse deflection. The
 * deflection is the textbook peak of each modelled load case; when an end moment is
 * combined with transverse loads, the reported peak is a conservative superposition
 * (it never understates the deflection). `safetyFactor` is `null` rather than
 * `Infinity` when nothing is loaded, because dividing by a zero stress is not a
 * safety factor.
 */
export function analyseBeam(
  dimensions: PrismDimensions,
  material: StructuralMaterial,
  loads: BeamLoad,
  options: { support?: BeamSupport } = {},
): BeamResult {
  positive(dimensions.width, 'width');
  positive(dimensions.depth, 'depth');
  positive(material.youngsModulus, 'youngsModulus');
  positive(material.yieldStrength, 'yieldStrength');
  // Force and moment are signed by nature — compression and reverse bending are
  // physical — so only their finiteness is checked here.
  if (loads.force !== undefined && !Number.isFinite(loads.force)) {
    throw new Error(`force must be finite, got ${loads.force}.`);
  }
  if (loads.transverseForce !== undefined && !Number.isFinite(loads.transverseForce)) {
    throw new Error(`transverseForce must be finite, got ${loads.transverseForce}.`);
  }
  if (loads.distributedLoad !== undefined && !Number.isFinite(loads.distributedLoad)) {
    throw new Error(`distributedLoad must be finite, got ${loads.distributedLoad}.`);
  }
  if (loads.moment !== undefined && !Number.isFinite(loads.moment)) {
    throw new Error(`moment must be finite, got ${loads.moment}.`);
  }
  if (loads.span !== undefined) positive(loads.span, 'span');
  const support = options.support ?? 'cantilever';
  if (support !== 'cantilever' && support !== 'simply-supported') {
    throw new Error(`Unsupported beam support "${String(support)}".`);
  }

  const area = dimensions.width * dimensions.depth;
  const inertia = prismInertia(dimensions);
  const extremeFibre = dimensions.depth / 2;
  const axialForce = loads.force ?? 0;
  const transverseForce = loads.transverseForce ?? 0;
  const distributedLoad = loads.distributedLoad ?? 0;
  const moment = loads.moment ?? 0;
  const span = loads.span ?? dimensions.height;
  const axial = axialForce === 0 ? 0 : axialStress(axialForce, area);
  const bendingMoment =
    support === 'cantilever'
      ? moment + transverseForce * span + (distributedLoad * span * span) / 2
      : simplySupportedPeakMoment(moment, transverseForce, distributedLoad, span);
  const bending = bendingMoment === 0 ? 0 : bendingStress(bendingMoment, extremeFibre, inertia);
  const total = axial + bending;
  const deflection =
    support === 'cantilever'
      ? cantileverDeflection(
          moment,
          transverseForce,
          distributedLoad,
          span,
          material.youngsModulus,
          inertia,
        )
      : simplySupportedDeflection(
          moment,
          transverseForce,
          distributedLoad,
          span,
          material.youngsModulus,
          inertia,
        );

  return {
    area,
    inertia,
    extremeFibre,
    sectionModulus: sectionModulus(inertia, extremeFibre),
    bendingMoment,
    axialStress: axial,
    bendingStress: bending,
    totalStress: total,
    safetyFactor: total === 0 ? null : material.yieldStrength / Math.abs(total),
    deflection,
    yields: Math.abs(total) > material.yieldStrength,
  };
}

/**
 * First four Euler–Bernoulli natural frequencies of a uniform rectangular beam,
 * hertz. `β₁` is 1.875104… for a cantilever and π for a simply supported span;
 * `f_n = β_n² / (2π L²) · √(EI / ρA)`.
 */
export function beamNaturalFrequencies(
  dimensions: PrismDimensions,
  material: StructuralMaterial,
  support: BeamSupport = 'cantilever',
  span?: number,
): number[] {
  positive(dimensions.width, 'width');
  positive(dimensions.depth, 'depth');
  positive(material.youngsModulus, 'youngsModulus');
  positive(material.density, 'density');
  const length = span ?? dimensions.height;
  positive(length, 'span');
  if (support !== 'cantilever' && support !== 'simply-supported') {
    throw new Error(`Unsupported beam support "${String(support)}".`);
  }

  const inertia = prismInertia(dimensions);
  const massPerLength = material.density * dimensions.width * dimensions.depth;
  const beta1 = support === 'cantilever' ? 1.875104068711961 : Math.PI;
  const ratios = support === 'cantilever' ? [1, 6.2669, 17.547, 34.386] : [1, 4, 9, 16];
  const fundamental =
    (beta1 ** 2 / (2 * Math.PI * length ** 2)) *
    Math.sqrt((material.youngsModulus * inertia) / massPerLength);
  return ratios.map(ratio => fundamental * ratio);
}

/**
 * Euler buckling load of a uniform rectangular column, newtons, with the standard
 * effective-length factor: `K = 2` fixed–free, `K = 1` pinned–pinned.
 */
export function beamBucklingLoad(
  dimensions: PrismDimensions,
  material: StructuralMaterial,
  support: BeamSupport = 'cantilever',
  span?: number,
): number {
  positive(dimensions.width, 'width');
  positive(dimensions.depth, 'depth');
  positive(material.youngsModulus, 'youngsModulus');
  const length = span ?? dimensions.height;
  positive(length, 'span');
  if (support !== 'cantilever' && support !== 'simply-supported') {
    throw new Error(`Unsupported beam support "${String(support)}".`);
  }

  const effectiveLengthFactor = support === 'cantilever' ? 2 : 1;
  return (
    (Math.PI ** 2 * material.youngsModulus * prismInertia(dimensions)) /
    (effectiveLengthFactor * length) ** 2
  );
}

/** Principal inertia of a solid prism about its centre, kilogram-metres². */
export function prismMassInertia(mass: number, dimensions: PrismDimensions): ReturnType<typeof boxInertia> {
  positive(mass, 'mass');
  positive(dimensions.width, 'width');
  positive(dimensions.height, 'height');
  positive(dimensions.depth, 'depth');
  return boxInertia(mass, dimensions.width, dimensions.height, dimensions.depth);
}

/** Principal inertia of a solid cylinder about its centre, kilogram-metres². */
export function cylinderMassInertia(mass: number, dimensions: CylinderDimensions): ReturnType<typeof cylinderInertia> {
  positive(mass, 'mass');
  positive(dimensions.diameter, 'diameter');
  positive(dimensions.height, 'height');
  return cylinderInertia(mass, dimensions.diameter / 2, dimensions.height);
}

/** Principal inertia of a solid sphere about its centre, kilogram-metres². */
export function sphereMassInertia(mass: number, radius: number): ReturnType<typeof sphereInertia> {
  positive(mass, 'mass');
  positive(radius, 'radius');
  return sphereInertia(mass, radius);
}

export interface ElectricalProperties {
  /** Ohms. */
  resistance: number;
  /** Farads. */
  capacitance: number;
  /** Henries. */
  inductance: number;
  /** Siemens per metre, used for the skin depth. */
  conductivity?: number;
  /** Relative permeability, defaults to 1 (non-magnetic). */
  relativePermeability?: number;
}

export interface EmcResult {
  /** Angular frequency, radians per second. */
  angularFrequency: number;
  /** Ohms, `√(R² + (X_L − X_C)²)`. */
  impedance: number;
  /** Ohms, `1/(ωC)`. */
  capacitiveReactance: number;
  /** Ohms, `ωL`. */
  inductiveReactance: number;
  /** Hertz, `1/(2π√(LC))`. */
  resonanceFrequency: number;
  /** Metres, `√(2/(ωμσ))`; `null` without a conductivity. */
  skinDepth: number | null;
  /** Decibels, `8.686 · t/δ` over the supplied thickness; `null` without σ or t. */
  shieldingEffectiveness: number | null;
}

/** Permeability of free space, henries per metre. */
const MU_0 = 4 * Math.PI * 1e-7;

/**
 * Impedance and shielding of a lumped electrical model at one frequency.
 *
 * Resonance is `1/(2π√(LC))` and the skin depth is `√(2/(ωμσ))` with `μ = μ₀μ_r`.
 * Shielding effectiveness over a thickness `t` is `8.686 · t/δ` decibels, the standard
 * plane-wave absorption approximation, reported as `null` rather than a fabricated
 * number when no conductivity or thickness is known.
 */
export function analyseEmc(
  properties: ElectricalProperties,
  frequency: number,
  thickness?: number,
): EmcResult {
  if (!Number.isFinite(frequency) || frequency <= 0) {
    throw new Error(`frequency must be a positive finite number, got ${frequency}.`);
  }
  positive(properties.resistance, 'resistance');
  positive(properties.capacitance, 'capacitance');
  positive(properties.inductance, 'inductance');
  if (properties.conductivity !== undefined) positive(properties.conductivity, 'conductivity');
  if (properties.relativePermeability !== undefined) {
    positive(properties.relativePermeability, 'relativePermeability');
  }
  if (thickness !== undefined) positive(thickness, 'thickness');

  const angularFrequency = 2 * Math.PI * frequency;
  const capacitiveReactance = 1 / (angularFrequency * properties.capacitance);
  const inductiveReactance = angularFrequency * properties.inductance;
  const reactance = inductiveReactance - capacitiveReactance;
  const impedance = Math.sqrt(
    properties.resistance * properties.resistance + reactance * reactance,
  );

  let skinDepth: number | null = null;
  let shieldingEffectiveness: number | null = null;
  if (properties.conductivity !== undefined) {
    const permeability = MU_0 * (properties.relativePermeability ?? 1);
    skinDepth = Math.sqrt(2 / (angularFrequency * permeability * properties.conductivity));
    if (thickness !== undefined) {
      shieldingEffectiveness = 8.686 * (thickness / skinDepth);
    }
  }

  return {
    angularFrequency,
    impedance,
    capacitiveReactance,
    inductiveReactance,
    resonanceFrequency: 1 / (2 * Math.PI * Math.sqrt(properties.inductance * properties.capacitance)),
    skinDepth,
    shieldingEffectiveness,
  };
}
