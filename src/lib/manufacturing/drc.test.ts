import { describe, expect, it } from 'vitest'
import type { Net, PlacedComponent } from '../../types'
import { DEFAULT_DRC_RULES, DesignRuleChecker, type DRCSettings } from './drc'
import type { PCBPad, PCBDesign, PCBTrace, PCBVIA } from './pcb'

function placed(
  id: string,
  x: number,
  y: number,
  options: { width?: number; height?: number; rotation?: number; scale?: number } = {},
): PlacedComponent {
  return {
    id,
    componentId: `lib-${id}`,
    component: {
      id: `lib-${id}`,
      name: 'Test part',
      category: 'test',
      symbol: { width: options.width ?? 10, height: options.height ?? 10, paths: [] },
      pins: [],
      properties: {},
    },
    position: { x, y },
    rotation: options.rotation ?? 0,
    scale: options.scale ?? 1,
    reference: id,
    properties: {},
  }
}

function trace(id: string, netId: string, points: PCBTrace['points'], layerId = 'top', width = 0.5): PCBTrace {
  return { id, netId, layerId, width, points, clearance: 0.2 }
}

function via(id: string, netId: string | undefined, position: PCBVIA['position'], diameter = 0.6, drillDiameter = 0.3, layers = ['top', 'bottom']): PCBVIA {
  return { id, netId, position, diameter, drillDiameter, layers }
}

function pad(id: string, netId: string | undefined, position: PCBPad['position'], size: { width: number; height: number }, shape: PCBPad['shape'] = 'rectangle', drillDiameter?: number): PCBPad {
  return { id, componentId: 'c1', pinId: id, position, shape, size, drillDiameter, layers: ['top', 'bottom'], netId }
}

function net(id: string, name: string): Net {
  return { id, name, connectedPins: [], wires: [] }
}

function makeDesign(overrides: Partial<PCBDesign> = {}): PCBDesign {
  return {
    id: 'test-design',
    name: 'Test board',
    dimensions: { width: 100, height: 100, thickness: 1.6 },
    layers: [
      { id: 'top', name: 'Top Copper', type: 'copper', thickness: 0.035, material: 'copper' },
      { id: 'bottom', name: 'Bottom Copper', type: 'copper', thickness: 0.035, material: 'copper' },
    ],
    traces: [],
    vias: [],
    pads: [],
    components: [],
    nets: [],
    designRules: {
      minTraceWidth: 0.2,
      minTraceSpacing: 0.2,
      minViaDiameter: 0.4,
      minViaDrillDiameter: 0.2,
      minPadDiameter: 0.5,
      minHoleDiameter: 0.3,
      copperThickness: 0.035,
      solderMaskClearance: 0.1,
      silkScreenClearance: 0.15,
    },
    ...overrides,
  }
}

const quiet: Partial<DRCSettings> = {
  checkUnconnectedNets: false,
  checkAcuteAngles: false,
}

describe('DesignRuleChecker trace rules', () => {
  it('flags trace widths below the minimum and above the maximum', () => {
    const design = makeDesign({
      traces: [
        trace('thin', 'A', [{ x: 0, y: 0 }, { x: 5, y: 0 }], 'top', 0.15),
        trace('fat', 'B', [{ x: 0, y: 5 }, { x: 5, y: 5 }], 'top', 3),
      ],
    })
    const result = new DesignRuleChecker(design, quiet).runDRC()

    expect(result.violations.map(v => v.elementId)).toEqual(expect.arrayContaining(['thin', 'fat']))
    expect(result.isValid).toBe(false)
    expect(result.violations.find(v => v.elementId === 'thin')?.message).toContain('below minimum')
    expect(result.violations.find(v => v.elementId === 'fat')?.message).toContain('exceeds maximum')
    expect(result.summary.errors).toBe(1)
    expect(result.summary.warnings).toBe(1)
  })

  it('detects a crossing between different nets on the same layer', () => {
    const design = makeDesign({
      traces: [
        trace('a', 'A', [{ x: 0, y: 5 }, { x: 10, y: 5 }]),
        trace('b', 'B', [{ x: 5, y: 0 }, { x: 5, y: 10 }]),
      ],
    })
    const result = new DesignRuleChecker(design, quiet).runDRC()

    expect(result.violations.some(v => v.type === 'clearance')).toBe(true)
    expect(result.violations.find(v => v.type === 'clearance')?.message).toContain('Trace clearance 0.000mm')
  })

  it('ignores crossings on different layers and same-net contact', () => {
    const design = makeDesign({
      traces: [
        trace('top', 'A', [{ x: 0, y: 5 }, { x: 10, y: 5 }], 'top'),
        trace('bottom', 'B', [{ x: 5, y: 0 }, { x: 5, y: 10 }], 'bottom'),
        trace('same-top', 'A', [{ x: 5, y: 0 }, { x: 5, y: 10 }], 'top'),
      ],
    })
    const result = new DesignRuleChecker(design, quiet).runDRC()

    expect(result.violations.filter(v => v.type === 'clearance')).toEqual([])
  })

  it('checks the exact gap between parallel traces', () => {
    const design = makeDesign({
      traces: [
        trace('a', 'A', [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
        trace('b', 'B', [{ x: 0, y: 0.5 }, { x: 10, y: 0.5 }]),
      ],
    })
    const result = new DesignRuleChecker(design, quiet).runDRC()

    const clearance = result.violations.find(v => v.type === 'clearance')
    expect(clearance?.value).toBeCloseTo(0)
    expect(clearance?.required).toBe(0.2)
  })
})

describe('DesignRuleChecker via and pad rules', () => {
  it('flags undersized via drill and annular ring', () => {
    const design = makeDesign({ vias: [via('v1', 'A', { x: 5, y: 5 }, 0.3, 0.2)] })
    const result = new DesignRuleChecker(design, quiet).runDRC()

    expect(result.violations.filter(v => v.elementId === 'v1').map(v => v.type)).toEqual(
      expect.arrayContaining(['drill', 'annular_ring']),
    )
    expect(result.violations.find(v => v.type === 'annular_ring')?.value).toBeCloseTo(0.05)
  })

  it('accepts a via that meets every minimum', () => {
    const design = makeDesign({ vias: [via('v1', 'A', { x: 5, y: 5 }, 0.6, 0.3)] })
    expect(new DesignRuleChecker(design, quiet).runDRC().isValid).toBe(true)
  })

  it('checks via-to-trace copper clearance', () => {
    const design = makeDesign({
      vias: [via('v1', 'A', { x: 5, y: 5 }, 0.6, 0.3)],
      traces: [trace('t1', 'B', [{ x: 5.45, y: 0 }, { x: 5.45, y: 10 }], 'top', 0.2)],
    })
    const result = new DesignRuleChecker(design, quiet).runDRC()

    const violation = result.violations.find(v => v.type === 'clearance')
    expect(violation?.elementId).toBe('v1')
    expect(violation?.value).toBeCloseTo(0.05)
  })

  it('checks via-to-via clearance across shared layers', () => {
    const design = makeDesign({
      vias: [via('v1', 'A', { x: 5, y: 5 }), via('v2', 'B', { x: 5.5, y: 5 })],
    })
    expect(new DesignRuleChecker(design, quiet).runDRC().violations.some(v => v.type === 'clearance')).toBe(true)
  })

  it('skips via clearance when the layers do not overlap', () => {
    const design = makeDesign({
      vias: [
        via('v1', 'A', { x: 5, y: 5 }, 0.6, 0.3, ['top']),
        via('v2', 'B', { x: 5.5, y: 5 }, 0.6, 0.3, ['bottom']),
      ],
    })
    expect(new DesignRuleChecker(design, quiet).runDRC().violations).toEqual([])
  })

  it('flags pad size, hole size, and annular ring', () => {
    const design = makeDesign({
      pads: [pad('p1', 'A', { x: 5, y: 5 }, { width: 0.4, height: 0.4 }, 'circle', 0.25)],
    })
    const result = new DesignRuleChecker(design, quiet).runDRC()
    const types = result.violations.filter(v => v.elementId === 'p1').map(v => v.type)

    expect(types).toEqual(expect.arrayContaining(['width', 'drill', 'annular_ring']))
  })

  it('measures circular pad clearance from the copper edge', () => {
    const design = makeDesign({
      pads: [pad('p1', 'A', { x: 5, y: 5 }, { width: 2, height: 2 }, 'circle')],
      traces: [trace('t1', 'B', [{ x: 6.25, y: 0 }, { x: 6.25, y: 10 }], 'top', 0.5)],
    })
    const violation = new DesignRuleChecker(design, quiet).runDRC().violations.find(v => v.type === 'clearance')

    expect(violation?.value).toBeCloseTo(0)
  })

  it('measures rectangular pad clearance at the exact box edge', () => {
    const design = makeDesign({
      pads: [pad('p1', 'A', { x: 5, y: 5 }, { width: 2, height: 2 }, 'rectangle')],
      traces: [trace('t1', 'B', [{ x: 6.25, y: 0 }, { x: 6.25, y: 10 }], 'top', 0.5)],
    })
    const violation = new DesignRuleChecker(design, quiet).runDRC().violations.find(v => v.type === 'clearance')

    expect(violation?.value).toBeCloseTo(0)
  })

  it('ignores pads connected to the same net as the trace', () => {
    const design = makeDesign({
      pads: [pad('p1', 'A', { x: 5, y: 5 }, { width: 2, height: 2 })],
      traces: [trace('t1', 'A', [{ x: 6.25, y: 0 }, { x: 6.25, y: 10 }], 'top', 0.5)],
    })
    expect(new DesignRuleChecker(design, quiet).runDRC().violations).toEqual([])
  })

  it('checks copper clearance between pads of different footprints', () => {
    const design = makeDesign({
      pads: [
        pad('p1', 'A', { x: 5, y: 5 }, { width: 2, height: 2 }),
        { ...pad('p2', 'B', { x: 7.1, y: 5 }, { width: 2, height: 2 }), componentId: 'c2' },
      ],
    })
    const violation = new DesignRuleChecker(design, quiet).runDRC()
      .violations.find(v => v.type === 'clearance')

    expect(violation?.elementId).toBe('p1')
    expect(violation?.value).toBeCloseTo(0.1)
  })

  it('uses the corner distance between diagonally separated pad boxes', () => {
    const design = makeDesign({
      pads: [
        pad('p1', 'A', { x: 5, y: 5 }, { width: 2, height: 2 }),
        { ...pad('p2', 'B', { x: 7.1, y: 7.1 }, { width: 2, height: 2 }), componentId: 'c2' },
      ],
    })
    const violation = new DesignRuleChecker(design, quiet).runDRC()
      .violations.find(v => v.type === 'clearance')

    // Both axes clear by 0.1 mm, so the nearest copper is at the corner.
    expect(violation?.value).toBeCloseTo(Math.hypot(0.1, 0.1))
  })

  it('exempts pads inside one footprint and pads sharing a net', () => {
    const sameFootprint = makeDesign({
      pads: [
        pad('p1', 'A', { x: 5, y: 5 }, { width: 2, height: 2 }),
        pad('p2', 'B', { x: 5.1, y: 5 }, { width: 2, height: 2 }),
      ],
    })
    const sameNet = makeDesign({
      pads: [
        pad('p1', 'A', { x: 5, y: 5 }, { width: 2, height: 2 }),
        { ...pad('p2', 'A', { x: 5.1, y: 5 }, { width: 2, height: 2 }), componentId: 'c2' },
      ],
    })

    expect(new DesignRuleChecker(sameFootprint, quiet).runDRC().violations).toEqual([])
    expect(new DesignRuleChecker(sameNet, quiet).runDRC().violations).toEqual([])
  })

  it('checks pad-to-via clearance and skips pads on the via net', () => {
    const design = makeDesign({
      pads: [pad('p1', 'A', { x: 5, y: 5 }, { width: 2, height: 2 }, 'circle')],
      vias: [via('v1', 'B', { x: 6.35, y: 5 }, 0.6, 0.3)],
    })
    const violation = new DesignRuleChecker(design, quiet).runDRC()
      .violations.find(v => v.type === 'clearance')

    expect(violation?.elementId).toBe('p1')
    expect(violation?.value).toBeCloseTo(0.05)

    const sameNet = makeDesign({
      pads: [pad('p1', 'A', { x: 5, y: 5 }, { width: 2, height: 2 }, 'circle')],
      vias: [via('v1', 'A', { x: 6.35, y: 5 }, 0.6, 0.3)],
    })
    expect(new DesignRuleChecker(sameNet, quiet).runDRC().violations).toEqual([])
  })
})

describe('DesignRuleChecker connectivity', () => {
  it('flags pads stranded on a different copper island', () => {
    const design = makeDesign({
      nets: [net('A', 'SIG_A')],
      pads: [
        pad('p1', 'A', { x: 0, y: 0 }, { width: 1, height: 1 }),
        pad('p2', 'A', { x: 10, y: 0 }, { width: 1, height: 1 }),
      ],
      traces: [trace('t1', 'A', [{ x: 0, y: 0 }, { x: 0, y: -5 }])],
    })
    const messages = new DesignRuleChecker(design).runDRC()
      .violations.filter(v => v.type === 'unconnected_net').map(v => v.message)

    expect(messages).toEqual([
      'Net "SIG_A" is split across 2 disconnected copper groups (1 pad(s) stranded)',
    ])
  })

  it('accepts a net whose trace touches every pad', () => {
    const design = makeDesign({
      nets: [net('A', 'SIG_A')],
      pads: [
        pad('p1', 'A', { x: 0, y: 0 }, { width: 1, height: 1 }),
        pad('p2', 'A', { x: 10, y: 0 }, { width: 1, height: 1 }),
      ],
      traces: [trace('t1', 'A', [{ x: 0, y: 0 }, { x: 10, y: 0 }])],
    })
    expect(new DesignRuleChecker(design).runDRC().violations).toEqual([])
  })

  it('connects pads through a via on a shared layer', () => {
    const design = makeDesign({
      nets: [net('A', 'SIG_A')],
      pads: [
        { ...pad('p1', 'A', { x: 0, y: 0 }, { width: 1, height: 1 }), layers: ['top'] },
        { ...pad('p2', 'A', { x: 10, y: 0 }, { width: 1, height: 1 }), layers: ['bottom'] },
      ],
      traces: [
        { ...trace('t1', 'A', [{ x: 0, y: 0 }, { x: 5, y: 0 }]), layerId: 'top' },
        { ...trace('t2', 'A', [{ x: 5, y: 0 }, { x: 10, y: 0 }]), layerId: 'bottom' },
      ],
      vias: [via('v1', 'A', { x: 5, y: 0 }, 0.6, 0.3, ['top', 'bottom'])],
    })
    expect(new DesignRuleChecker(design).runDRC().violations).toEqual([])
  })
})

describe('DesignRuleChecker placement and routing rules', () => {
  it('reports overlapping courtyards as warnings', () => {
    const design = makeDesign({
      components: [placed('U1', 0, 0), placed('U2', 9, 0)],
    })
    const result = new DesignRuleChecker(design, quiet).runDRC()

    expect(result.isValid).toBe(true)
    expect(result.violations[0]).toMatchObject({
      type: 'courtyard_overlap',
      severity: 'warning',
      value: -1,
    })
    expect(result.violations[0].message).toContain('"U1" and "U2"')
  })

  it('swaps courtyard axes for a quarter turn', () => {
    const design = makeDesign({
      components: [
        placed('U1', 0, 0, { width: 20, height: 4, rotation: 90 }),
        placed('U2', 15, 0, { width: 20, height: 4 }),
      ],
    })
    const result = new DesignRuleChecker(design, quiet).runDRC()

    expect(result.violations).toEqual([])
  })

  it('distinguishes unrouted pads from nets with no copper at all', () => {
    const design = makeDesign({
      nets: [net('A', 'SIG_A'), net('B', 'SIG_B')],
      pads: [pad('p1', 'A', { x: 5, y: 5 }, { width: 1.5, height: 1.5 })],
    })
    const result = new DesignRuleChecker(design).runDRC()
    const messages = result.violations.filter(v => v.type === 'unconnected_net').map(v => v.message)

    expect(messages).toContain('Net "SIG_A" has 1 pad(s) but no routed copper')
    expect(messages).toContain('Net "SIG_B" is not connected to any pads, traces, or vias')
  })

  it('does not flag a net once any copper exists', () => {
    const design = makeDesign({
      nets: [net('A', 'SIG_A')],
      traces: [trace('t1', 'A', [{ x: 0, y: 0 }, { x: 5, y: 0 }])],
    })
    expect(new DesignRuleChecker(design).runDRC().violations).toEqual([])
  })

  it('flags acute routing angles but accepts gentle bends', () => {
    const acute = makeDesign({
      traces: [trace('t1', 'A', [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 4, y: 1 }])],
    })
    const gentle = makeDesign({
      traces: [trace('t1', 'A', [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 1 }])],
    })

    const acuteResult = new DesignRuleChecker(acute).runDRC()
    expect(acuteResult.violations.filter(v => v.type === 'acute_angle')).toHaveLength(1)
    expect(new DesignRuleChecker(gentle).runDRC().violations).toEqual([])
  })

  it('optionally enforces a maximum trace length', () => {
    const design = makeDesign({
      traces: [trace('t1', 'A', [{ x: 0, y: 0 }, { x: 30, y: 0 }])],
    })

    expect(new DesignRuleChecker(design).runDRC().violations.some(v => v.type === 'trace_length')).toBe(false)
    const result = new DesignRuleChecker(design, { checkTraceLength: true, maxTraceLength: 10 }).runDRC()
    expect(result.violations.find(v => v.type === 'trace_length')?.value).toBeCloseTo(30)
  })
})

describe('DesignRuleChecker configuration', () => {
  it('merges overrides over the documented defaults', () => {
    const checker = new DesignRuleChecker(makeDesign(), { minTraceWidth: 0.15 })

    expect(checker.getRules().minTraceWidth).toBe(0.15)
    expect(checker.getRules().minTraceClearance).toBe(DEFAULT_DRC_RULES.minTraceClearance)
  })

  it('applies rules updated after construction', () => {
    const design = makeDesign({
      traces: [trace('t1', 'A', [{ x: 0, y: 0 }, { x: 5, y: 0 }], 'top', 0.15)],
    })
    const checker = new DesignRuleChecker(design, quiet)
    expect(checker.runDRC().isValid).toBe(false)

    checker.updateRules({ minTraceWidth: 0.1 })
    expect(checker.runDRC().isValid).toBe(true)
  })

  it('reports totals consistently', () => {
    const design = makeDesign({
      traces: [
        trace('thin', 'A', [{ x: 0, y: 0 }, { x: 5, y: 0 }], 'top', 0.1),
        trace('cross', 'B', [{ x: 2, y: -2 }, { x: 2, y: 2 }], 'top', 0.5),
      ],
      vias: [via('v1', 'C', { x: 8, y: 8 }, 0.3, 0.2)],
    })
    const result = new DesignRuleChecker(design, quiet).runDRC()

    expect(result.summary.totalViolations).toBe(result.violations.length)
    expect(result.summary.errors + result.summary.warnings).toBe(result.summary.totalViolations)
  })
})
