/**
 * Material property database, in strict SI units.
 *
 * A note on permittivity and permeability
 * ---------------------------------------
 * The previous definition of this table labelled `permittivity` as
 * "F/m (relative to vacuum)" but stored the *absolute* vacuum value (8.854e-12).
 * Mixing the two conventions is how a capacitance comes out 1e11× wrong, so this
 * table stores the **relative** (dimensionless) permittivity and relative
 * permeability, with the physical constants in one place below.
 *
 * Sources: standard handbook values at ~300 K. Where a property is strongly
 * process-dependent (FR4 permittivity, solder alloys) the nominal value and its
 * typical spread are noted, because quoting a single number for FR4 is a
 * well-known way to mislead.
 */

/** Permittivity of free space (F/m). */
export const VACUUM_PERMITTIVITY = 8.8541878128e-12
/** Permeability of free space (H/m). */
export const VACUUM_PERMEABILITY = 1.25663706212e-6

export interface MaterialProperties {
  /** Volume resistivity (Ω·m). */
  resistivity: number
  /** Relative permittivity εr (dimensionless). */
  relativePermittivity: number
  /** Relative permeability μr (dimensionless). */
  relativePermeability: number
  /** Thermal conductivity (W/(m·K)). */
  thermalConductivity: number
  /** Specific heat capacity (J/(kg·K)). */
  specificHeat: number
  /** Density (kg/m³). */
  density: number
  /** Coefficient of linear thermal expansion (1/K). */
  thermalExpansion: number
  /** Young's modulus (Pa). */
  youngsModulus: number
  /** Poisson's ratio (dimensionless). */
  poissonsRatio: number
  /** Yield strength (Pa). */
  yieldStrength: number
  /** Ultimate tensile strength (Pa). */
  ultimateStrength: number
  /** Melting point (K). */
  meltingPoint: number
  /** Recommended operating temperature range (K). */
  operatingTempRange: { min: number; max: number }
  /** Recommended relative-humidity range (%). */
  humidity: { min: number; max: number }
  /** Free-text provenance, so a value can be checked rather than trusted. */
  source: string
}

export const MATERIAL_LIBRARY: Readonly<Record<string, MaterialProperties>> = Object.freeze({
  copper: {
    resistivity: 1.68e-8,
    relativePermittivity: 1,
    relativePermeability: 1,
    thermalConductivity: 401,
    specificHeat: 385,
    density: 8960,
    thermalExpansion: 16.5e-6,
    youngsModulus: 110e9,
    poissonsRatio: 0.34,
    yieldStrength: 70e6,
    ultimateStrength: 220e6,
    meltingPoint: 1358,
    operatingTempRange: { min: 233, max: 423 },
    humidity: { min: 0, max: 95 },
    source: 'Annealed C11000 (OFHC), room temperature',
  },
  silicon: {
    resistivity: 2300,
    relativePermittivity: 11.7,
    relativePermeability: 1,
    thermalConductivity: 149,
    specificHeat: 700,
    density: 2329,
    thermalExpansion: 2.6e-6,
    youngsModulus: 170e9,
    poissonsRatio: 0.22,
    yieldStrength: 7e9,
    ultimateStrength: 7e9,
    meltingPoint: 1687,
    operatingTempRange: { min: 223, max: 398 },
    humidity: { min: 0, max: 85 },
    source: 'Single-crystal intrinsic Si (100), 300 K',
  },
  fr4: {
    resistivity: 1e12,
    // εr for FR4 spans roughly 4.2–4.8 with resin content, Tg and frequency.
    relativePermittivity: 4.3,
    relativePermeability: 1,
    thermalConductivity: 0.3,
    specificHeat: 1400,
    density: 1850,
    thermalExpansion: 14e-6,
    youngsModulus: 22e9,
    poissonsRatio: 0.28,
    yieldStrength: 310e6,
    ultimateStrength: 415e6,
    meltingPoint: 573,
    operatingTempRange: { min: 233, max: 403 },
    humidity: { min: 0, max: 95 },
    source: 'Nominal woven-glass FR4; εr 4.2–4.8 depending on resin and frequency',
  },
  aluminum: {
    resistivity: 2.82e-8,
    relativePermittivity: 1,
    relativePermeability: 1,
    thermalConductivity: 237,
    specificHeat: 897,
    density: 2700,
    thermalExpansion: 23.1e-6,
    youngsModulus: 70e9,
    poissonsRatio: 0.33,
    yieldStrength: 40e6,
    ultimateStrength: 90e6,
    meltingPoint: 933,
    operatingTempRange: { min: 233, max: 423 },
    humidity: { min: 0, max: 100 },
    source: 'Alloy 6061-T6, room temperature',
  },
  stainlessSteel: {
    resistivity: 6.9e-7,
    relativePermittivity: 1,
    relativePermeability: 1.02,
    thermalConductivity: 16.2,
    specificHeat: 500,
    density: 8000,
    thermalExpansion: 17.3e-6,
    youngsModulus: 193e9,
    poissonsRatio: 0.29,
    yieldStrength: 215e6,
    ultimateStrength: 505e6,
    meltingPoint: 1723,
    operatingTempRange: { min: 20, max: 973 },
    humidity: { min: 0, max: 100 },
    source: 'AISI 304 austenitic stainless steel',
  },
  titanium: {
    resistivity: 4.2e-7,
    relativePermittivity: 1,
    relativePermeability: 1,
    thermalConductivity: 21.9,
    specificHeat: 520,
    density: 4506,
    thermalExpansion: 8.6e-6,
    youngsModulus: 116e9,
    poissonsRatio: 0.32,
    yieldStrength: 880e6,
    ultimateStrength: 950e6,
    meltingPoint: 1941,
    operatingTempRange: { min: 20, max: 673 },
    humidity: { min: 0, max: 100 },
    source: 'Ti-6Al-4V (Grade 5), annealed',
  },
  pla: {
    resistivity: 1e15,
    relativePermittivity: 2.7,
    relativePermeability: 1,
    thermalConductivity: 0.13,
    specificHeat: 1800,
    density: 1240,
    thermalExpansion: 68e-6,
    youngsModulus: 3.5e9,
    poissonsRatio: 0.35,
    yieldStrength: 50e6,
    ultimateStrength: 60e6,
    meltingPoint: 443,
    operatingTempRange: { min: 243, max: 328 },
    humidity: { min: 0, max: 80 },
    source: 'FDM polylactic acid, printed in-plane',
  },
  abs: {
    resistivity: 1e15,
    relativePermittivity: 2.9,
    relativePermeability: 1,
    thermalConductivity: 0.17,
    specificHeat: 1500,
    density: 1040,
    thermalExpansion: 90e-6,
    youngsModulus: 2.3e9,
    poissonsRatio: 0.35,
    yieldStrength: 40e6,
    ultimateStrength: 45e6,
    meltingPoint: 378,
    operatingTempRange: { min: 243, max: 353 },
    humidity: { min: 0, max: 80 },
    source: 'FDM acrylonitrile butadiene styrene',
  },
})

/** Look up a material by name (case- and whitespace-insensitive). */
export function getMaterial(name: string): MaterialProperties | undefined {
  return MATERIAL_LIBRARY[name.trim().toLowerCase()]
}

/** All material names, sorted, for pickers. */
export const MATERIAL_NAMES: readonly string[] = Object.freeze(Object.keys(MATERIAL_LIBRARY).sort())
