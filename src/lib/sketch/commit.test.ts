import { describe, expect, it } from 'vitest'
import { standardComponents } from '../componentLibrary'
import type { Component } from '../supabase'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { commitSketch } from './commit'
import { recognizeSketch, type RecognizedSymbol, type SketchRecognition } from './recognize'

const library = standardComponents as Component[]

const symbol = (overrides: Partial<RecognizedSymbol> = {}): RecognizedSymbol => ({
  kind: 'symbol',
  templateId: 'resistor',
  libraryName: 'Resistor',
  label: 'Resistor',
  rotation: 0,
  confidence: 0.95,
  bounds: { x: 0, y: 0, width: 80, height: 30 },
  center: { x: 100, y: 50 },
  strokeIndexes: [0],
  alternatives: [],
  ...overrides,
})

const recognition = (overrides: Partial<SketchRecognition> = {}): SketchRecognition => ({
  symbols: [],
  wires: [],
  junctions: [],
  rejected: [],
  inkBounds: { x: 0, y: 0, width: 200, height: 200 },
  empty: false,
  ...overrides,
})

const canvasComponent = (overrides: Partial<CanvasComponent> = {}): CanvasComponent => ({
  id: 'existing-1',
  componentId: 'lib-resistor',
  component: library.find((part) => part.name === 'Resistor')!,
  x: 0,
  y: 0,
  rotation: 0,
  reference: 'R1',
  properties: {},
  ...overrides,
})

describe('committing recognised ink', () => {
  it('places the part at library size on the grid and copies its defaults', () => {
    const result = commitSketch(recognition({ symbols: [symbol()] }), { library, gridSize: 10 })

    expect(result.components).toHaveLength(1)
    const placed = result.components[0]
    expect(placed.component.name).toBe('Resistor')
    expect(placed.reference).toBe('R1')
    // Centre the 80×30 symbol on the ink at (100, 50), then snap to 10.
    expect(placed.x).toBe(60)
    expect(placed.y).toBe(40)
    expect(placed.properties.value).toBe('10k')
    expect(placed.id).not.toBe(result.components[0].componentId)
  })

  it('keeps the rotation the recogniser read', () => {
    const result = commitSketch(
      recognition({
        symbols: [symbol({ templateId: 'capacitor', libraryName: 'Capacitor', label: 'Capacitor', rotation: 90, center: { x: 100, y: 100 } })],
      }),
      { library, gridSize: 10 },
    )

    const placed = result.components[0]
    expect(placed.rotation).toBe(90)
    // A 90° capacitor has a 40-wide, 60-tall footprint; rotate the centre
    // offset (−20, 30), so the origin lands at (120, 70).
    expect(placed.x).toBe(120)
    expect(placed.y).toBe(70)
  })

  it('avoids references already on the sheet', () => {
    const result = commitSketch(recognition({ symbols: [symbol(), symbol({ center: { x: 300, y: 50 } })] }), {
      library,
      existingComponents: [canvasComponent({ reference: 'R1' })],
      gridSize: 10,
    })

    expect(result.components.map((component) => component.reference)).toEqual(['R2', 'R3'])
  })

  it('snaps a wire end onto a real pin and records it', () => {
    const result = commitSketch(
      recognition({
        symbols: [symbol()],
        wires: [
          {
            kind: 'wire',
            points: [
              { x: 140, y: 55 },
              { x: 200, y: 55 },
            ],
            strokeIndexes: [1],
          },
        ],
      }),
      { library, gridSize: 10 },
    )

    expect(result.wires).toHaveLength(1)
    const [wire] = result.wires
    expect(wire.points[0]).toEqual({ x: 140, y: 55 })
    expect(wire.connectedPins).toHaveLength(1)
    expect(wire.connectedPins[0]).toEqual({ componentId: result.components[0].id, pinId: 'p2' })
  })

  it('names separate nets in order and never reuses a net already on the sheet', () => {
    const result = commitSketch(
      recognition({
        wires: [
          { kind: 'wire', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], strokeIndexes: [0] },
          { kind: 'wire', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }], strokeIndexes: [1] },
        ],
      }),
      {
        library,
        existingWires: [{ id: 'w0', points: [], connectedPins: [], netName: 'NET1' }],
        gridSize: 10,
      },
    )

    expect(result.wires.map((wire) => wire.netName)).toEqual(['NET2', 'NET3'])
  })

  it('names a net GND only when it actually reaches a ground pin', () => {
    const ground = symbol({
      templateId: 'ground',
      libraryName: 'Ground',
      label: 'Ground',
      bounds: { x: 0, y: 0, width: 40, height: 30 },
      center: { x: 100, y: 15 },
    })
    const result = commitSketch(
      recognition({
        symbols: [ground],
        wires: [
          // The ground part is placed at (80, 0); its pin is at (100, 0).
          { kind: 'wire', points: [{ x: 100, y: 0 }, { x: 100, y: -60 }], strokeIndexes: [1] },
          { kind: 'wire', points: [{ x: 300, y: 300 }, { x: 380, y: 300 }], strokeIndexes: [2] },
        ],
      }),
      { library, gridSize: 10 },
    )

    expect(result.components[0].reference).toBe('G1')
    expect(result.wires[0].netName).toBe('GND')
    expect(result.wires[1].netName).toBe('NET1')
  })

  it('inserts a junction dot as a vertex and joins the wires that meet there', () => {
    const result = commitSketch(
      recognition({
        wires: [
          { kind: 'wire', points: [{ x: 0, y: 50 }, { x: 200, y: 50 }], strokeIndexes: [0] },
          { kind: 'wire', points: [{ x: 100, y: 50 }, { x: 100, y: 0 }], strokeIndexes: [1] },
        ],
        junctions: [{ kind: 'junction', center: { x: 102, y: 48 }, strokeIndexes: [2] }],
      }),
      { library, gridSize: 10 },
    )

    expect(result.junctions).toEqual([{ x: 100, y: 50 }])
    expect(result.wires[0].points).toContainEqual({ x: 100, y: 50 })
    expect(result.wires[0].netName).toBe(result.wires[1].netName)
  })

  it('reports an unrecognised library part instead of placing a wrong one', () => {
    const result = commitSketch(
      recognition({
        symbols: [symbol({ templateId: 'resistor', libraryName: 'Flux Capacitor', label: 'Resistor' })],
      }),
      { library, gridSize: 10 },
    )

    expect(result.components).toHaveLength(0)
    expect(result.unmatched).toEqual(['Resistor'])
    expect(result.warnings.join(' ')).toContain('Flux Capacitor')
    expect(result.warnings.join(' ')).toContain('no parts were placed')
  })

  it('drops a wire that collapses to nothing and says so', () => {
    const result = commitSketch(
      recognition({
        wires: [{ kind: 'wire', points: [{ x: 0, y: 0 }, { x: 2, y: 0 }], strokeIndexes: [0] }],
      }),
      { library, gridSize: 10 },
    )

    expect(result.wires).toHaveLength(0)
    expect(result.warnings.join(' ')).toContain('too short')
  })

  it('reads a drawn resistor and wire end to end', () => {
    const resistor = [
      { x: 0, y: 15 },
      { x: 15, y: 15 },
      { x: 20, y: 5 },
      { x: 30, y: 25 },
      { x: 40, y: 5 },
      { x: 50, y: 25 },
      { x: 60, y: 5 },
      { x: 65, y: 15 },
      { x: 80, y: 15 },
    ]
    const wire = [
      { x: 80, y: 15 },
      { x: 120, y: 15 },
      { x: 160, y: 15 },
    ]
    const read = recognizeSketch([{ points: resistor }, { points: wire }])
    expect(read.symbols[0]?.templateId).toBe('resistor')
    expect(read.wires).toHaveLength(1)

    const result = commitSketch(read, { library, gridSize: 10 })
    expect(result.components).toHaveLength(1)
    expect(result.components[0].reference).toBe('R1')
    expect(result.components[0].x).toBe(0)
    expect(result.components[0].y).toBe(0)
    expect(result.wires).toHaveLength(1)
    expect(result.wires[0].connectedPins).toEqual([
      { componentId: result.components[0].id, pinId: 'p2' },
    ])
    expect(result.wires[0].netName).toBe('NET1')
    expect(result.warnings).toEqual([])
  })

  it('carries existing wire data through untouched', () => {
    const existing: CanvasWire = { id: 'w0', points: [{ x: 0, y: 0 }], connectedPins: [], netName: 'VCC' }
    const result = commitSketch(
      recognition({ wires: [{ kind: 'wire', points: [{ x: 0, y: 100 }, { x: 100, y: 100 }], strokeIndexes: [0] }] }),
      { library, existingWires: [existing], gridSize: 10 },
    )

    expect(result.wires[0].netName).toBe('NET1')
    expect(existing.netName).toBe('VCC')
  })
})
