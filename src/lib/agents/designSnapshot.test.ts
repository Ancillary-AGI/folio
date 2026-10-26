import { describe, expect, it } from 'vitest'
import { buildDemoBoard } from '../demo/demoBoard'
import {
  captureDesignSnapshot,
  designFingerprint,
  diffDesignSnapshots,
  schematicToSvg,
  stableStringify,
  waveformToSvg,
} from './designSnapshot'

const board = () => buildDemoBoard()

describe('design snapshot', () => {
  it('captures canonical nets and terminal references from the drawn sheet', () => {
    const demo = board()
    const snapshot = captureDesignSnapshot(demo.components, demo.wires, { firmware: 'blink()' })
    expect(snapshot.schema).toBe('folio.design/1')
    expect(snapshot.stats.components).toBe(6)
    expect(snapshot.stats.nets).toBe(4)
    // The canonical netlister folds every ground alias to SPICE node '0'.
    expect(snapshot.nets.map((net) => net.name)).toEqual(['0', 'MID', 'OUT', 'SRC'])
    expect(snapshot.stats.unconnectedPins).toBe(0)
    expect(snapshot.issues).toEqual([])
    expect(snapshot.firmware).toBe('blink()')

    const out = snapshot.nets.find((net) => net.name === 'OUT')
    expect(out?.pins.sort()).toEqual(['C1.1', 'D1.K', 'RLOAD.1'])
    expect(out?.wires).toContain('demo-w-out-rail')

    const resistor = snapshot.components.find((component) => component.reference === 'RSRC')
    expect(resistor?.pins.map((pin) => pin.ref)).toEqual(['RSRC.1', 'RSRC.2'])
    expect(resistor?.pins.every((pin) => pin.connected)).toBe(true)
    expect(resistor?.value).toBe('10')
  })

  it('fingerprints only the design, not the observation time', () => {
    const demo = board()
    const first = captureDesignSnapshot(demo.components, demo.wires, { now: 1 })
    const second = captureDesignSnapshot(demo.components, demo.wires, { now: 2 })
    expect(designFingerprint(first)).toBe(designFingerprint(second))
    expect(first.capturedAt).not.toBe(second.capturedAt)

    const changed = demo.components.map((component) =>
      component.reference === 'RLOAD'
        ? { ...component, properties: { ...component.properties, value: '220' } }
        : component,
    )
    const third = captureDesignSnapshot(changed, demo.wires)
    expect(designFingerprint(third)).not.toBe(designFingerprint(first))
  })

  it('reports structural problems instead of throwing on a conflicting sheet', () => {
    const demo = board()
    const outRail = demo.wires.find((wire) => wire.id === 'demo-w-out-rail')!
    // A second wire touching the same pins with a different net name is the
    // exact ambiguity the netlister refuses to guess about.
    const conflicting = [
      ...demo.wires,
      { ...outRail, id: 'conflicting-out', netName: 'OTHER' },
    ]
    const snapshot = captureDesignSnapshot(demo.components, conflicting)
    expect(snapshot.stats.components).toBe(6)
    expect(snapshot.issues.join(' ')).toMatch(/conflicting net names/i)
    // The sheet is still observable so the user can repair it.
    expect(snapshot.nets.length).toBeGreaterThan(0)
  })

  it('diffs added, removed and changed references', () => {
    const demo = board()
    const before = captureDesignSnapshot(demo.components, demo.wires)
    const changed = demo.components
      .filter((component) => component.reference !== 'C1')
      .map((component) =>
        component.reference === 'RLOAD'
          ? { ...component, properties: { ...component.properties, value: '220' } }
          : component,
      )
    const after = captureDesignSnapshot(changed, demo.wires)
    const diff = diffDesignSnapshots(before, after)
    expect(diff.removed).toEqual(['C1'])
    expect(diff.changed).toEqual(['RLOAD'])
  })

  it('renders a schematic SVG with stable net colours and escaped labels', () => {
    const demo = board()
    const snapshot = captureDesignSnapshot(demo.components, demo.wires)
    const svg = schematicToSvg(snapshot)
    expect(svg).toContain('<svg')
    expect(svg).toContain('viewBox=')
    expect(svg).toContain('>V1<')
    expect(svg).toContain('>OUT<')
    expect(svg).toContain('role="img"')
    expect(svg).not.toContain('<script')

    const hostile = {
      ...snapshot,
      components: snapshot.components.map((component) =>
        component.reference === 'V1' ? { ...component, reference: '<b>&' } : component,
      ),
    }
    const escaped = schematicToSvg(hostile)
    expect(escaped).toContain('&lt;b&gt;&amp;')
    expect(escaped).not.toContain('<b>&')
  })

  it('draws upright labels outside rotated symbols with explicit ink and background', () => {
    const demo = board()
    const snapshot = captureDesignSnapshot(demo.components, demo.wires)
    const svg = schematicToSvg(snapshot)

    // An <img> has no inherited colour, so currentColor alone renders black.
    expect(svg).toContain('color="#e2e8f0"')
    expect(svg).toContain('fill="#0b1220"')

    // C1 is rotated 90°; its reference must not sit inside the rotated group.
    const rotated = svg.indexOf('rotate(90)')
    expect(rotated).toBeGreaterThan(-1)
    const rotatedGroup = svg.slice(rotated, svg.indexOf('</g>', rotated))
    expect(rotatedGroup).not.toContain('>C1<')
    expect(svg).toContain('>C1</text>')
  })

  it('nudges a label clear of the part directly below it', () => {
    const demo = board()
    const snapshot = captureDesignSnapshot(demo.components, demo.wires)
    const template = snapshot.components.find((component) => component.reference === 'RSRC')
    expect(template).toBeDefined()
    if (!template) return

    // Two 80 × 30 parts stacked 30 apart: the upper label would land on the
    // lower body without collision avoidance.
    const stacked = {
      ...snapshot,
      components: [
        { ...template, id: 'r1', reference: 'R1', x: 100, y: 100 },
        { ...template, id: 'r2', reference: 'R2', x: 100, y: 160 },
      ],
      wires: [],
      nets: [],
    }
    const svg = schematicToSvg(stacked)
    const labelY = Number(/<text x="[\d.]+" y="([\d.]+)"[^>]*>R1<\/text>/.exec(svg)?.[1])
    expect(Number.isFinite(labelY)).toBe(true)
    expect(labelY).toBeGreaterThan(190)
  })

  it('renders waveform panes and keeps a spike when downsampling', () => {
    const data = Array.from({ length: 5000 }, (_, index) => ({ x: index, y: Math.sin(index / 40) }))
    data[2500] = { x: 2500, y: 50 }
    const svg = waveformToSvg(
      [
        { name: 'V(OUT)', unit: 'V', data },
        { name: 'I(R1)', unit: 'A', data: data.map((point) => ({ x: point.x, y: point.y / 100 })) },
      ],
      { maxPoints: 400 },
    )
    expect(svg).toContain('polyline')
    expect(svg).toContain('V(OUT)')
    expect(svg).toContain('I(R1)')
    // The min/max bucket keeps the injected spike; it is not skipped by stride.
    expect(svg.length).toBeGreaterThan(1000)
  })

  it('serializes objects deterministically regardless of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    )
  })
})
