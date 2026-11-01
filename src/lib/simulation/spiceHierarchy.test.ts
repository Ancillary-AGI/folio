/**
 * Hierarchy import: `.subckt`/`.ends`, `X` instances, `.param`, `.func`.
 *
 * These are the decks a datasheet ships, so the tests run the flattening end to
 * end — nets, designators, model cards and the solved operating point — instead
 * of only checking that the parser did not throw.
 */
import { describe, expect, it } from 'vitest'
import { buildCircuitModel } from './circuitModel'
import { runCircuitAnalysis } from './analysisRunner'
import { parseSpiceDeck } from './spiceImport'
import { VENDOR_OPAMP_SUBCIRCUITS, VENDOR_VREG_SUBCIRCUITS } from './vendorModels'
import { parseSpiceValue } from './devices'

function importDeck(deck: string) {
  const imported = parseSpiceDeck(deck)
  expect(imported.errors).toEqual([])
  return imported
}

function solve(deck: string) {
  const imported = importDeck(deck)
  const built = buildCircuitModel(imported.netlist)
  expect(built.errors).toEqual([])
  const outcome = runCircuitAnalysis(built.model, imported.netlist.analyses[0])
  expect(outcome.converged).toBe(true)
  return { imported, outcome }
}

const nodeVoltage = (outcome: ReturnType<typeof solve>['outcome'], name: string): number | undefined =>
  outcome.nodes.find((node) => node.name.toUpperCase() === name.toUpperCase())?.voltage

const value = (parameter: string | number | boolean | undefined): number =>
  parseSpiceValue(parameter, 'flattened value')

describe('SPICE subcircuit flattening', () => {
  it('expands an X instance into the parts and nets it stands for', () => {
    const deck = `* divider cell
.subckt div a b
Rtop a m 1k
Rbot m b 2k
.ends
Vin in 0 3
X1 in 0 div
.op
.end
`
    const { imported, outcome } = solve(deck)
    expect(imported.netlist.components.map((component) => component.name)).toEqual(['Vin', 'X1:Rtop', 'X1:Rbot'])
    expect(imported.netlist.components.find((component) => component.name === 'X1:Rtop')?.nodes).toEqual([
      'in',
      'X1:m',
    ])
    // A port takes the caller's net; only the cell's own net grows a path prefix.
    expect(imported.netlist.components.find((component) => component.name === 'X1:Rbot')?.nodes).toEqual(['X1:m', '0'])
    expect(value(imported.netlist.components[1]?.parameters.value)).toBe(1000)
    expect(nodeVoltage(outcome, 'in')).toBeCloseTo(3, 6)
  })

  it('keeps one instance boundary between two copies of one subcircuit', () => {
    const imported = importDeck(`* two cells, one internal net name
.subckt attenuate in out
Rin in node 1k
Rout node out 1k
.ends
X1 a b attenuate
X2 b c attenuate
V1 a 0 1
.op
.end
`)
    const nets = new Set(imported.netlist.components.flatMap((component) => component.nodes))
    expect(nets.has('X1:node')).toBe(true)
    expect(nets.has('X2:node')).toBe(true)
    expect(nets.has('node')).toBe(false)
    // The cells chain: the shared net `b` is a caller net, not a private one.
    expect(imported.netlist.components.find((component) => component.name === 'X1:Rout')?.nodes).toEqual(['X1:node', 'b'])
    expect(imported.netlist.components.find((component) => component.name === 'X2:Rin')?.nodes).toEqual(['b', 'X2:node'])
  })

  it('gives each instance its own nets but one shared local model card', () => {
    const { imported, outcome } = solve(`* local card, two instances
.subckt stack a b
D1 a m DCLAMP
D2 m b DCLAMP
.model DCLAMP D (IS=1e-15 N=1)
.ends
V1 in 0 6
R1 in mid 1k
R2 mid 0 1k
R3 in tap 1k
X1 mid 0 stack
X2 tap 0 stack
.op
.end
`)
    expect(Object.keys(imported.netlist.models ?? {})).toEqual(['STACK:DCLAMP'])
    const diodes = imported.netlist.components.filter((component) => component.type === 'diode')
    expect(diodes).toHaveLength(4)
    // The card keeps the deck's spelling; the solver matches it case-insensitively.
    expect(diodes.map((diode) => String(diode.parameters.model).toUpperCase())).toEqual([
      'STACK:DCLAMP',
      'STACK:DCLAMP',
      'STACK:DCLAMP',
      'STACK:DCLAMP',
    ])
    expect(new Set(diodes.flatMap((diode) => diode.nodes).filter((net) => net.includes(':')))).toEqual(
      new Set(['X1:m', 'X2:m']),
    )
    const volt = (name: string): number => nodeVoltage(outcome, name) ?? Number.NaN
    const mid = volt('mid')
    const tap = volt('tap')
    // Two identical series diodes share one current, so each private midpoint
    // sits at exactly half its own instance's drop.
    expect(volt('X1:m')).toBeCloseTo(mid / 2, 6)
    expect(volt('X2:m')).toBeCloseTo(tap / 2, 6)
    // Both stacks clamp their tap below the 3 V an unloaded divider would give,
    // and the stack that also feeds R2 sits lower.
    expect(mid).toBeLessThan(3)
    expect(tap).toBeLessThan(3)
    expect(tap).toBeGreaterThan(mid)
  })

  it('keeps a ground-named body net ground while a port takes the caller alias', () => {
    const imported = importDeck(`* ground through a port
.subckt ref in gnd
Rin in gnd 1k
Rg 0 gnd 2k
.ends
V1 a 0 3
X1 a GND ref
.op
.end
`)
    expect(imported.netlist.components.find((component) => component.name === 'X1:Rin')?.nodes).toEqual(['a', 'GND'])
    expect(imported.netlist.components.find((component) => component.name === 'X1:Rg')?.nodes).toEqual(['0', 'GND'])
  })

  it('flattens a subcircuit nested inside another', () => {
    const imported = importDeck(`* nested definitions
.subckt inner a b
Rinner a b 3k
.ends
.subckt outer a b
Xi a mid inner
Router mid b 1k
.ends
V1 n 0 4
X1 n 0 outer
.op
.end
`)
    expect(imported.netlist.components.map((component) => component.name)).toEqual(['V1', 'X1:Xi:Rinner', 'X1:Router'])
    expect(imported.netlist.components.find((component) => component.name === 'X1:Xi:Rinner')?.nodes).toEqual([
      'n',
      'X1:mid',
    ])
  })

  it('renames the references inside mutual coupling, switches and B sources', () => {
    const imported = importDeck(`* cross-references in a body
.subckt coupled a b
La a m 1m
Lb m b 2m
K1 La Lb 0.5
S1 a b c d VT=1 VH=0.1 RON=1 ROFF=1M
Vc c 0 2
B1 b 0 V=V(a)+V(c)
.ends
X1 p q coupled
.op
.end
`)
    const mutual = imported.netlist.components.find((component) => component.type === 'mutual')
    expect(mutual?.parameters.l1).toBe('X1:La')
    expect(mutual?.parameters.l2).toBe('X1:Lb')
    expect(imported.netlist.components.find((component) => component.type === 'voltage_switch')?.nodes).toEqual([
      'p',
      'q',
      'X1:c',
      'X1:d',
    ])
    expect(imported.netlist.components.find((component) => component.name === 'X1:Vc')?.nodes).toEqual(['X1:c', '0'])
    // A probe hides inside an expression string, so flattening has to reach it.
    expect(imported.netlist.components.find((component) => component.type === 'behavioral_source')?.parameters.v).toBe(
      'V(p)+V(X1:c)',
    )
    expect(imported.netlist.components.filter((component) => component.type === 'inductor').map((c) => c.name)).toEqual([
      'X1:La',
      'X1:Lb',
    ])
  })

  it('reports what went wrong inside an instance with the instance name', () => {
    const imported = parseSpiceDeck(`* bad card in a cell
.subckt broken a b
R1 a b
.ends
X1 n 0 broken
V1 n 0 1
.op
.end
`)
    expect(imported.errors.join(' ')).toMatch(/Line 3: X1: R1: expected a R card/)
  })
})

describe('SPICE parameter expressions', () => {
  it('evaluates a global .param in an element value', () => {
    const imported = importDeck(`* gain set once
.param ratio=4
.param rtop={1k*ratio}
Vin in 0 5
R1 in out {rtop}
R2 out 0 1k
.op
.end
`)
    expect(value(imported.netlist.components.find((component) => component.name === 'R1')?.parameters.value)).toBeCloseTo(
      4000,
      9,
    )
  })

  it('applies instance parameters to the same subcircuit twice', () => {
    const imported = importDeck(`* per-instance divider
.subckt div in out
.param k=1
Rtop in m {k*1k}
Rbot m out 1k
.ends
V1 a 0 6
X1 a 0 div k=2
V2 b 0 6
X2 b 0 div k=5
.op
.end
`)
    const values = imported.netlist.components
      .filter((component) => component.name.endsWith('Rtop'))
      .map((component) => value(component.parameters.value))
    expect(values).toEqual([2000, 5000])
    expect(imported.netlist.components.filter((component) => component.name.endsWith('Rtop'))[0]?.nodes).toEqual([
      'a',
      'X1:m',
    ])
  })

  it('calls a .func with a built-in inside a value', () => {
    const imported = importDeck(`* function card
.func half(x)={x/2}
.param target=10
R1 a b {sqrt(half(target))*1k}
V1 a 0 1
.op
.end
`)
    expect(value(imported.netlist.components[0]?.parameters.value)).toBeCloseTo(Math.sqrt(5) * 1000, 3)
  })

  it('substitutes a brace group inside a source waveform and an analysis card', () => {
    const imported = importDeck(`* stimulus from a parameter
.param amp=2.5
.param tstop=4m
V1 in 0 SIN(0 {amp} 1k)
R1 in 0 1k
.tran {tstop/100} {tstop}
.end
`)
    expect(value(imported.netlist.components[0]?.parameters.va)).toBe(2.5)
    expect(imported.netlist.analyses[0]).toMatchObject({ type: 'transient', stepTime: 4e-5, stopTime: 4e-3 })
  })

  it('reads the paired .param spelling and the ngspice parameter prefixes', () => {
    const imported = importDeck(`* spelled three ways
.param rbase 2k
.param scaled={param::rbase*3}
R1 a b {p::scaled}
V1 a 0 1
.op
.end
`)
    expect(value(imported.netlist.components[0]?.parameters.value)).toBeCloseTo(6000, 9)
  })

  it('reports the card whose parameter is missing', () => {
    const imported = parseSpiceDeck(`* typo
R1 a b {ralu*1k}
V1 a 0 1
.op
.end
`)
    expect(imported.errors.join(' ')).toMatch(/Line 2: R1: parameter "ralu" is not defined/)
  })

  it('names a parameter cycle instead of hanging', () => {
    const imported = parseSpiceDeck(`* circular
.param a={b}
.param b={a}
R1 x y {a}
V1 x 0 1
.op
.end
`)
    expect(imported.errors.join(' ')).toMatch(/defined in a cycle/)
  })
})

describe('SPICE hierarchy errors', () => {
  it('refuses an instance with the wrong pin count', () => {
    const imported = parseSpiceDeck(`* shorted call
.subckt op in out vcc vee
E1 out 0 in 0 100
.ends
X1 a b op
V1 a 0 1
.op
.end
`)
    expect(imported.errors.join(' ')).toMatch(
      /X1 connects 2 node\(s\) to op, which has 4 port\(s\): in out vcc vee/,
    )
  })

  it('refuses an instance of a subcircuit that is not defined', () => {
    const imported = parseSpiceDeck(`* missing cell
X1 a b BUF
V1 a 0 1
.op
.end
`)
    expect(imported.errors.join(' ')).toMatch(/X1: "BUF" is not a subcircuit defined in this deck/)
  })

  it('refuses a recursive definition instead of expanding forever', () => {
    const imported = parseSpiceDeck(`* loop
.subckt ring a b
Xi a mid ring
R1 mid b 1k
.ends
X2 in 0 ring
V1 in 0 1
.op
.end
`)
    expect(imported.errors.join(' ')).toMatch(/Xi expands to ring, which is already on the path/)
  })

  it('refuses two subcircuits with the same name', () => {
    const imported = parseSpiceDeck(`* twins
.subckt dup a b
R1 a b 1k
.ends
.subckt dup a b
R2 a b 2k
.ends
X1 n 0 dup
V1 n 0 1
.op
.end
`)
    expect(imported.errors.join(' ')).toMatch(/\.subckt dup is defined twice \(also on line 2\)/)
  })

  it('refuses an analysis card written inside a subcircuit', () => {
    const imported = parseSpiceDeck(`* misplaced card
.subckt bad a b
R1 a b 1k
.tran 1u 1m
.ends
X1 n 0 bad
V1 n 0 1
.end
`)
    expect(imported.errors.join(' ')).toMatch(/\.tran is not allowed inside subcircuit bad/)
  })

  it('reports a subcircuit that the deck never closes', () => {
    const imported = parseSpiceDeck(`* never closed
.subckt open a b
R1 a b 1k
.end
`)
    expect(imported.errors.join(' ')).toMatch(/\.subckt open is never closed by \.ends/)
  })

  it('warns about an instance parameter the subcircuit never declares', () => {
    const imported = parseSpiceDeck(`* dead knob
.subckt plain a b
R1 a b 1k
.ends
X1 n 0 plain gain=10
V1 n 0 1
.op
.end
`)
    expect(imported.warnings.join(' ')).toMatch(/gain= has no matching \.param in plain/)
  })
})

describe('vendor SPICE macromodels', () => {
  it('imports and solves the shipped LM741 as a unity-gain follower', () => {
    const { imported, outcome } = solve(`* LM741 follower from the vendor library
${VENDOR_OPAMP_SUBCIRCUITS.LM741}
V1 in 0 2
X1 in out 5 0 out LM741
.op
.end
`)
    expect(imported.netlist.models).toBeDefined()
    expect(imported.netlist.components.map((component) => component.name)).toEqual([
      'V1',
      'X1:Rid',
      'X1:Egain',
      'X1:Rout',
      'X1:Cout',
      'X1:Dpos',
      'X1:Dneg',
    ])
    expect(nodeVoltage(outcome, 'in')).toBeCloseTo(2, 6)
    expect(nodeVoltage(outcome, 'out')).toBeCloseTo(2, 4)
  })

  it('imports and solves the shipped LM358 follower', () => {
    const { outcome } = solve(`* LM358 follower from the vendor library
${VENDOR_OPAMP_SUBCIRCUITS.LM358}
V1 in 0 1
X1 in out 5 0 out LM358
.op
.end
`)
    expect(nodeVoltage(outcome, 'out')).toBeCloseTo(1, 4)
  })

  it('imports the shipped LM7805, brace expression and all', () => {
    const { imported, outcome } = solve(`* regulator from the vendor library
${VENDOR_VREG_SUBCIRCUITS.LM7805}
V1 in 0 12
X1 in 0 out LM7805
Rload out 0 100
.op
.end
`)
    const pass = imported.netlist.components.find((component) => component.name === 'X1:Rpass')
    expect(pass?.nodes).toEqual(['in', 'out'])
    expect(value(pass?.parameters.value)).toBeCloseTo(0.04, 12)
    expect(imported.netlist.components.find((component) => component.name === 'X1:Vref')?.nodes).toEqual([
      'X1:10',
      '0',
    ])
    expect(nodeVoltage(outcome, 'out')).toBeCloseTo(5, 9)
  })
})
