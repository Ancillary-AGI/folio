/**
 * Passive components — resistors, capacitors, inductors with E-series values.
 * Real selection data: E12/E24 preferred values, standard packages with
 * power ratings, capacitor dielectrics with tolerance/voltage, inductor
 * current ratings. Powers the parts browser, BOM costing, and DRC.
 */
export type PassiveFamily = 'resistor' | 'capacitor' | 'inductor' | 'ferrite';

export interface PassivePackage {
  code: string;
  lengthMm: number;
  widthMm: number;
  /** Continuous power rating, W (resistors) or current rating, A. */
  rating: number;
}

export const CHIP_PACKAGES: Record<string, PassivePackage> = {
  '0201': { code: '0201', lengthMm: 0.6, widthMm: 0.3, rating: 0.05 },
  '0402': { code: '0402', lengthMm: 1.0, widthMm: 0.5, rating: 0.063 },
  '0603': { code: '0603', lengthMm: 1.6, widthMm: 0.8, rating: 0.1 },
  '0805': { code: '0805', lengthMm: 2.0, widthMm: 1.25, rating: 0.125 },
  '1206': { code: '1206', lengthMm: 3.2, widthMm: 1.6, rating: 0.25 },
  '1210': { code: '1210', lengthMm: 3.2, widthMm: 2.5, rating: 0.5 },
  '2512': { code: '2512', lengthMm: 6.4, widthMm: 3.2, rating: 1.0 },
};

/** E12 base values per decade. */
export const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];

/** Nearest E12 value to `target` (same decade scaling). Throws on non-positive. */
export function nearestE12(target: number): number {
  if (!(target > 0) || !Number.isFinite(target)) throw new Error(`E12 target must be positive, got ${target}.`);
  const decade = 10 ** Math.floor(Math.log10(target));
  const norm = target / decade;
  let best = E12[0];
  for (const v of E12) {
    if (Math.abs(v - norm) < Math.abs(best - norm)) best = v;
  }
  // Edge: norm above 8.2 + half-step rounds up to next decade.
  if (norm > 9.1) return 10 * decade;
  return best * decade;
}

export interface PassivePart {
  id: string;
  family: PassiveFamily;
  value: string;
  ohms?: number;
  farads?: number;
  henries?: number;
  tolerancePct: number;
  package: string;
  maxVoltageV: number;
  description: string;
}

/** Standard resistor: E12 value, package, tolerance, voltage rating. */
export function resistor(ohms: number, pkg = '0603', tolerancePct = 1): PassivePart {
  const p = CHIP_PACKAGES[pkg];
  if (!p) throw new Error(`Unknown package ${pkg}.`);
  if (!(ohms > 0)) throw new Error(`Resistance must be positive, got ${ohms}.`);
  return {
    id: `R-${ohms}-${pkg}`, family: 'resistor', value: `${ohms}Ω`, ohms,
    tolerancePct, package: pkg,
    maxVoltageV: pkg === '0201' ? 25 : pkg === '0402' ? 50 : 75,
    description: `${ohms}Ω ${tolerancePct}% in ${pkg} (${p.rating}W).`,
  };
}

/** Ceramic capacitor: value, dielectric, package, voltage rating. */
export function capacitor(farads: number, dielectric: 'C0G' | 'X7R' | 'X5R' | 'Y5V' = 'X7R', pkg = '0603', maxVoltageV = 50): PassivePart {
  if (!(farads > 0)) throw new Error(`Capacitance must be positive, got ${farads}.`);
  if (!CHIP_PACKAGES[pkg]) throw new Error(`Unknown package ${pkg}.`);
  const tol = dielectric === 'C0G' ? 5 : dielectric === 'X7R' ? 10 : 20;
  return {
    id: `C-${farads}-${dielectric}-${pkg}`, family: 'capacitor', value: `${farads}F`,
    farads, tolerancePct: tol, package: pkg, maxVoltageV,
    description: `${farads}F ${dielectric} ±${tol}% in ${pkg}, ${maxVoltageV}V.`,
  };
}

/** Inductor: value, package, saturation current. */
export function inductor(henries: number, pkg = '0805', satCurrentA = 1): PassivePart {
  if (!(henries > 0)) throw new Error(`Inductance must be positive, got ${henries}.`);
  if (!CHIP_PACKAGES[pkg]) throw new Error(`Unknown package ${pkg}.`);
  return {
    id: `L-${henries}-${pkg}`, family: 'inductor', value: `${henries}H`,
    henries, tolerancePct: 20, package: pkg, maxVoltageV: 50,
    description: `${henries}H ±20% in ${pkg}, Isat ${satCurrentA}A.`,
  };
}
