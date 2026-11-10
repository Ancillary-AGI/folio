/**
 * Land patterns generated from the package a datasheet declares.
 *
 * The hand-built library holds the packages the demo boards use. Everything
 * else resolves to nothing, and a part with no footprint is not a missing
 * drawing — it arrives on the board as a 2 x 1 mm body with zero copper lands,
 * so the router has nowhere to connect it and the board silently cannot be
 * finished. This turns a package name like `SOIC-16 (DW)` or `QFN-24` into the
 * land pattern for that family.
 *
 * The geometry is the industry-nominal pattern for each family — the same pitch
 * and land sizes the hand-built entries already use — and the body outline is
 * derived from the pitch and the lead count. It is deliberately NOT a
 * manufacturer's recommended pattern: package drawings quote body dimensions
 * with and without the leads depending on the family, so guessing which number
 * is which would produce a footprint that looks sourced and may not be. A part
 * that matters gets its real pattern from the library; this keeps the rest
 * routable.
 *
 * Tabbed power packages are absent on purpose. A TO-220 or TO-92 is mostly its
 * tab — a mounting hole, a creepage distance, a body depth off the board — and
 * none of that follows from a lead pitch, so a part that needs one still has to
 * come from the library or the datasheet, and the board says so when it cannot
 * find a pattern.
 *
 * Wi-Fi module castellation rings are absent for the same reason. Espressif
 * draws each module's pad grid in a land-pattern figure; the pitch is not a
 * family constant, and a number picked out of that drawing would read as if it
 * were quoted. Those parts reach the board with a warning instead of guessed
 * copper.
 */
import type { Footprint, FootprintPad } from './footprintLibrary';

/** How the leads of a family are arranged around the body. */
type LeadArrangement =
  | 'dual-lead'
  | 'dual-leadless'
  | 'quad-lead'
  | 'quad-leadless'
  | 'dual-through'
  | 'triode';

interface PackageFamily {
  /** Matched against the lowercased leading token of the package name. */
  pattern: RegExp;
  arrangement: LeadArrangement;
  /** Lead or land pitch in millimetres. */
  pitch: number;
  /** Land size along the lead direction, then along the row. */
  land: [number, number];
  /**
   * Body width across the rows. Absent means it follows the pin count, which is
   * how the pitched families are sold: narrow, wide and extra-wide bodies share
   * one pitch and differ only in how many leads hang off them.
   */
  body?: number;
  /** Circle the lands instead of the usual rectangle (through-hole pins). */
  round?: boolean;
  /** Through-hole drill diameter. */
  drill?: number;
  /** Exposed pad under the body, as a fraction of the body width. */
  thermalPad?: number;
}

const FAMILIES: readonly PackageFamily[] = [
  // 1.27 mm gull-wing family. HSOIC and NSOIC are the PowerPAD variants of it.
  { pattern: /^(soic|hsopic|hsoic|nsoic|sop|so)(-|$)/, arrangement: 'dual-lead', pitch: 1.27, land: [1.5, 0.6] },
  // 0.65 mm shrink outline: the 4.4 mm bodies and the 3.0 mm micro ones.
  { pattern: /^(tssop|ssop)(-|$)/, arrangement: 'dual-lead', pitch: 0.65, land: [1.1, 0.3], body: 4.4 },
  { pattern: /^(vssop|msop)(-|$)/, arrangement: 'dual-lead', pitch: 0.65, land: [1.1, 0.3], body: 3.0 },
  // Leadless dual-row packages: lands printed in from each edge.
  { pattern: /^(x2son|wson|uson|dfn|son|lfcsp)(-|$)/, arrangement: 'dual-leadless', pitch: 0.5, land: [0.7, 0.3], thermalPad: 0.55 },
  // Chip-scale and land grids: a land per pin and no lead to photograph.
  { pattern: /^(dsbga|dlp|lga|oplga|ucsp)(-|$)/, arrangement: 'dual-leadless', pitch: 0.5, land: [0.4, 0.25] },
  { pattern: /^(qfn|vqfn|uqfn|pqfn|ufqfpn)(-|$)/, arrangement: 'quad-leadless', pitch: 0.5, land: [0.7, 0.3], thermalPad: 0.55 },
  { pattern: /^(tqfp|lqfp|uqfp|qfp)(-|$)/, arrangement: 'quad-lead', pitch: 0.5, land: [1.1, 0.3] },
  // Through-hole, on the row spacing the repo's own DIP-8 already lands on.
  { pattern: /^(dip|pdip|cerdip)(-|$)/, arrangement: 'dual-through', pitch: 2.54, land: [1.5, 1.5], round: true, drill: 0.8 },
  { pattern: /^(sot|sc-?70|sc-?88)(-|$)/, arrangement: 'triode', pitch: 0.95, land: [0.8, 0.9] },
];

const mm = (value: number): number => Math.round(value * 1000) / 1000;

/** The finest copper-to-copper gap this CAD routes at. */
const MIN_LAND_GAP_MM = 0.15;

/** Below this an "exposed pad" is a sliver nothing can be attached to. */
const MIN_THERMAL_PAD_MM = 1.0;

/** `SOIC-16 (DW, 10.30 x 7.50 mm) / SSOP-16` -> `soic-16`. */
const leadingToken = (packageText: string): string =>
  packageText.trim().toLowerCase().split(/[\s(/,]/)[0] ?? '';

/**
 * The digits after a family name: `qfn-24` -> 24. `SOT-23` and `SC-70` are
 * designators, and a small-outline part is laid out from its symbol's pin count
 * instead, so that family never reads digits as pins.
 */
function parsedPinCount(token: string, family: PackageFamily): number | undefined {
  if (family.arrangement === 'triode') return undefined;
  const digits = /-(\d{1,3})$/.exec(token)?.[1];
  if (!digits) return undefined;
  const count = Number(digits);
  return count > 0 && count <= 256 ? count : undefined;
}

/**
 * Body width across two rows of pitched leads. Narrow bodies carry up to ten
 * leads and wide ones up to twenty; the 3.9 mm figure is what the hand-built
 * SOIC-8 draws.
 */
const pitchedBodyWidth = (pinCount: number): number =>
  pinCount <= 10 ? 3.9 : pinCount <= 20 ? 7.5 : 12.7;

/** How many leads sit on each side, given the arrangement. */
const perSideCount = (pinCount: number, family: PackageFamily): number =>
  family.arrangement === 'quad-lead' || family.arrangement === 'quad-leadless'
    ? Math.ceil(pinCount / 4)
    : family.arrangement === 'triode'
      ? Math.ceil(pinCount / 2)
      : Math.ceil(pinCount / 2);

/**
 * Body width across the rows: the pitched families step with pin count, the
 * leadless and quad families are as wide as their land span plus the seal
 * margin, and a DIP is 7.62 mm between its pin rows (15.24 mm from 24 leads).
 */
function bodyWidthOf(family: PackageFamily, pinCount: number): number {
  if (family.body) return family.body;
  const perSide = perSideCount(pinCount, family);
  switch (family.arrangement) {
    case 'dual-lead':
      return pitchedBodyWidth(pinCount);
    case 'dual-through':
      return pinCount <= 20 ? 7.62 : 15.24;
    case 'triode':
      return family.pitch * (perSide - 1) + family.land[1] + 1.0;
    case 'dual-leadless':
      return family.pitch * (perSide - 1) + family.land[0] + 1.6;
    case 'quad-lead':
    case 'quad-leadless': {
      // A quad pack has corners: the outermost land of one row and the
      // outermost of the next sit diagonally across the body corner, and on a
      // small body they overlap. Row spacing alone under-sizes them, so the body
      // is the larger of the land span and the span the corner needs.
      const along = family.pitch * (perSide - 1);
      const landSpan = along + family.land[0] + 1.6;
      const leadless = family.arrangement === 'quad-leadless';
      // A leadless land is printed in from the edge, so its body has to carry
      // the land depth and the seal margin twice over before the corner clears.
      const corner =
        along + family.land[1] + 2 * MIN_LAND_GAP_MM + (leadless ? 2 * family.land[0] + 0.4 : 0);
      return Math.max(landSpan, corner);
    }
  }
}

/**
 * Packages this generator will never draw, because the geometry that defines
 * them is not a lead pitch: the tabbed power outlines (TO-92, TO-220, TO-263)
 * and the castellation rings of Wi-Fi modules. Callers use this to refuse a
 * fallback rather than to guess.
 */
export function declaresUnpatternedPackage(packageText: string): boolean {
  const token = leadingToken(packageText);
  return /^(to-\d|module-\d)/.test(token);
}

const isThroughHole = (family: PackageFamily): boolean => family.arrangement === 'dual-through';

const pad = (
  index: number,
  x: number,
  y: number,
  family: PackageFamily,
  /** Land size in board x, then board y: the lead direction swaps per side. */
  size: [number, number],
  throughHole: boolean,
): FootprintPad => ({
  id: `pad${index}`,
  shape: family.round ? 'circle' : 'rectangle',
  position: { x: mm(x), y: mm(y) },
  size: { width: mm(size[0]), height: mm(size[1]) },
  ...(family.drill ? { drillDiameter: family.drill } : {}),
  layers: throughHole ? ['top_copper', 'bottom_copper'] : ['top_copper'],
});

/**
 * Two rows of lands, on the left and the right of the body. Pin 1 is top-left
 * and the count runs down that side and back up the other, which is how every
 * SOIC, SSOP and DIP is marked.
 */
function dualRowPads(pinCount: number, family: PackageFamily, rowCentre: number): FootprintPad[] {
  const perSide = perSideCount(pinCount, family);
  const pads: FootprintPad[] = [];
  for (let side = 0; side < 2; side += 1) {
    const first = side * perSide + 1;
    const count = Math.min(pinCount, (side + 1) * perSide) - first + 1;
    const x = side === 0 ? -rowCentre : rowCentre;
    for (let step = 0; step < count; step += 1) {
      const along = (side === 0 ? (count - 1) / 2 - step : step - (count - 1) / 2) * family.pitch;
      pads.push(pad(first + step, x, along, family, family.land, isThroughHole(family)));
    }
  }
  return pads;
}

/**
 * Lands on all four sides, numbered counter-clockwise from the bottom-left:
 * right along the bottom, up the right, left along the top, down the left. This
 * is the order the hand-built TQFP-32 uses.
 */
function quadPads(pinCount: number, family: PackageFamily, rowCentre: number): FootprintPad[] {
  const perSide = perSideCount(pinCount, family);
  const across: [number, number] = [family.land[1], family.land[0]];
  const alongRow: [number, number] = [family.land[0], family.land[1]];
  const pads: FootprintPad[] = [];
  for (let side = 0; side < 4; side += 1) {
    const first = side * perSide + 1;
    const count = Math.min(pinCount, (side + 1) * perSide) - first + 1;
    for (let step = 0; step < count; step += 1) {
      const offset = (step - (count - 1) / 2) * family.pitch;
      const place =
        side === 0 ? { x: offset, y: -rowCentre, size: across }
        : side === 1 ? { x: rowCentre, y: offset, size: alongRow }
        : side === 2 ? { x: -offset, y: rowCentre, size: across }
        : { x: -rowCentre, y: -offset, size: alongRow };
      pads.push(pad(first + step, place.x, place.y, family, place.size, false));
    }
  }
  return pads;
}

/** SOT-23 and friends: the longer row carries pin 1, the rest mirror above it. */
function triodePads(pinCount: number, family: PackageFamily): FootprintPad[] {
  const bottom = Math.ceil(pinCount / 2);
  const top = pinCount - bottom;
  const size: [number, number] = [family.land[1], family.land[0]];
  const pads: FootprintPad[] = [];
  for (let index = 0; index < bottom; index += 1) {
    pads.push(pad(index + 1, (index - (bottom - 1) / 2) * family.pitch, -family.land[0], family, size, false));
  }
  for (let index = 0; index < top; index += 1) {
    pads.push(pad(bottom + index + 1, ((top - 1) / 2 - index) * family.pitch, family.land[0], family, size, false));
  }
  return pads;
}

/**
 * The land size a family can actually use at its own pitch. The nominal land
 * along the row has to leave the fab gap between one land and the next, which is
 * what catches SOT-23: a 0.9 mm land on a 0.95 mm pitch is 0.05 mm of copper
 * shorting the emitter to the base. The library's own hand-built SOT-23 already
 * lands 0.8 mm wide for the same reason.
 */
const familyAtPitch = (family: PackageFamily): PackageFamily => ({
  ...family,
  land: [family.land[0], Math.min(family.land[1], family.pitch - MIN_LAND_GAP_MM)],
});

/**
 * The land pattern a package name implies, or nothing when the name is not a
 * package this can lay out. `padCount` is the pin count from the schematic
 * symbol and wins over the digits in the name, because `SOT-23` is a 3-pin part.
 */
export function generatedFootprint(packageText: string, padCount?: number): Footprint | undefined {
  const token = leadingToken(packageText);
  if (!token) return undefined;
  const matched = FAMILIES.find((entry) => entry.pattern.test(token));
  if (!matched) return undefined;
  const family = familyAtPitch(matched);
  const pinCount = padCount ?? parsedPinCount(token, family);
  if (!pinCount || pinCount < 1) return undefined;

  const body = bodyWidthOf(family, pinCount);
  const perSide = perSideCount(pinCount, family);
  const leaded = family.arrangement === 'dual-lead' || family.arrangement === 'quad-lead';
  // A DIP's body width IS its row spacing; leaded lands sit out under the toes
  // and leadless lands print in from the edge. The triode layout places its own
  // rows and ignores this.
  const rowCentre =
    family.arrangement === 'dual-through'
      ? body / 2
      : leaded
        ? body / 2 + family.land[0] / 2
        : body / 2 - family.land[0] / 2 - 0.2;

  const pads =
    family.arrangement === 'triode'
      ? triodePads(pinCount, family)
      : family.arrangement === 'quad-lead' || family.arrangement === 'quad-leadless'
        ? quadPads(pinCount, family, rowCentre)
        : dualRowPads(pinCount, family, rowCentre);

  // The exposed pad only exists if there is room for it inside the land ring. A
  // two-pin leadless part has a body barely wider than its two lands, and a pad
  // drawn at the usual fraction of that body sits on top of them: copper shorted
  // across two nets, which no amount of routing undoes. So the pad is the family
  // fraction clipped to the clear area, and dropped when what is left is too
  // small to attach a die to.
  if (family.thermalPad && !isThroughHole(family)) {
    const leadless = family.arrangement === 'dual-leadless' || family.arrangement === 'quad-leadless';
    const innerEdge = leadless
      ? body / 2 - family.land[0] - 0.2
      : body / 2 - family.land[0] / 2;
    const side = mm(Math.min(body * family.thermalPad, 2 * (innerEdge - MIN_LAND_GAP_MM)));
    if (side >= MIN_THERMAL_PAD_MM) {
      pads.push({
        id: 'padthermal',
        shape: 'rectangle',
        position: { x: 0, y: 0 },
        size: { width: side, height: side },
        layers: ['top_copper'],
      });
    }
  }

  const reach = pads.reduce(
    (farthest, entry) => ({
      x: Math.max(farthest.x, Math.abs(entry.position.x) + entry.size.width / 2),
      y: Math.max(farthest.y, Math.abs(entry.position.y) + entry.size.height / 2),
    }),
    { x: body / 2, y: body / 2 },
  );
  // The moulding stops where the leads start to bend, so it is always inside the
  // copper: the land span along the row, plus a margin for the seal.
  const bodyAlong =
    family.arrangement === 'quad-lead' || family.arrangement === 'quad-leadless'
      ? body
      : family.arrangement === 'triode'
        ? family.land[0] * 2 + family.land[1]
        : (perSide - 1) * family.pitch + (family.arrangement === 'dual-through' ? family.land[1] + 1.1 : family.land[1] + 0.9);

  return {
    id: `generated_${token.toUpperCase()}_${pinCount}`,
    name: token.toUpperCase(),
    description: `Generated ${pinCount}-pin ${token.toUpperCase()} land pattern: nominal ${family.pitch} mm pitch geometry for the family, not a manufacturer's recommended pattern.`,
    category: 'ic',
    pads,
    dimensions: { width: mm(body), height: mm(Math.max(bodyAlong, 0.8)) },
    courtyard: [
      { x: mm(-reach.x - 0.25), y: mm(-reach.y - 0.25) },
      { x: mm(reach.x + 0.25), y: mm(-reach.y - 0.25) },
      { x: mm(reach.x + 0.25), y: mm(reach.y + 0.25) },
      { x: mm(-reach.x - 0.25), y: mm(reach.y + 0.25) },
    ],
    metadata: { thermalPad: pads.some((pad) => pad.id === 'padthermal') },
  };
}

/**
 * The package label a board tool can read out of a catalog package string.
 * `SOIC-16 (DW, 10.30 x 7.50 mm) / SSOP-16 (DBQ)` becomes `SOIC-16`: the first
 * option without its orderable suffix, because that is the body the copper has
 * to fit.
 */
export function primaryPackage(packageText: string): string {
  const first = packageText.split('/')[0] ?? packageText
  return leadingToken(first).toUpperCase() || packageText.trim()
}
