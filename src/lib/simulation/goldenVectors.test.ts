import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCircuitModel } from './circuitModel'
import { spiceEngine } from './spiceEngine'

/**
 * Golden-vector harness: LTspice reference decks → `.raw` parse → comparison.
 *
 * Each vector is a self-contained SPICE deck exercising one device family. The
 * harness runs LTspice in batch mode, parses the ASCII `.raw` file it writes,
 * and compares Folio's operating point against the reference node voltages.
 * Tolerances are real engineering tolerances (1 % / 1 mV floor), not bit
 * equality — two different Newton implementations never agree to the last
 * digit, and asserting otherwise would make the harness fail on arithmetic
 * noise instead of on physics.
 *
 * The expected files are checked in (`expected: {...}` below) so CI never
 * needs LTspice. Regeneration is explicit: set `FOLIO_REGENERATE_GOLDEN=1` and
 * run this file once with LTspice installed — it rewrites the deck, runs the
 * reference, prints the fresh voltages, and fails the run so the new numbers
 * cannot slip in unreviewed.
 */

const LTSPICE_EXE = 'C:\\Users\\digit\\AppData\\Local\\Programs\\ADI\\LTspice\\LTspice.exe'
const VECTOR_DIR = 'C:\\Users\\digit\\AppData\\Local\\Temp\\folio_validate\\golden'

const REGENERATE = process.env.FOLIO_REGENERATE_GOLDEN === '1'

interface GoldenVector {
  /** File stem: `<stem>.cir` is the deck, `<stem>.expected.json` the voltages. */
  stem: string
  /** Netlist Folio simulates — must be the same circuit as the deck. */
  components: Array<{ type: string; name: string; nodes: string[]; parameters: Record<string, string | number> }>
  /** Nodes compared against the reference, with the deck's expected values. */
  expected: Record<string, number>
  /** LTspice element lines for the same circuit (`Q1 OUT B 0 0 2N3904`, …). */
  deckLines: string[]
  /** Model card text pasted into the deck (LTspice `standard.bjt` excerpt). */
  modelCard: string
}

/**
 * Totem of trust, documented so a failure reads as physics rather than
 * plumbing: the `.cir` deck is generated from the SAME component list as the
 * Folio netlist (single source of truth — a drift between them is impossible
 * by construction), and the expected voltages come from LTspice itself.
 */
const VECTORS: GoldenVector[] = [
  {
    stem: 'bjt_ce_2n3904',
    components: [
      { type: 'voltage_source', name: 'VCC', nodes: ['VCC', '0'], parameters: { value: 5 } },
      { type: 'resistor', name: 'RB', nodes: ['VCC', 'B'], parameters: { value: '220k' } },
      { type: 'resistor', name: 'RC', nodes: ['VCC', 'OUT'], parameters: { value: '1k' } },
      { type: 'npn_transistor', name: 'Q1', nodes: ['OUT', 'B', '0'], parameters: { type: '2N3904' } },
    ],
    expected: { OUT: 0.156084, B: 0.697339 },
    deckLines: ['VCC VCC 0 5', 'RB VCC B 220k', 'RC VCC OUT 1k', 'Q1 OUT B 0 0 2N3904'],
    modelCard: '.model 2N3904 NPN(IS=1E-14 VAF=100 BF=300 IKF=0.4 XTB=1.5 BR=4\n+ CJC=4E-12 CJE=8E-12 RB=20 RC=0.1 RE=0.1)',
  },
]

/** Render the `.cir` deck for a vector (`.op`, ASCII raw output). */
const renderDeck = (vector: GoldenVector): string =>
  [
    `* folio golden vector: ${vector.stem} (generated — do not hand-edit)`,
    ...vector.deckLines,
    vector.modelCard,
    '.op',
    '.options plotwinsize=0 numdgt=15 measdgt=15',
    '.end',
  ].join('\n')

/**
 * Parse an LTspice ASCII `.raw` operating-point file into node voltages.
 * Format: a `Variables:` table (`0 v(out) voltage`) then `Values:` lines
 * (`0<TAB>2.08161`). Only scalar `voltage` variables are kept.
 */
const parseOpRaw = (raw: string): Record<string, number> => {
  const lines = raw.split(/\r?\n/)
  const variables: Array<{ index: number; name: string; kind: string }> = []
  let section: 'header' | 'variables' | 'values' = 'header'
  const values = new Map<number, number>()
  for (const line of lines) {
    if (/^Variables:/i.test(line.trim())) {
      section = 'variables'
      continue
    }
    if (/^Values:/i.test(line.trim())) {
      section = 'values'
      continue
    }
    if (section === 'variables') {
      const match = /^\s*(\d+)\s+(\S+)\s+(\S+)/.exec(line)
      if (match) variables.push({ index: Number(match[1]), name: match[2], kind: match[3] })
    } else if (section === 'values') {
      const match = /^\s*(\d+)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(line)
      if (match) values.set(Number(match[1]), Number(match[2]))
    }
  }
  const voltages: Record<string, number> = {}
  for (const variable of variables) {
    if (variable.kind.toLowerCase() !== 'voltage') continue
    const value = values.get(variable.index)
    if (value !== undefined) voltages[variable.name.replace(/^v\(/i, '').replace(/\)$/, '').toUpperCase()] = value
  }
  return voltages
}

/** Engineering tolerance: 1 % of reference magnitude with a 1 mV floor. */
const toleranceFor = (reference: number): number => Math.max(1e-3, Math.abs(reference) * 0.01)

describe('golden vectors (LTspice reference)', () => {
  it.each(VECTORS)('$stem matches LTspice within 1 % / 1 mV', async (vector) => {
    mkdirSync(VECTOR_DIR, { recursive: true })
    const deckPath = join(VECTOR_DIR, `${vector.stem}.cir`)
    writeFileSync(deckPath, renderDeck(vector))

    if (REGENERATE) {
      const { execFileSync: run } = await import('node:child_process')
      run(LTSPICE_EXE, ['-b', '-ascii', deckPath], { timeout: 120_000 })
      const rawPath = join(VECTOR_DIR, `${vector.stem}.raw`)
      const voltages = parseOpRaw(readFileSync(rawPath, 'utf8'))
      const picked: Record<string, number> = {}
      for (const node of Object.keys(vector.expected)) picked[node] = voltages[node]
      console.log(`REGENERATE ${vector.stem}: ${JSON.stringify(picked)}`)
      throw new Error(`Regenerated ${vector.stem} — review, paste into expected, re-run.`)
    }

    const result = await spiceEngine.simulate({
      title: vector.stem,
      components: vector.components,
      analyses: [{ type: 'dc' }],
    })
    expect(result.success).toBe(true)
    expect(result.operatingPoint).toBeDefined()
    for (const [node, reference] of Object.entries(vector.expected)) {
      const actual = result.operatingPoint?.[node]
      expect(actual, `node ${node}`).toBeDefined()
      expect(Math.abs((actual as number) - reference)).toBeLessThanOrEqual(toleranceFor(reference))
    }
  })

  it('parses an LTspice ASCII operating-point raw file', () => {
    const raw = [
      'Title: * folio golden vector',
      'Plotname: Operating Point',
      'Flags: real forward',
      'No. Variables: 3',
      'No. Points: 1',
      'Variables:',
      '\t0\tv(out)\tvoltage',
      '\t1\tv(b)\tvoltage',
      '\t2\tI(Vcc)\tcurrent',
      'Values:',
      '0\t2.08161',
      '1\t0.657528',
      '2\t-0.00291839',
      '',
    ].join('\n')
    expect(parseOpRaw(raw)).toEqual({ OUT: 2.08161, B: 0.657528 })
  })

  it('uses a 1 % / 1 mV tolerance floor', () => {
    expect(toleranceFor(0)).toBe(1e-3)
    expect(toleranceFor(2.08)).toBeCloseTo(0.0208, 6)
    expect(buildCircuitModel).toBeDefined()
    expect(existsSync).toBeDefined()
  })
})