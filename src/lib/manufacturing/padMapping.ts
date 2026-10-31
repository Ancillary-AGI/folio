/**
 * Schematic pin ↔ physical footprint pad mapping, shared by the router and the
 * fab exporter so both land traces and net checks on the same copper.
 */
import type { Footprint, FootprintPad } from './footprintLibrary'

/** Last numeric group in an id: `pad3` → 3, `p1` → 1, `anode` → null. */
export function pinNumber(id: string): number | null {
  const match = id.match(/(\d+)(?!.*\d)/)
  return match ? Number(match[1]) : null
}

/** Simple `padN` ids only; grid ids like `pad_1_2` are paired by order. */
export function padNumber(id: string): number | null {
  const match = id.match(/^pad_?(\d+)$/i)
  return match ? Number(match[1]) : null
}

/**
 * Locate the physical copper a schematic pin lands on. Pad ids match pin
 * numbers when both expose them (SOIC pad3 ↔ pin p3); otherwise pins pair
 * with pads in declaration order. Symbols with no package return undefined so
 * the caller keeps the symbol-coordinate fallback.
 */
export function footprintPadForPin(
  footprint: Footprint | undefined,
  pinId: string,
  pinIndex: number,
  pinCount: number,
): FootprintPad | undefined {
  if (!footprint || footprint.pads.length === 0) return undefined
  const numbered = new Map<number, FootprintPad>()
  for (const pad of footprint.pads) {
    const number = padNumber(pad.id)
    if (number !== null) numbered.set(number, pad)
  }
  const pin = pinNumber(pinId)
  if (pin !== null) {
    const match = numbered.get(pin)
    if (match) return match
  }
  return footprint.pads.length === pinCount ? footprint.pads[pinIndex] : undefined
}
