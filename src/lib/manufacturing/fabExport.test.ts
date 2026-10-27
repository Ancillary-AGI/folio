/**
 * Fab-grade export proofs (Giant 2).
 *
 * Every assertion parses the emitted file the way a CAM station would —
 * Gerber commands must balance and close, Excellon tools must be defined
 * before use, CSV columns must land in order — against a two-resistor
 * board plus one DIP-8 for the drill path. No hand-typed golden blobs.
 */
import { describe, expect, it } from 'vitest'
import type { PlacedComponent } from '../../types'
import { bomCsv, buildFabPackage, centroidCsv, DEFAULT_TRACE_WIDTH, excellonDrill, fabLayerFromId, JLCPCB_1OZ, type FabTrace } from './fabExport'

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

const trace = (
  points: Array<{ x: number; y: number }>,
  opts: { width?: number; netName?: string; layer?: FabTrace['layer']; layerName?: string } = {},
): FabTrace => ({
  points,
  width: opts.width ?? DEFAULT_TRACE_WIDTH,
  netName: opts.netName,
  layer: opts.layer ?? 'top',
  layerName: opts.layerName,
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
    buildFabPackage([resistor('R1', 10), resistor('R2', 30), dip8('U1', 50)], [trace([{ x: 10, y: 10 }, { x: 30, y: 10 }])], {
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

describe('fab package — copper is emitted on the layer it was routed on', () => {
  const drawn = (content: string): string[] => content.split('\n').filter((line) => /D0[12]\*$/.test(line))
  const flashes = (content: string): number => content.split('\n').filter((line) => line.includes('D03*')).length

  it('sends bottom-routed segments to B_Cu and keeps them out of F_Cu', () => {
    const pkg = buildFabPackage([resistor('R1', 10)], [
      trace([{ x: 1, y: 2 }, { x: 3, y: 2 }], { layer: 'top' }),
      trace([{ x: 4, y: 5 }, { x: 6, y: 5 }], { layer: 'bottom' }),
    ])
    const top = drawn(pkg.files.get('folio-pcb-F_Cu.gtl') ?? '')
    const bottom = drawn(pkg.files.get('folio-pcb-B_Cu.gbl') ?? '')
    expect(top.some((line) => line.startsWith('X1000000Y2000000'))).toBe(true)
    expect(top.some((line) => line.startsWith('X4000000Y5000000'))).toBe(false)
    expect(bottom.some((line) => line.startsWith('X4000000Y5000000'))).toBe(true)
    expect(bottom.some((line) => line.startsWith('X1000000Y2000000'))).toBe(false)
    expect(pkg.shippable).toBe(true)
  })

  it('refuses copper on a layer this package cannot represent', () => {
    const pkg = buildFabPackage([resistor('R1', 10)], [
      trace([{ x: 1, y: 2 }, { x: 3, y: 2 }], { layer: 'inner', layerName: 'in1-cu' }),
    ])
    expect(pkg.shippable).toBe(false)
    expect(pkg.violations.some((v) => v.rule === 'copper-layer' && v.message.includes('in1-cu'))).toBe(true)
  })

  it('puts a bottom-placed part on the bottom copper, mask, silk and centroid', () => {
    const pkg = buildFabPackage([resistor('R1', 10, { side: 'bottom' })], [])
    expect(pkg.centroid).toHaveLength(1)
    expect(pkg.centroid[0].side).toBe('Bottom')
    expect(flashes(pkg.files.get('folio-pcb-F_Cu.gtl') ?? '')).toBe(0)
    expect(flashes(pkg.files.get('folio-pcb-B_Cu.gbl') ?? '')).toBe(2)
    expect(flashes(pkg.files.get('folio-pcb-F_Mask.gts') ?? '')).toBe(0)
    expect(flashes(pkg.files.get('folio-pcb-B_Mask.gbs') ?? '')).toBe(2)
    expect(pkg.files.get('folio-pcb-B_Silk.gbo')).toContain('G04 R1*')
    expect(pkg.files.get('folio-pcb-F_Silk.gto')).not.toContain('G04 R1*')
  })

  it('keeps plated through-hole pads on both faces', () => {
    const pkg = buildFabPackage([dip8('U1', 50)], [])
    expect(flashes(pkg.files.get('folio-pcb-F_Cu.gtl') ?? '')).toBe(8)
    expect(flashes(pkg.files.get('folio-pcb-B_Cu.gbl') ?? '')).toBe(8)
  })

  it('maps board layer ids onto the copper faces they export to', () => {
    expect(fabLayerFromId('top-cu')).toEqual({ layer: 'top', name: 'top-cu' })
    expect(fabLayerFromId('F.Cu')).toEqual({ layer: 'top', name: 'F.Cu' })
    expect(fabLayerFromId('bot-cu')).toEqual({ layer: 'bottom', name: 'bot-cu' })
    expect(fabLayerFromId('B.Cu')).toEqual({ layer: 'bottom', name: 'B.Cu' })
    expect(fabLayerFromId('in2-cu')).toEqual({ layer: 'inner', name: 'in2-cu' })
  })
})

describe('fab package — DRC gates the order (fail-loud)', () => {
  it('blocks a trace below the fab minimum width', () => {
    const pkg = buildFabPackage([resistor('R1', 10)], [trace([{ x: 0, y: 0 }, { x: 10, y: 0 }], { width: 0.05 })])
    expect(pkg.shippable).toBe(false)
    expect(pkg.violations.some((v) => v.rule === 'trace-width')).toBe(true)
    expect(pkg.files.has('folio-pcb-F_Cu.gtl')).toBe(true)
  })

  it('blocks two traces violating spacing', () => {
    const pkg = buildFabPackage([resistor('R1', 10)], [
      trace([{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      trace([{ x: 0, y: 0.1 }, { x: 10, y: 0.1 }]),
    ])
    expect(pkg.shippable).toBe(false)
    expect(pkg.violations.some((v) => v.rule === 'trace-spacing')).toBe(true)
  })

  it('detects crossing traces whose vertices are far apart', () => {
    const pkg = buildFabPackage([resistor('R1', 10)], [
      trace([{ x: 0, y: 5 }, { x: 10, y: 5 }]),
      trace([{ x: 5, y: 0 }, { x: 5, y: 10 }]),
    ])
    expect(pkg.shippable).toBe(false)
    expect(pkg.violations.some((v) => v.rule === 'trace-spacing')).toBe(true)
  })

  it('does not flag copper of the same net for touching', () => {
    const pkg = buildFabPackage([resistor('R1', 10)], [
      trace([{ x: 0, y: 0 }, { x: 10, y: 0 }], { netName: 'VCC' }),
      trace([{ x: 0, y: 0.1 }, { x: 10, y: 0.1 }], { netName: 'VCC' }),
    ])
    expect(pkg.violations.filter((v) => v.rule === 'trace-spacing')).toEqual([])
  })

  it('does not flag copper on opposite faces for touching', () => {
    // 0.1 mm apart in plan view, but separated by the whole laminate: a legal
    // two-layer board must not be refused because top crosses bottom.
    const pkg = buildFabPackage([resistor('R1', 10)], [
      trace([{ x: 0, y: 0 }, { x: 10, y: 0 }], { layer: 'top' }),
      trace([{ x: 0, y: 0.1 }, { x: 10, y: 0.1 }], { layer: 'bottom' }),
    ])
    expect(pkg.violations.filter((v) => v.rule === 'trace-spacing')).toEqual([])
    expect(pkg.shippable).toBe(true)
  })

  it('keeps top-side SMD pads off the bottom copper and mask', () => {
    const pkg = buildFabPackage([resistor('R1', 10), dip8('U1', 50)], [])
    const flashes = (name: string): number =>
      (pkg.files.get(name) ?? '').split('\n').filter((line) => line.includes('D03*')).length
    expect(flashes('folio-pcb-F_Cu.gtl')).toBe(10) // 2 SMD pads + 8 through-hole
    expect(flashes('folio-pcb-B_Cu.gbl')).toBe(8)
    expect(flashes('folio-pcb-F_Mask.gts')).toBe(10)
    expect(flashes('folio-pcb-B_Mask.gbs')).toBe(8)
  })

  it('flashes routed vias through both copper layers and drills them', () => {
    const pkg = buildFabPackage([resistor('R1', 10)], [], {
      vias: [{ x: 20, y: 20, drillDiameter: 0.3, padDiameter: 0.6, netName: 'A' }],
    })
    const flashes = (name: string): number =>
      (pkg.files.get(name) ?? '').split('\n').filter((line) => line.includes('D03*')).length
    expect(flashes('folio-pcb-F_Cu.gtl')).toBe(3) // 2 SMD pads + the via
    expect(flashes('folio-pcb-B_Cu.gbl')).toBe(1) // SMD stays top-side
    expect(flashes('folio-pcb-F_Mask.gts')).toBe(2) // via is tented
    expect(flashes('folio-pcb-B_Mask.gbs')).toBe(0)
    const drill = pkg.files.get('folio-pcb.drl') ?? ''
    assertExcellon(drill)
    expect(drill).toContain('T1C0.300')
    expect(drill.split('\n').filter((line) => /^X[\d.]+Y[\d.]+$/.test(line))).toEqual(['X20.000Y20.000'])
    expect(pkg.shippable).toBe(true)
  })

  it('rejects vias below the fab annular ring or drill minimum', () => {
    const thinRing = buildFabPackage([resistor('R1', 10)], [], {
      vias: [{ x: 20, y: 20, drillDiameter: 0.3, padDiameter: 0.5 }],
    })
    expect(thinRing.shippable).toBe(false)
    expect(thinRing.violations.some((v) => v.rule === 'annular-ring')).toBe(true)

    const micro = buildFabPackage([resistor('R1', 10)], [], {
      vias: [{ x: 20, y: 20, drillDiameter: 0.2, padDiameter: 0.6 }],
    })
    expect(micro.shippable).toBe(false)
    expect(micro.violations.some((v) => v.rule === 'drill')).toBe(true)
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

