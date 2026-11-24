/**
 * The library's contract is that a row is placeable and its data is what the
 * domain's own solver reads. These tests hold every catalog to that: ids unique,
 * control rows valid polynomials, mechanical rows realizable solids, and every
 * code row accepted by the app's own HDL and firmware parsers.
 */
import { describe, expect, it } from 'vitest'
import type { Component } from '../supabase'
import {
  controlCatalog,
  gridCatalog,
  rfCatalog,
  robotCatalog,
  snippetCatalog,
  snippetSources,
} from './elementCatalogs'
import { electricalCatalog, libraryForMode, machineCatalog, mechanicalCatalog, modelCardCatalog, trussCatalog } from './catalog'
import { STANDARD_PARTS, buildStandardPartSolids, nextPlacementOrigin } from '../mechanical/standardParts'
import { buildRobotMechanism, robotArchitectureById } from '../robotics/robotLibrary'
import { parseVerilogModule } from '../fpga/verilogSubset'
import { parseVhdl } from '../fpga/vhdlSubset'
import { parseSpiceModelLibrary } from '../simulation/modelLibrary'
import { analyseSource } from '../compilation/compiler'
import { tfDcGain, validateTransferFunction } from '../control/transferFunction'
import {
  solvePowerFlow,
  solveRadialFeeder,
  type FeederNode,
  type FeederSection,
  type PowerBranch,
  type PowerBus,
} from '../power/loadFlow'

/** A part list entry with only what the dock reads. */
const componentFixture = (overrides: Partial<Component> = {}): Component => ({
  name: 'Resistor',
  category: 'passive',
  is_standard: true,
  symbol_data: { width: 80, height: 30, paths: ['M 0,15 L 80,15'] },
  pins: [],
  default_properties: { value: '10k' },
  ...overrides,
})

describe('domain catalogs', () => {
  const all: Array<[string, readonly { id: string; name: string; category: string }[]]> = [
    ['control', controlCatalog()],
    ['rf', rfCatalog()],
    ['grid', gridCatalog()],
    ['robot', robotCatalog()],
    ['snippet', snippetCatalog()],
    ['model-card', modelCardCatalog()],
    ['machine', machineCatalog()],
    ['mechanical', mechanicalCatalog()],
    ['truss', trussCatalog()],
    ['electrical', electricalCatalog([componentFixture({ id: 'r1' })])],
  ]

  it.each(all)('%s rows have unique ids and named categories', (_label, items) => {
    expect(items.length).toBeGreaterThan(0)
    const ids = items.map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of items) {
      expect(item.name.trim().length).toBeGreaterThan(1)
      expect(item.category.trim().length).toBeGreaterThan(1)
    }
  })

  it('control rows are polynomials the solver accepts', () => {
    for (const row of controlCatalog()) {
      const tf = validateTransferFunction({
        numerator: row.payload.numerator,
        denominator: row.payload.denominator,
      })
      expect(tf.denominator.length).toBeGreaterThan(0)
      expect(tf.numerator.length).toBeGreaterThan(0)
    }
    const gain = controlCatalog().find(row => row.id === 'tf-gain')!
    expect(tfDcGain({ numerator: gain.payload.numerator, denominator: gain.payload.denominator }))
      .toBeCloseTo(10, 12)
    const integrator = controlCatalog().find(row => row.id === 'tf-integrator')!
    expect(tfDcGain({ numerator: integrator.payload.numerator, denominator: integrator.payload.denominator }))
      .toBe(Infinity)
  })

  it('grid rows carry the fields the load-flow solver reads', () => {
    const buses = gridCatalog().filter(row => row.payload.role === 'bus')
    expect(buses.map(row => row.payload.bus?.type)).toContain('slack')
    const branch = gridCatalog().find(row => row.id === 'grid-xfmr-132-33')!
    expect(branch.payload.branch?.seriesImpedancePu?.reactance).toBeCloseTo(0.125, 12)
    // `tapRatio` is the per-unit off-nominal tap, not the kV ratio: each bus
    // carries its own base kV, so the winding ratio is already in the per-unit
    // system. A row that put 132/33 here would collapse the far bus to 0.25 pu.
    expect(branch.payload.branch?.tapRatio).toBeCloseTo(1, 12)
    const tapped = gridCatalog().find(row => row.id === 'grid-xfmr-33-11')!
    expect(tapped.payload.branch?.tapRatio).toBeCloseTo(0.95, 12)
    const pv = gridCatalog().find(row => row.id === 'grid-feeder-pv5')!
    expect(pv.payload.feederNode?.generationKw).toBe(5)
    expect(pv.payload.section?.reactanceOhm).toBeGreaterThan(0)
  })

  it('every grid branch names buses that exist in the catalog', () => {
    const busIds = new Set(gridCatalog().map(row => row.payload.bus?.id).filter(Boolean))
    for (const row of gridCatalog().filter(item => item.payload.role === 'branch')) {
      expect(busIds.has(row.payload.branch?.from), `${row.id} from`).toBe(true)
      expect(busIds.has(row.payload.branch?.to), `${row.id} to`).toBe(true)
    }
  })

  it('the grid rows assemble into a case the load-flow solver solves', () => {
    const rows = gridCatalog()
    const buses = rows.filter(row => row.payload.role === 'bus').map(row => row.payload.bus) as PowerBus[]
    const branches = rows
      .filter(row => row.payload.role === 'branch')
      .map((row, index) => ({ id: `row-${index}`, ...row.payload.branch })) as PowerBranch[]
    expect(buses).toHaveLength(4)
    const result = solvePowerFlow({ baseMva: 100, buses, branches })
    expect(result.converged, 'the dropped case must solve, not just load').toBe(true)
    expect(result.notes, 'a freshly dropped case has nothing to report').toEqual([])
    expect(result.buses.map(bus => bus.id)).toEqual(['slack-132', 'gen-33', 'load-11', 'cap-11'])
    for (const bus of result.buses) {
      expect(bus.voltagePu, `${bus.id} stays on its own base`).toBeGreaterThan(0.9)
      expect(bus.voltagePu).toBeLessThan(1.1)
    }
    // The 20 MW machine serves the 5 MW load and pushes the rest up the tie.
    expect(result.totalLoadMw).toBeCloseTo(5, 6)
    expect(result.totalLossMw).toBeGreaterThan(0)
  })

  it('the feeder rows assemble into a radial feeder the solver solves', () => {
    const rows = gridCatalog().filter(row => row.payload.role === 'feeder-node')
    const nodes = rows.map(row => row.payload.feederNode) as FeederNode[]
    const sections = rows.map((row, index) => ({
      id: `S${index + 1}`,
      from: index === 0 ? 'Substation' : (rows[index - 1].payload.feederNode?.id as string),
      to: row.payload.feederNode?.id as string,
      resistanceOhm: row.payload.section?.resistanceOhm ?? 0,
      reactanceOhm: row.payload.section?.reactanceOhm ?? 0,
    })) as FeederSection[]
    const result = solveRadialFeeder({
      sourceKv: 11,
      sourceId: 'Substation',
      nodes: [{ id: 'Substation' }, ...nodes],
      sections,
    })
    expect(result.converged).toBe(true)
    expect(result.nodes.map(node => node.id)).toEqual(['Substation', 'dp-100', 'dp-25', 'pv-5'])
    expect(result.minVoltagePu, 'a 120 kW spur on 11 kV stays inside the planning band')
      .toBeGreaterThan(0.94)
    // The PV row injects at the far end, so the tail of the feeder lifts.
    expect(result.nodes[3].voltagePu, 'end-of-feeder generation raises the tail voltage')
      .toBeGreaterThan(result.nodes[2].voltagePu)
  })

  it('mechanical rows build solids with real dimensions', () => {
    const items = mechanicalCatalog()
    expect(items.length).toBe(STANDARD_PARTS.length)
    for (const part of STANDARD_PARTS) {
      const built = buildStandardPartSolids(part, {
        idFor: suffix => `${part.id}-${suffix}`,
        origin: nextPlacementOrigin([]),
      })
      expect(built.length).toBe(part.solids.length)
      for (const solid of built) {
        expect(solid.dimensions.length).toBeGreaterThan(0)
        expect(solid.dimensions.width).toBeGreaterThan(0)
        expect(solid.dimensions.height).toBeGreaterThan(0)
        expect(solid.properties.mass).toBeGreaterThan(0)
      }
    }
  })

  it('every code snippet parses with the app\'s own elaborator', () => {
    for (const snippet of snippetSources()) {
      if (snippet.language === 'verilog') {
        expect(parseVerilogModule(snippet.text).netlist.gates.length, snippet.id).toBeGreaterThan(0)
      } else if (snippet.language === 'vhdl') {
        expect(parseVhdl(snippet.text).netlist.gates.length, snippet.id).toBeGreaterThan(0)
      } else {
        const analysis = analyseSource(snippet.text, { requireSetupAndLoop: true })
        expect(analysis.errors.map(error => error.message), snippet.id).toEqual([])
      }
    }
  })

  it('every model card is one the deck parser reads and the solver types', () => {
    const rows = modelCardCatalog()
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const deck = parseSpiceModelLibrary(row.payload.spiceText)
      expect(deck.errors, row.id).toEqual([])
      const card = [...deck.models.values()]
      expect(card, `${row.id} must yield exactly one card`).toHaveLength(1)
      expect(card[0].type, row.id).toBe(row.payload.modelType)
      expect(Object.keys(card[0].parameters).length, `${row.id} carries parameters`).toBeGreaterThan(0)
    }
    /*
     * The catalog is filtered by whether the deck can hold the line, so a row
     * cannot be a subcircuit. If a vendor entry ever stops being a `.model`, its
     * part number disappears here rather than landing as a refused drop.
     */
    for (const row of rows) {
      expect(row.payload.spiceText, row.id).toMatch(/^\.model\s/)
      expect(row.payload.device, row.id).toBe(row.name)
    }
    expect(rows.some(row => row.name === '2N3904')).toBe(true)
    expect(rows.some(row => row.category === 'Op-amps')).toBe(false)
  })

  it('the dock knows which kinds each workspace places', () => {
    expect(libraryForMode('mechanical', [])?.accepts).toEqual(['solid'])
    expect(libraryForMode('machines', [])?.accepts).toEqual(['machine'])
    expect(libraryForMode('control', [])?.accepts).toEqual(['tf-block'])
    expect(libraryForMode('rf', [])?.accepts).toEqual(['rf-element'])
    expect(libraryForMode('grid', [])?.accepts).toEqual(['grid-element'])
    expect(libraryForMode('robotics', [])?.accepts).toEqual(['robot-element'])
    expect(libraryForMode('hdl', [])?.accepts).toEqual(['snippet'])
    expect(libraryForMode('embedded', [])?.accepts).toEqual(['snippet'])
    expect(libraryForMode('simulation', [])?.accepts).toEqual(['model-card'])
    expect(libraryForMode('fpga', [])?.accepts).toEqual(['snippet'])
    expect(libraryForMode('schematic', [componentFixture({ id: 'r1' })])?.accepts).toEqual(['component'])
    expect(libraryForMode('dashboard', [])).toBeNull()
  })

  it('the hdl and firmware docks split the same snippet source', () => {
    const hdl = libraryForMode('hdl', [])!.items.map(item => item.id)
    const firmware = libraryForMode('embedded', [])!.items.map(item => item.id)
    expect(hdl.some(id => firmware.includes(id))).toBe(false)
    expect([...hdl, ...firmware].sort()).toEqual(snippetCatalog().map(item => item.id).sort())
  })

  it('the FPGA dock offers what the FPGA flow can elaborate', () => {
    /*
     * The FPGA panel synthesises the same Verilog subset and VHDL subset as the
     * HDL editor, so its dock is the editor's HDL half — no more, since a C
     * row dropped into the source box could never reach a manifest.
     */
    expect(libraryForMode('fpga', [])!.items.map(item => item.id))
      .toEqual(libraryForMode('hdl', [])!.items.map(item => item.id))
    for (const row of libraryForMode('fpga', [])!.items) {
      expect(row.kind, row.id).toBe('snippet')
      if (row.kind !== 'snippet') continue
      const gates =
        row.payload.language === 'verilog'
          ? parseVerilogModule(row.payload.text).netlist.gates.length
          : parseVhdl(row.payload.text).netlist.gates.length
      expect(gates, row.id).toBeGreaterThan(0)
    }
  })

  it('an electrical row without a project id cannot be dragged', () => {
    expect(electricalCatalog([componentFixture()])[0].payload.componentId).toBe('')
  })

  it('robot rows name architectures the kinematics engine builds', () => {
    for (const row of robotCatalog()) {
      expect(() => buildRobotMechanism(robotArchitectureById(row.payload.architecture)), row.id).not.toThrow()
    }
  })
})
