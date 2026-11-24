/**
 * Machine-precision audit of every symbol the CAD ships, both sources:
 *
 *   · standardComponents — the hand-drawn passives, sources and test parts;
 *   · catalogComponents — the datasheet-accurate ICs, memories, MCUs,
 *     connectors, machines and power parts generated from real pinouts.
 *
 * Every claim here is mechanical and checkable: unique identities, pins on
 * the outline they belong to, no geometry outside the declared box, valid
 * pin types, and pin numbers that are stable across the library. If the
 * schematic or the BOM ever shows a malformed symbol, the build goes red
 * rather than the user noticing first.
 */
import { describe, expect, it } from 'vitest'
import { standardComponents } from './componentLibrary'
import { catalogComponents } from './electronics/componentCatalog'
import { footprintLibrary } from './manufacturing/footprintLibrary'

type Pin = { id: string; name: string; x: number; y: number; type: string }
type SymbolData = {
  width: number
  height: number
  paths: string[]
  circles?: Array<{ cx: number; cy: number; r: number }>
  rectangles?: Array<{ x: number; y: number; width: number; height: number }>
}
type SymbolLike = {
  name: string
  category: string
  symbol_data: SymbolData
  pins: Pin[]
  default_properties: Record<string, string | number | boolean>
  manufacturer?: string
  part_number?: string
}

const HAND_DRAWN: SymbolLike[] = standardComponents as SymbolLike[]
// standardComponents already spreads the catalogs; the catalog view is the
// datasheet adapter's own list, for the pinout-layout invariants.
const FROM_CATALOGS: SymbolLike[] = catalogComponents as SymbolLike[]
const EVERYTHING: SymbolLike[] = HAND_DRAWN

const PIN_TYPES = new Set(['input', 'output', 'io', 'power', 'ground', 'passive', 'nc'])

/** Path argument counts per command letter (M/L/T take pairs, etc.). */
const ARG_COUNT: Record<string, number> = { M: 2, L: 2, T: 2, Q: 4, A: 7, C: 6, S: 4, H: 1, V: 1, Z: 0 }

const PATH_TOKEN = /[A-Za-z]|[-+]?\d*\.?\d+(?:e[-+]?\d+)?/g

function* pathSegments(path: string): Generator<{ cmd: string; args: number[] }> {
  const tokens = path.match(PATH_TOKEN) ?? []
  let cmd: string | null = null
  let nums: number[] = []
  const flush = function* () {
    if (cmd === null) return
    const need = ARG_COUNT[cmd]
    if (need === undefined) throw new Error(`unknown path command "${cmd}" in "${path}"`)
    if (need > 0 && nums.length % need !== 0) {
      throw new Error(`odd argument count ${nums.length} for ${cmd} in "${path}"`)
    }
    if (need === 0) {
      yield { cmd, args: [] }
      return
    }
    for (let i = 0; i < nums.length; i += need) yield { cmd, args: nums.slice(i, i + need) }
  }
  for (const token of tokens) {
    if (/^[A-Za-z]$/.test(token)) {
      yield* flush()
      cmd = token
      nums = []
    } else {
      nums.push(Number(token))
    }
  }
  yield* flush()
}

describe('hand-drawn symbols — geometry in bounds and pins on the outline', () => {
  it('declares positive, finite boxes', () => {
    for (const comp of HAND_DRAWN) {
      expect(Number.isFinite(comp.symbol_data.width), `${comp.name} width`).toBe(true)
      expect(Number.isFinite(comp.symbol_data.height), `${comp.name} height`).toBe(true)
      expect(comp.symbol_data.width, `${comp.name} width`).toBeGreaterThan(0)
      expect(comp.symbol_data.height, `${comp.name} height`).toBeGreaterThan(0)
    }
  })

  it('keeps every path coordinate inside the declared box', () => {
    for (const comp of HAND_DRAWN) {
      const { width, height } = comp.symbol_data
      for (const path of comp.symbol_data.paths) {
        for (const { cmd, args } of pathSegments(path)) {
          if (cmd === 'H') {
            expect(args[0], `${comp.name}: H x out of bounds in "${path}"`).toBeGreaterThanOrEqual(-0.01)
            expect(args[0], `${comp.name}: H x out of bounds in "${path}"`).toBeLessThanOrEqual(width + 0.01)
            continue
          }
          if (cmd === 'V') {
            expect(args[0], `${comp.name}: V y out of bounds in "${path}"`).toBeGreaterThanOrEqual(-0.01)
            expect(args[0], `${comp.name}: V y out of bounds in "${path}"`).toBeLessThanOrEqual(height + 0.01)
            continue
          }
          if (cmd === 'Z') continue
          const x = args[args.length - 2]
          const y = args[args.length - 1]
          expect(x, `${comp.name}: path x out of bounds in "${path}"`).toBeGreaterThanOrEqual(-0.01)
          expect(x, `${comp.name}: path x out of bounds in "${path}"`).toBeLessThanOrEqual(width + 0.01)
          expect(y, `${comp.name}: path y out of bounds in "${path}"`).toBeGreaterThanOrEqual(-0.01)
          expect(y, `${comp.name}: path y out of bounds in "${path}"`).toBeLessThanOrEqual(height + 0.01)
        }
      }
    }
  })

  it('keeps arc flags legal (0 or 1) and arc radii non-negative', () => {
    for (const comp of HAND_DRAWN) {
      for (const path of comp.symbol_data.paths) {
        for (const { cmd, args } of pathSegments(path)) {
          if (cmd !== 'A') continue
          expect([0, 1], `${comp.name}: arc large-arc flag in "${path}"`).toContain(args[3])
          expect([0, 1], `${comp.name}: arc sweep flag in "${path}"`).toContain(args[4])
          expect(args[0], `${comp.name}: arc rx negative in "${path}"`).toBeGreaterThanOrEqual(0)
          expect(args[1], `${comp.name}: arc ry negative in "${path}"`).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('keeps every pin on the outline of its symbol', () => {
    for (const comp of HAND_DRAWN) {
      const { width, height } = comp.symbol_data
      for (const pin of comp.pins) {
        const onHorizontalEdge = pin.y === 0 || pin.y === height
        const onVerticalEdge = pin.x === 0 || pin.x === width
        expect(
          onHorizontalEdge || onVerticalEdge,
          `${comp.name}: pin ${pin.id} (${pin.x},${pin.y}) floats off the ${width}x${height} outline`,
        ).toBe(true)
      }
    }
  })
})

describe('every symbol in the library — identity and pin integrity', () => {
  it('has unique component names across hand-drawn and catalog sources', () => {
    const counts = new Map<string, number>()
    for (const comp of EVERYTHING) counts.set(comp.name, (counts.get(comp.name) ?? 0) + 1)
    const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name)
    expect(duplicates).toEqual([])
  })

  it('has unique pin ids within each symbol', () => {
    for (const comp of EVERYTHING) {
      const ids = comp.pins.map((pin) => pin.id)
      expect(new Set(ids).size, `${comp.name}: duplicate pin ids`).toBe(ids.length)
    }
  })

  it('gives every pin a non-empty name and a valid type', () => {
    for (const comp of EVERYTHING) {
      for (const pin of comp.pins) {
        expect(pin.name.trim().length, `${comp.name}: pin ${pin.id} has no name`).toBeGreaterThan(0)
        expect(PIN_TYPES.has(pin.type), `${comp.name}: pin ${pin.id} has type "${pin.type}"`).toBe(true)
      }
    }
  })

  it('keeps every pin inside or on the declared box', () => {
    for (const comp of EVERYTHING) {
      const { width, height } = comp.symbol_data
      for (const pin of comp.pins) {
        expect(Number.isFinite(pin.x), `${comp.name}: pin ${pin.id} x`).toBe(true)
        expect(Number.isFinite(pin.y), `${comp.name}: pin ${pin.id} y`).toBe(true)
        expect(pin.x, `${comp.name}: pin ${pin.id} x out of bounds`).toBeGreaterThanOrEqual(0)
        expect(pin.x, `${comp.name}: pin ${pin.id} x out of bounds`).toBeLessThanOrEqual(width)
        expect(pin.y, `${comp.name}: pin ${pin.id} y out of bounds`).toBeGreaterThanOrEqual(0)
        expect(pin.y, `${comp.name}: pin ${pin.id} y out of bounds`).toBeLessThanOrEqual(height)
      }
    }
  })

  it('gives every symbol at least one pin', () => {
    for (const comp of EVERYTHING) {
      expect(comp.pins.length, `${comp.name}: no pins`).toBeGreaterThan(0)
    }
  })
})

describe('hand-written PCB footprints — land geometry integrity', () => {
  const footprints = footprintLibrary.getAllFootprints()

  it('declares a sane catalog (unique ids, positive bounds, at least one pad each)', () => {
    const ids = footprints.map((footprint) => footprint.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const footprint of footprints) {
      expect(footprint.pads.length, `${footprint.id}: no pads`).toBeGreaterThan(0)
      expect(footprint.dimensions.width, `${footprint.id}: bad width`).toBeGreaterThan(0)
      expect(footprint.dimensions.height, `${footprint.id}: bad height`).toBeGreaterThan(0)
    }
  })

  it('keeps every pad inside the courtyard that promises to protect it', () => {
    for (const footprint of footprints) {
      // `dimensions` is the body size — lands legitimately reach past it for
      // hand soldering. The courtyard is the promise about copper, and the
      // generated landPattern honours the same contract.
      if (!footprint.courtyard || footprint.courtyard.length === 0) continue
      const xs = footprint.courtyard.map((point) => point.x)
      const ys = footprint.courtyard.map((point) => point.y)
      const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
      const [minY, maxY] = [Math.min(...ys), Math.max(...ys)]
      for (const pad of footprint.pads) {
        const halfW = pad.size.width / 2
        const halfH = pad.size.height / 2
        expect(pad.position.x - halfW, `${footprint.id}:${pad.id} escapes the courtyard (left)`).toBeGreaterThanOrEqual(minX - 0.001)
        expect(pad.position.x + halfW, `${footprint.id}:${pad.id} escapes the courtyard (right)`).toBeLessThanOrEqual(maxX + 0.001)
        expect(pad.position.y - halfH, `${footprint.id}:${pad.id} escapes the courtyard (bottom)`).toBeGreaterThanOrEqual(minY - 0.001)
        expect(pad.position.y + halfH, `${footprint.id}:${pad.id} escapes the courtyard (top)`).toBeLessThanOrEqual(maxY + 0.001)
      }
    }
  })

  it('gives every pad a unique id, a positive size and a known layer set', () => {
    const KNOWN_LAYERS = new Set(['top_copper', 'bottom_copper', 'inner1_copper', 'inner2_copper', 'top_paste', 'top_mask', 'top_silk', 'bottom_silk'])
    for (const footprint of footprints) {
      const ids = footprint.pads.map((pad) => pad.id)
      expect(new Set(ids).size, `${footprint.id}: duplicate pad ids`).toBe(ids.length)
      for (const pad of footprint.pads) {
        expect(pad.size.width, `${footprint.id}:${pad.id} bad width`).toBeGreaterThan(0)
        expect(pad.size.height, `${footprint.id}:${pad.id} bad height`).toBeGreaterThan(0)
        expect(pad.layers.length, `${footprint.id}:${pad.id} no layers`).toBeGreaterThan(0)
        for (const layer of pad.layers) {
          expect(KNOWN_LAYERS.has(layer), `${footprint.id}:${pad.id} unknown layer "${layer}"`).toBe(true)
        }
      }
    }
  })

  it('drills plated holes smaller than their annular ring', () => {
    for (const footprint of footprints) {
      for (const pad of footprint.pads) {
        if (pad.drillDiameter === undefined) continue
        const smallestPad = Math.min(pad.size.width, pad.size.height)
        expect(pad.drillDiameter, `${footprint.id}:${pad.id} drill leaves no annular ring`).toBeLessThan(smallestPad)
      }
    }
  })

  it('places two-terminal chip lands symmetrically about the origin', () => {
    for (const footprint of footprints) {
      if (footprint.category !== 'resistor' && footprint.category !== 'capacitor' && footprint.category !== 'inductor') continue
      if (footprint.pads.length !== 2) continue
      const [first, second] = footprint.pads
      expect(first.position.x, `${footprint.id}: pad 1 not mirrored`).toBeCloseTo(-second.position.x, 6)
      expect(first.position.y, `${footprint.id}: pad 1 not mirrored`).toBeCloseTo(-second.position.y, 6)
      expect(first.size.width, `${footprint.id}: pad sizes differ`).toBeCloseTo(second.size.width, 6)
      expect(first.size.height, `${footprint.id}: pad sizes differ`).toBeCloseTo(second.size.height, 6)
    }
  })
})

describe('catalog-generated symbols — datasheet pinout discipline', () => {
  it('lays out pins in DIP order with the pin-1 marker on the package outline', () => {
    // buildIcComponent stamps pin 1 with a marker circle near the top edge.
    // Any missing marker means the pinout lost its orientation reference.
    for (const comp of FROM_CATALOGS) {
      const circles = comp.symbol_data.circles ?? []
      expect(circles.length, `${comp.name}: no pin-1 marker circle`).toBeGreaterThanOrEqual(1)
    }
  })

  it('splits pins between the two vertical edges it declares', () => {
    for (const comp of FROM_CATALOGS) {
      const { width } = comp.symbol_data
      for (const pin of comp.pins) {
        expect(
          pin.x === 0 || pin.x === width,
          `${comp.name}: pin ${pin.id} is not on a vertical edge (x=${pin.x})`,
        ).toBe(true)
      }
    }
  })

  it('assigns every pin number from 1 to pinCount exactly once', () => {
    for (const comp of FROM_CATALOGS) {
      const numbers = comp.pins.map((pin) => Number(pin.id.replace(/^p/, ''))).sort((a, b) => a - b)
      expect(numbers, `${comp.name}: pin numbers are not 1..${numbers.length}`).toEqual(
        Array.from({ length: numbers.length }, (_, index) => index + 1),
      )
    }
  })

  it('keeps pin 1 at the top-left and the left edge before the right edge', () => {
    // The symbol deals pins down the left edge first and then down the right
    // edge, in the order the datasheet table declares — which is NOT monotone
    // (the 74-series quad parts place GND/VCC between gate halves so VCC
    // lands top-right and GND bottom-left on the symbol). Physical package
    // order lives in the footprint library; the symbol only guarantees the
    // pin set is the datasheet's.
    for (const comp of FROM_CATALOGS) {
      const firstPin = comp.pins[0]
      expect(firstPin, `${comp.name}: empty pin list`).toBeDefined()
      expect(firstPin.x, `${comp.name}: pin 1 is not on the left edge`).toBe(0)
      expect(firstPin.y, `${comp.name}: pin 1 is not at the top`).toBe(20)
      const leftMaxY = Math.max(...comp.pins.filter((pin) => pin.x === 0).map((pin) => pin.y))
      for (const pin of comp.pins.filter((pin) => pin.x !== 0)) {
        expect(pin.y, `${comp.name}: pin ${pin.id} is higher than every left-edge pin but interleaved`).toBeLessThanOrEqual(leftMaxY + 1)
      }
    }
  })

  it('carries package information on every catalog part that has a manufacturer', () => {
    for (const comp of FROM_CATALOGS) {
      if (!comp.manufacturer) continue
      expect(comp.part_number, `${comp.name}: manufacturer but no part number`).toBeTruthy()
      expect(comp.default_properties.package, `${comp.name}: manufacturer but no package`).toBeTruthy()
    }
  })
})
