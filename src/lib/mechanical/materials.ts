/**
 * Engineering material data in SI units.
 *
 * Properties are for the common temper/grade named on each entry, not generic
 * averages: 6061-T6 aluminium, A36 structural steel, Ti-6Al-4V, C110 copper and
 * common 3D-printing polymers. Analysis code and the 3D viewport both read from
 * here so a part's stated material and the material it is analysed as cannot
 * drift apart.
 */

import type { Material } from '../../types/toolbox';

export const MATERIALS: Record<string, Material> = {
  aluminum: {
    name: 'Aluminum 6061-T6',
    density: 2700,
    youngsModulus: 68.9e9,
    poissonRatio: 0.33,
    yieldStrength: 276e6,
    ultimateStrength: 310e6,
    thermalConductivity: 167,
    specificHeat: 896,
    color: 0x9ca3af,
  },
  steel: {
    name: 'Steel A36',
    density: 7850,
    youngsModulus: 200e9,
    poissonRatio: 0.26,
    yieldStrength: 250e6,
    ultimateStrength: 400e6,
    thermalConductivity: 50,
    specificHeat: 490,
    color: 0x6b7280,
  },
  titanium: {
    name: 'Titanium Ti-6Al-4V',
    density: 4430,
    youngsModulus: 113.8e9,
    poissonRatio: 0.34,
    yieldStrength: 880e6,
    ultimateStrength: 950e6,
    thermalConductivity: 6.7,
    specificHeat: 526,
    color: 0x8b95a5,
  },
  copper: {
    name: 'Copper C110',
    density: 8960,
    youngsModulus: 117e9,
    poissonRatio: 0.34,
    yieldStrength: 70e6,
    ultimateStrength: 220e6,
    thermalConductivity: 401,
    specificHeat: 385,
    color: 0xb87333,
  },
  brass: {
    name: 'Brass C360',
    density: 8500,
    youngsModulus: 100e9,
    poissonRatio: 0.34,
    yieldStrength: 200e6,
    ultimateStrength: 340e6,
    thermalConductivity: 115,
    specificHeat: 380,
    color: 0xb45309,
  },
  abs: {
    name: 'ABS',
    density: 1050,
    youngsModulus: 2.3e9,
    poissonRatio: 0.35,
    yieldStrength: 40e6,
    ultimateStrength: 44e6,
    thermalConductivity: 0.18,
    specificHeat: 1260,
    color: 0xf3f4f6,
  },
  pla: {
    name: 'PLA',
    density: 1240,
    youngsModulus: 3.5e9,
    poissonRatio: 0.35,
    yieldStrength: 50e6,
    ultimateStrength: 60e6,
    thermalConductivity: 0.13,
    specificHeat: 1800,
    color: 0x60a5fa,
  },
  nylon: {
    name: 'Nylon PA6',
    density: 1150,
    youngsModulus: 3e9,
    poissonRatio: 0.39,
    yieldStrength: 80e6,
    ultimateStrength: 85e6,
    thermalConductivity: 0.25,
    specificHeat: 1670,
    color: 0xe5e7eb,
  },
};

/** Case-insensitive material lookup; unknown names fall back to steel. */
export function getMaterial(name: string): Material {
  return MATERIALS[name.toLowerCase()] ?? MATERIALS.steel;
}

/** Strict lookup for callers that must not silently substitute a material. */
export function requireMaterial(name: string): Material {
  const material = MATERIALS[name.toLowerCase()];
  if (!material) {
    throw new Error(
      `Unknown material "${name}". Known materials: ${Object.keys(MATERIALS).join(', ')}.`,
    );
  }
  return material;
}
