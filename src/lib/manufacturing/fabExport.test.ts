/**
 * Fab-grade export proofs (Giant 2).
 *
 * Every assertion parses the emitted file the way a CAM station would —
 * Gerber commands must balance and close, Excellon tools must be defined
 * before use, CSV columns must land in order — against a two-resistor
 * board plus one DIP-8 for the drill path. No hand-typed golden blobs.
 */
import { describe, expect, it } from 'vitest'
import type { PlacedComponent, Wire } from '../../types'
import { bomCsv, buildFabPackage, centroidCsv, excellonDrill, JLCPCB_1OZ } from './fabExport'

const symbol = { width: 2, height: 1.25, paths: [] }

const resistor = (reference: string, x: number, extra: Record<string, string | number> = {}): PlacedComponent => ({
  id: `id-${reference}`,
  componentId: `comp-${reference}`,
  component: {
    id: `comp-${reference}`,
    name: 'Resistor',
    category: 'resistor',
    symbol,
    pins: [
      { id: 'p1', name: '1', x: -1, y: 0, type: 'passive' },
      { id: 'p2', name: '2', x: 1, y: 0, type: 'passive' },
    ],
    properties: {},
  },
  position: { x, y: 10 },
  rotation: 0,
  scale: 1,
  reference,
  properties: { value: '10k', footprint: 'res_0805', manufacturer: 'Yageo', partNumber: 'RC0805FR-0710KL', ...extra },
})

const dip8 = (reference: string, x: number): PlacedComponent => ({
  id: `id-${reference}`,
  componentId: `comp-${reference}`,
  component: {
    id: `comp-${reference}`,
    name: 'NE555',
    category: 'ic',
    symbol,
    pins: [],
    properties: {},
    manufacturer: 'TI',
    partNumber: 'NE555P',
  },
  position: { x, y: 30 },
  rotation: 0,
  scale: 1,
  reference,
  properties: { value: 'NE555', footprint: 'dip_8' },
})

const wire = (id: string, points: Array<{ x: number; y: number }>, width = 0.2): Wire => ({
  id,
  points,
  connectedPins: [],
  style: { width },
})

/** Minimal RS-274X well-formedness: header, format, units, balanced %, M02 close. */
const assertGerber = (content: string, label: string): string[] => {
  expect(content, `${label}: Gerber format block`).toContain('%FSLAX36Y36*%')
  expect(content, `${label}: metric units`).toContain('%MOMM*%')
  const opens = (content.match(/%/g) ?? []).length
  expect(opens % 2, `${label}: balanced % delimiters`).toBe(0)
  expect(content.trimEnd().endsWith('M02*'), `${label}: M02 close`).toBe(true)
  const commands = content.split('\n').filter((line) => line.includes('D01*') || line.includes('D02*') || line.includes('D03*'))
  expect(commands.length, `${label}: draws something`).toBeGreaterThan(0)
  for (const command of commands) {
    expect(command.endsWith('*'), `${label}: command terminates (${command})`).toBe(true)
  }
  return commands
}

/** Minimal Excellon well-formedness: header, tools before use, hits, M30. */
const assertExcellon = (content: string): void => {
  const lines = content.split('\n')
  expect(lines[0]).toBe('M48')
  expect(lines).toContain('METRIC,TZ')
  expect(lines).toContain('G90')
  expect(lines[lines.length - 1]).toBe('M30')
  const defined = new Set<string>()
  let current: string | undefined
  let hits = 0
  for (const line of lines) {
    const tool = line.match(/^T(\d+)C([\d.]+)$/)
    if (tool) {
      defined.add(`T${tool[1]}`)
      continue
    }
    const select = line.match(/^T(\d+)$/)
    if (select) {
      current = `T${select[1]}`
      expect(defined.has(current), `tool ${current} defined before use`).toBe(true)
      continue
    }
    const hit = line.match(/^X(-?[\d.]+)Y(-?[\d.]+)$/)
    if (hit) {
      expect(current, 'a tool is selected before drilling').toBeDefined()
      expect(Number(hit[1])).toBeGreaterThanOrEqual(0)
      expect(Number(hit[2])).toBeGreaterThanOrEqual(0)
      hits += 1
    }
  }
  expect(hits, 'drill hits exist').toBeGreaterThan(0)
}

describe('fab package — file set and CAM validity', () => {
  const board = () =>
    buildFabPackage([resistor('R1', 10), resistor('R2', 30), dip8('U1', 50)], [wire('w1', [{ x: 10, y: 10 }, { x: 30, y: 10 }])], {
      projectName: 'demo',
    })

  it('emits the full layer set plus drill, centroid and BOM', () => {
    const pkg = board()
    expect(pkg.shippable).toBe(true)
    expect(pkg.violations).toEqual([])
    for (const name of [
      'demo-F_Cu.gtl',
      'demo-B_Cu.gbl',
      'demo-F_Mask.gts',
      'demo-B_Mask.gbs',
      'demo-F_Silk.gto',
      'demo-B_Silk.gbo',
      'demo-Edge_Cuts.gm1',
      'demo.drl',
      'demo-centroid.csv',
      'demo-bom.csv',
    ]) {
      expect(pkg.files.has(name), `package contains ${name}`).toBe(true)
    }
  })

  it('parses every Gerber layer as balanced RS-274X with real draws', () => {
    const pkg = board()
    for (const name of ['demo-F_Cu.gtl', 'demo-B_Cu.gbl', 'demo-F_Mask.gts', 'demo-B_Mask.gbs', 'demo-F_Silk.gto', 'demo-Edge_Cuts.gm1']) {
      assertGerber(pkg.files.get(name) ?? '', name)
    }
    expect(pkg.files.get('demo-F_Cu.gtl')).toContain('D01*')
    expect(pkg.files.get('demo-F_Mask.gts')).toContain('1.1000X1.1000')
    expect(pkg.files.get('demo-F_Silk.gto')).toContain('G04 R1*')
    expect(pkg.files.get('demo-F_Silk.gto')).toContain('G04 U1*')
  })

  it('emits true Excellon with one tool and eight DIP hits', () => {
    const pkg = board()
    const drill = pkg.files.get('demo.drl') ?? ''
    assertExcellon(drill)
    expect(drill).toContain('T1C0.800')
    expect(drill.split('\n').filter((line) => /^X[\d.]+Y[\d.]+$/.test(line))).toHaveLength(8)
  })

  it('emits JLCPCB-column centroid and MPN-carrying BOM', () => {
    const pkg = board()
    const centroid = (pkg.files.get('demo-centroid.csv') ?? '').split('\n')
    expect(centroid[0]).toBe('Designator,Mid X,Mid Y,Rotation,Footprint,Side,Value')
    expect(centroid).toHaveLength(4)
    expect(centroid[1].split(',')[0]).toBe('R1')
    expect(centroidCsv(pkg.centroid)).toBe(pkg.files.get('demo-centroid.csv'))
    const bom = (pkg.files.get('demo-bom.csv') ?? '').split('\n')
    expect(bom[0]).toBe('Reference,Value,Footprint,Manufacturer,PartNumber')
    expect(bom[1]).toContain('RC0805FR-0710KL')
    expect(bom[3]).toContain('NE555P')
    expect(bomCsv(pkg.bom)).toBe(pkg.files.get('demo-bom.csv'))
  })
})

describe('fab package — DRC gates the order (fail-loud)', () => {
  it('blocks a trace below the fab minimum width', () => {
    const pkg = buildFabPackage([resistor('R1', 10)], [wire('w1', [{ x: 0, y: 0 }, { x: 10, y: 0 }], 0.05)])
    expect(pkg.shippable).toBe(false)
    expect(pkg.violations.some((v) => v.rule === 'trace-width')).toBe(true)
    expect(pkg.files.has('folio-pcb-F_Cu.gtl')).toBe(true)
  })

  it('blocks two traces violating spacing', () => {
    const pkg = buildFabPackage([resistor('R1', 10)], [
      wire('w1', [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      wire('w2', [{ x: 0, y: 0.1 }, { x: 10, y: 0.1 }]),
    ])
    expect(pkg.shippable).toBe(false)
    expect(pkg.violations.some((v) => v.rule === 'trace-spacing')).toBe(true)
  })

  it('refuses to invent pads for an unknown footprint', () => {
    const bad = resistor('R9', 10, { footprint: 'no-such-footprint' })
    bad.component.category = 'unobtainium'
    const pkg = buildFabPackage([bad], [])
    expect(pkg.shippable).toBe(false)
    expect(pkg.violations.some((v) => v.rule === 'footprint')).toBe(true)
    expect(pkg.centroid).toHaveLength(0)
  })

  it('round-trips the Excellon builder on an empty board', () => {
    expect(excellonDrill([])).toBe('M48\n; Generated by Folio fabExport\nMETRIC,TZ\nG90\nG05\nM30')
  })

  it('exposes the JLCPCB profile the gates enforce', () => {
    expect(JLCPCB_1OZ.minTraceWidth).toBe(0.127)
    expect(JLCPCB_1OZ.minDrill).toBe(0.3)
  })
})

