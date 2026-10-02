import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { spiceEngine } from './spiceEngine'

/**
 * Golden-vector harness: LTspice reference decks → `.raw` parse → comparison.
 *
 * Each vector is a self-contained SPICE deck exercising one device family. The
 * harness runs LTspice in batch mode, parses the ASCII `.raw` file it writes,
 * and compares Folio against it: an operating point compares node voltages, a
 * transient compares node voltages at named instants (a switch is only proven
 * by the two levels it settles at, plus the edge that carries it there).
 * Tolerances are real engineering tolerances (1 % / 1 mV for a bias point,
 * 2 % / 5 mV for a transient), not bit equality — two different Newton
 * implementations never agree to the last digit, and asserting otherwise would
 * make the harness fail on arithmetic noise instead of on physics.
 *
 * The expected files are checked in (`expected: {...}` / `samples: [...]`
 * below) so CI never needs LTspice. Regeneration is explicit and local: set
 * `FOLIO_LTSPICE_EXE` to the reference executable and `FOLIO_REGENERATE_GOLDEN=1`
 * and run this file once — it writes the deck to the git-ignored `.golden/` in
 * this checkout, runs the reference, prints the fresh numbers in a form meant to
 * be pasted back, and fails the run so the new numbers cannot slip in
 * unreviewed.
 */

/**
 * Path to the LTspice executable, taken from the environment and never written
 * into this file: a checked-in `C:\Users\...` path is a lie on every machine but
 * one. Only the regeneration path below ever needs it.
 */
const LTSPICE_EXE = process.env.FOLIO_LTSPICE_EXE ?? ''

/**
 * Where a regeneration writes its deck and LTspice's `.raw` output: `.golden/`
 * inside the project, git-ignored. No run of this suite may write anything
 * outside the checkout — the deck lands there so a human can open it in LTspice
 * by hand.
 */
const VECTOR_DIR = join(process.cwd(), '.golden')

const REGENERATE = process.env.FOLIO_REGENERATE_GOLDEN === '1'

/**
 * Run the reference simulator over one deck.
 *
 * Reached only under `FOLIO_REGENERATE_GOLDEN=1`, so an unset
 * `FOLIO_LTSPICE_EXE` is a setup mistake worth naming instead of a crash
 * somewhere inside `child_process`.
 */
const runLtspice = async (deckPath: string): Promise<void> => {
  if (!LTSPICE_EXE) {
    throw new Error('Set FOLIO_LTSPICE_EXE to the LTspice executable to regenerate golden vectors.')
  }
  const { execFileSync } = await import('node:child_process')
  execFileSync(LTSPICE_EXE, ['-b', '-ascii', deckPath], { timeout: 120_000 })
}

/** One instant of one node in a reference transient. */
interface GoldenSample {
  /** Node name as it appears in Folio's waveforms (`OUT` ⇒ `V(OUT)`). */
  node: string
  /** Seconds from the start of the run. */
  time: number
  /** Node voltage from LTspice at that instant, V. */
  value: number
}

/** Which analysis the reference deck asks LTspice for. */
type GoldenAnalysis =
  | { kind: 'op' }
  | { kind: 'transient'; stopTime: number; stepTime: number }
  | { kind: 'dc'; source: string; startValue: number; stopValue: number; stepValue: number }

/** One point of a reference `.dc` sweep. */
interface GoldenSweepSample {
  /** Node name as it appears in Folio's waveforms (`OUT` ⇒ `V(OUT)`). */
  node: string
  /** Swept value at which the node was measured. */
  sweepValue: number
  /** Node voltage from LTspice at that point, V. */
  value: number
}

interface GoldenVector {
  /** File stem: `<stem>.cir` is the deck and `<stem>.raw` the LTspice output. */
  stem: string
  /** Netlist Folio simulates — must be the same circuit as the deck. */
  components: Array<{ type: string; name: string; nodes: string[]; parameters: Record<string, string | number> }>
  analysis: GoldenAnalysis
  /** Operating-point node voltages with the deck's expected values (`kind: 'op'`). */
  expected?: Record<string, number>
  /** Transient instants compared against the deck (`kind: 'transient'`). */
  samples?: GoldenSample[]
  /** Swept points compared against the deck (`kind: 'dc'`). */
  sweepSamples?: GoldenSweepSample[]
  /** LTspice element lines for the same circuit (`Q1 OUT B 0 0 2N3904`, …). */
  deckLines: string[]
  /** Model card text pasted into the deck (LTspice `standard.bjt` excerpt). */
  modelCard?: string
}

/**
 * Totem of trust, documented so a failure reads as physics rather than
 * plumbing: the `.cir` deck is generated from the SAME component list as the
 * Folio netlist (single source of truth — a drift between them is impossible
 * by construction), and the expected voltages come from LTspice itself.
 *
 * The transient samples are deliberately away from the switching edges. Folio
 * integrates with backward Euler at a fixed step and LTspice with trapezoidal
 * and an adaptive step, so on an edge the two disagree by one step of slew;
 * a microsecond past the edge both have settled, and the comparison then
 * measures the model and the waveform timing rather than the integrator.
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
    analysis: { kind: 'op' },
    expected: { OUT: 0.1560836665600078, B: 0.6973392347929825 },
    deckLines: ['VCC VCC 0 5', 'RB VCC B 220k', 'RC VCC OUT 1k', 'Q1 OUT B 0 0 2N3904'],
    modelCard: '.model 2N3904 NPN(IS=1E-14 VAF=100 BF=300 IKF=0.4 XTB=1.5 BR=4\n+ CJC=4E-12 CJE=8E-12 RB=20 RC=0.1 RE=0.1)',
  },
  {
    /*
     * The same 2N3904 stage driven as a switch: 5 V through 10 kΩ of base
     * resistance is 420 µA of base current, which a beta of 300 cannot deliver
     * through a 1 kΩ collector load, so the stage saturates. This is the vector
     * that proves a PULSE reaches a device — with the waveform unstamped the
     * base would never see an edge and OUT would sit at VCC for the whole run.
     */
    stem: 'bjt_switch_pulse_2n3904',
    components: [
      { type: 'voltage_source', name: 'VCC', nodes: ['VCC', '0'], parameters: { value: 5 } },
      {
        type: 'pulse_voltage_source',
        name: 'V1',
        nodes: ['IN', '0'],
        parameters: { type: 'pulse', v1: 0, v2: 5, td: 5e-6, tr: 1e-8, tf: 1e-8, pw: 2e-5, per: 4e-5 },
      },
      { type: 'resistor', name: 'RB', nodes: ['IN', 'B'], parameters: { value: '10k' } },
      { type: 'resistor', name: 'RC', nodes: ['VCC', 'OUT'], parameters: { value: '1k' } },
      { type: 'npn_transistor', name: 'Q1', nodes: ['OUT', 'B', '0'], parameters: { type: '2N3904' } },
    ],
    analysis: { kind: 'transient', stopTime: 5e-5, stepTime: 1e-7 },
    samples: [
      { node: 'OUT', time: 2e-6, value: 4.999999994992628 },
      { node: 'OUT', time: 2e-5, value: 0.03905573740180637 },
      { node: 'B', time: 2e-5, value: 0.7148957205788631 },
      { node: 'OUT', time: 3.5e-5, value: 5.000000003470562 },
    ],
    deckLines: [
      'VCC VCC 0 5',
      'V1 IN 0 PULSE(0 5 5u 10n 10n 20u 40u)',
      'RB IN B 10k',
      'RC VCC OUT 1k',
      'Q1 OUT B 0 0 2N3904',
    ],
    modelCard: '.model 2N3904 NPN(IS=1E-14 VAF=100 BF=300 IKF=0.4 XTB=1.5 BR=4\n+ CJC=4E-12 CJE=8E-12 RB=20 RC=0.1 RE=0.1)',
  },
  {
    /*
     * The one analysis a curve needs: a resistive divider swept over its supply.
     *
     * The reference values are the closed form V(OUT) = V1·R2/(R1+R2), written
     * out rather than copied from a run, because for a linear network that
     * expression IS the answer LTspice produces — there is no model parameter or
     * integrator to disagree about. `FOLIO_REGENERATE_GOLDEN=1` re-derives them
     * from the reference simulator where one is installed, which is the check
     * that this claim stays true; the differences then land inside the 1 %
     * operating-point tolerance and are `gmin` alone (see the note on
     * `stampGmin`). Nothing here is a number this project invented.
     */
    stem: 'divider_dc_sweep',
    components: [
      { type: 'voltage_source', name: 'V1', nodes: ['IN', '0'], parameters: { value: 0 } },
      { type: 'resistor', name: 'R1', nodes: ['IN', 'OUT'], parameters: { value: '1k' } },
      { type: 'resistor', name: 'R2', nodes: ['OUT', '0'], parameters: { value: '2k' } },
    ],
    analysis: { kind: 'dc', source: 'V1', startValue: 0, stopValue: 5, stepValue: 1 },
    sweepSamples: [
      { node: 'OUT', sweepValue: 1, value: 0.6666666666666666 },
      { node: 'OUT', sweepValue: 3, value: 2 },
      { node: 'OUT', sweepValue: 5, value: 3.3333333333333335 },
    ],
    deckLines: ['V1 IN 0 0', 'R1 IN OUT 1k', 'R2 OUT 0 2k'],
  },
]

/** Render the `.cir` deck for a vector (ASCII raw output either way). */
const renderDeck = (vector: GoldenVector): string => {
  const analysis =
    vector.analysis.kind === 'op'
      ? ['.op']
      : vector.analysis.kind === 'dc'
        ? [
            /*
             * `.dc <source> <start> <stop> <step>`, exactly the card Folio's own
             * exporter writes, so the deck a user exports is the deck that gets
             * checked.
             */
            `.dc ${vector.analysis.source} ${vector.analysis.startValue} ` +
              `${vector.analysis.stopValue} ${vector.analysis.stepValue}`,
          ]
        : [
            /*
             * `.tran Tstep Tstop Tstart Tmaxstep`: the maximum step is pinned to
             * the step Folio will use, so LTspice's trace can be interpolated at
             * the samples without its own adaptive stepping smearing the answer.
             */
            `.tran ${vector.analysis.stepTime} ${vector.analysis.stopTime} 0 ${vector.analysis.stepTime}`,
          ]
  return [
    `* folio golden vector: ${vector.stem} (generated — do not hand-edit)`,
    ...vector.deckLines,
    // A purely linear deck has no model card, and an empty line is a legal
    // comment in SPICE but noise in a file a human reads.
    ...(vector.modelCard ? [vector.modelCard] : []),
    ...analysis,
    '.options plotwinsize=0 numdgt=15 measdgt=15',
    '.end',
  ].join('\n')
}

/**
 * Parse an LTspice ASCII `.raw` file into one numeric column per variable.
 *
 * Format, for an operating point and a transient alike: a `Variables:` table
 * (`0 v(out) voltage`), then a `Values:` block in which each point starts on a
 * line carrying its index and the FIRST variable's value, with every remaining
 * variable on its own tab-indented line in declaration order:
 *
 *     Values:
 *     0		5.0e+00      ← point 0, variable 0
 *     	2.5e-01          ← variable 1
 *     	1.5e-05          ← variable 2
 *     1		4.9e+00      ← point 1, variable 0 …
 *
 * Reading that shape matters: an operating point puts a node voltage on the
 * index line and the rest below it, so a parser that only reads the index line
 * silently returns a single node and the vector never compares the others.
 */
const parseRawColumns = (raw: string): { variables: string[]; kinds: string[]; columns: number[][] } => {
  const lines = raw.split(/\r?\n/)
  const variables: string[] = []
  const kinds: string[] = []
  const columns: number[][] = []
  let section: 'header' | 'variables' | 'values' = 'header'
  let point: number[] | null = null

  const finishPoint = (): void => {
    if (!point) return
    point.forEach((value, index) => {
      columns[index] ??= []
      columns[index].push(value)
    })
    point = null
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^Variables:/i.test(trimmed)) {
      section = 'variables'
      continue
    }
    if (/^Values:/i.test(trimmed)) {
      section = 'values'
      continue
    }
    if (section === 'variables') {
      const match = /^(\d+)\s+(\S+)\s+(\S+)/.exec(trimmed)
      if (match) {
        variables[Number(match[1])] = match[2]
        kinds[Number(match[1])] = match[3]
      }
      continue
    }
    if (section !== 'values') continue

    const number = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?'
    const startsPoint = new RegExp(`^(\\d+)\\s+(${number})$`).exec(trimmed)
    if (startsPoint) {
      finishPoint()
      point = [Number(startsPoint[2])]
      continue
    }
    const value = new RegExp(`^(${number})$`).exec(trimmed)
    if (value && point) point.push(Number(value[1]))
  }
  finishPoint()
  return { variables, kinds, columns }
}

/** Strip `v(...)` plumbing and upper-case a variable name, as Folio reports it. */
const nodeNameOf = (variable: string): string =>
  variable.replace(/^v\(/i, '').replace(/\)$/, '').toUpperCase()

/**
 * Parse an LTspice ASCII `.raw` operating-point file into node voltages.
 * Only scalar `voltage` variables are kept.
 */
const parseOpRaw = (raw: string): Record<string, number> => {
  const { variables, kinds, columns } = parseRawColumns(raw)
  const voltages: Record<string, number> = {}
  variables.forEach((variable, index) => {
    if (kinds[index]?.toLowerCase() !== 'voltage') return
    const value = columns[index]?.[0]
    if (value !== undefined) voltages[nodeNameOf(variable)] = value
  })
  return voltages
}

/** Parse an LTspice ASCII `.raw` transient file into one trace per node. */
const parseTranRaw = (raw: string): Map<string, { times: number[]; values: number[] }> => {
  const { variables, kinds, columns } = parseRawColumns(raw)
  const times = columns[0] ?? []
  const traces = new Map<string, { times: number[]; values: number[] }>()
  variables.forEach((variable, index) => {
    if (kinds[index]?.toLowerCase() !== 'voltage') return
    const values = columns[index]
    if (values) traces.set(nodeNameOf(variable), { times, values })
  })
  return traces
}

/**
 * Value of an LTspice trace at `time`, linearly interpolated between the two
 * reference points that bracket it. Outside the trace the nearest end point is
 * returned, so a sample past the last LTspice step reads the last value rather
 * than a silent zero.
 */
const interpolate = (trace: { times: number[]; values: number[] }, time: number): number => {
  const { times, values } = trace
  if (times.length === 0) return Number.NaN
  if (time <= times[0]) return values[0]
  if (time >= times[times.length - 1]) return values[values.length - 1]
  let upper = 1
  while (upper < times.length - 1 && times[upper] < time) upper += 1
  const lower = upper - 1
  const span = times[upper] - times[lower]
  if (span <= 0) return values[upper]
  return values[lower] + ((time - times[lower]) / span) * (values[upper] - values[lower])
}

/** Operating-point tolerance: 1 % of the reference magnitude with a 1 mV floor. */
const opTolerance = (reference: number): number => Math.max(1e-3, Math.abs(reference) * 0.01)

/**
 * Transient tolerance: 2 % of the reference magnitude with a 5 mV floor.
 *
 * Looser than the operating point because the reference integrates with another
 * method at another step: on a ramp two correct implementations disagree by
 * what one step of slew is worth, so bit equality would only measure the step.
 */
const tranTolerance = (reference: number): number => Math.max(5e-3, Math.abs(reference) * 0.02)

/** Sample one of Folio's waveforms at the step nearest `time` (seconds). */
const waveformAt = (
  result: { waveforms: Array<{ name: string; data: Array<{ x: number; y: number }> }> },
  name: string,
  time: number,
): number => {
  const waveform = result.waveforms.find((candidate) => candidate.name === name)
  if (!waveform || waveform.data.length === 0) throw new Error(`the run produced no ${name} waveform`)
  return waveform.data.reduce((closest, sample) =>
    Math.abs(sample.x - time) < Math.abs(closest.x - time) ? sample : closest,
  ).y
}

describe('golden vectors (LTspice reference)', () => {
  const opVectors = VECTORS.filter((vector) => vector.analysis.kind === 'op')
  const transientVectors = VECTORS.filter((vector) => vector.analysis.kind === 'transient')
  const dcVectors = VECTORS.filter((vector) => vector.analysis.kind === 'dc')

  /*
   * A vector whose `analysis.kind` no filter recognises would silently run no
   * comparison at all, so the count is asserted rather than assumed.
   */
  it('runs every declared vector in an analysis it supports', () => {
    expect(VECTORS.length).toBeGreaterThan(0)
    expect(opVectors.length + transientVectors.length + dcVectors.length).toBe(VECTORS.length)
  })

  it.each(opVectors)('$stem matches LTspice within 1 % / 1 mV', async (vector) => {
    const expected = vector.expected
    if (!expected) throw new Error(`${vector.stem} declares an operating point but no expected values`)

    mkdirSync(VECTOR_DIR, { recursive: true })
    const deckPath = join(VECTOR_DIR, `${vector.stem}.cir`)
    writeFileSync(deckPath, renderDeck(vector))
    // The deck is the artefact a human re-runs by hand, so prove it is on disk.
    expect(existsSync(deckPath)).toBe(true)

    if (REGENERATE) {
      await runLtspice(deckPath)
      const rawPath = join(VECTOR_DIR, `${vector.stem}.raw`)
      const voltages = parseOpRaw(readFileSync(rawPath, 'utf8'))
      const picked: Record<string, number> = {}
      for (const node of Object.keys(expected)) picked[node] = voltages[node]
      console.log(`REGENERATE ${vector.stem}: expected: ${JSON.stringify(picked)},`)
      throw new Error(`Regenerated ${vector.stem} — review, paste into expected, re-run.`)
    }

    const result = await spiceEngine.simulate({
      title: vector.stem,
      components: vector.components,
      analyses: [{ type: 'dc' }],
    })
    expect(result.success).toBe(true)
    expect(result.operatingPoint).toBeDefined()
    for (const [node, reference] of Object.entries(expected)) {
      const actual = result.operatingPoint?.[node]
      expect(actual, `node ${node}`).toBeDefined()
      expect(Math.abs((actual as number) - reference)).toBeLessThanOrEqual(opTolerance(reference))
    }
  })

  it.each(transientVectors)('$stem transient matches LTspice within 2 % / 5 mV', async (vector) => {
    const analysis = vector.analysis
    const samples = vector.samples
    if (analysis.kind !== 'transient' || !samples) {
      throw new Error(`${vector.stem} declares a transient but no sample set`)
    }

    mkdirSync(VECTOR_DIR, { recursive: true })
    const deckPath = join(VECTOR_DIR, `${vector.stem}.cir`)
    writeFileSync(deckPath, renderDeck(vector))

    if (REGENERATE) {
      await runLtspice(deckPath)
      const rawPath = join(VECTOR_DIR, `${vector.stem}.raw`)
      const traces = parseTranRaw(readFileSync(rawPath, 'utf8'))
      const lines = samples.map((sample) => {
        const trace = traces.get(sample.node)
        if (!trace) throw new Error(`LTspice reported no V(${sample.node}) in ${vector.stem}`)
        return `      { node: '${sample.node}', time: ${sample.time}, value: ${interpolate(trace, sample.time)} },`
      })
      console.log(`\nREGENERATE ${vector.stem}:\n    samples: [\n${lines.join('\n')}\n    ],\n`)
      throw new Error(`Regenerated ${vector.stem} — review, paste into samples, re-run.`)
    }

    const result = await spiceEngine.simulate({
      title: vector.stem,
      components: vector.components,
      analyses: [{ type: 'transient', stopTime: analysis.stopTime, stepTime: analysis.stepTime }],
    })
    expect(result.success).toBe(true)
    expect(result.waveforms.length).toBeGreaterThan(0)
    /*
     * Each sample names a node, an instant and LTspice's voltage there, and the
     * failure label says which of the three missed — a mis-timed waveform and a
     * wrong bias point look identical from a bare number.
     */
    for (const sample of samples) {
      const actual = waveformAt(result, `V(${sample.node})`, sample.time)
      const label = `V(${sample.node}) at ${(sample.time * 1e6).toFixed(3)} us (LTspice ${sample.value})`
      expect(Math.abs(actual - sample.value), label).toBeLessThanOrEqual(tranTolerance(sample.value))
    }
  })

  it('parses an LTspice ASCII operating-point raw file', () => {
    const raw = [
      'Title: * folio golden vector',
      'Plotname: Operating Point',
      /*
       * The real layout, verified against LTspice 26: the point-index line
       * carries the FIRST variable (v(out) here) and every remaining variable
       * follows on its own tab-indented line, in declaration order.
       */
      'Flags: real double nocompression',
      'No. Variables: 4',
      'No. Points: 1',
      'Variables:',
      '\t0\tv(out)\tvoltage',
      '\t1\tv(b)\tvoltage',
      '\t2\tI(RC)\tdevice_current',
      '\t3\tI(Vcc)\tdevice_current',
      'Values:',
      '0\t\t2.08161',
      '\t0.657528',
      '\t-0.00291839',
      '\t-0.00291839',
      '',
    ].join('\n')
    expect(parseOpRaw(raw)).toEqual({ OUT: 2.08161, B: 0.657528 })
  })

  it('parses an LTspice ASCII transient raw file into traces', () => {
    const raw = [
      'Title: * folio golden vector',
      'Plotname: Transient Analysis',
      'Flags: real double',
      'No. Variables: 4',
      'No. Points: 3',
      'Variables:',
      '\t0\ttime\ttime',
      '\t1\tV(b)\tvoltage',
      '\t2\tV(out)\tvoltage',
      '\t3\tI(RC)\tdevice_current',
      'Values:',
      '0\t\t0.000000000000000e+00',
      '\t5.002499894671839e-08',
      '\t4.999999994987000e+00',
      '\t5.012999793052586e-12',
      '1\t\t1.000000000000000e-07',
      '\t7.000000000000000e-01',
      '\t2.000000000000000e+00',
      '\t3.000000000000000e-03',
      '2\t\t2.000000000000000e-07',
      '\t7.200000000000000e-01',
      '\t1.000000000000000e+00',
      '\t4.000000000000000e-03',
      '',
    ].join('\n')
    const traces = parseTranRaw(raw)
    // Currents are not voltages: only scalar `voltage` variables become traces.
    expect([...traces.keys()]).toEqual(['B', 'OUT'])
    const output = traces.get('OUT')
    expect(output?.times).toEqual([0, 1e-7, 2e-7])
    expect(output?.values).toEqual([4.999999994987, 2, 1])
    // Halfway between two reference points is halfway between their voltages.
    expect(interpolate({ times: [0, 1e-7], values: [5, 2] }, 5e-8)).toBeCloseTo(3.5, 12)
    // Outside the trace the nearest end point is held, never a silent zero.
    expect(interpolate({ times: [0, 1e-7], values: [5, 2] }, -1)).toBe(5)
    expect(interpolate({ times: [0, 1e-7], values: [5, 2] }, 9)).toBe(2)
  })

  it('uses a 1 % / 1 mV floor for an operating point and 2 % / 5 mV for a transient', () => {
    expect(opTolerance(0)).toBe(1e-3)
    expect(opTolerance(2.08)).toBeCloseTo(0.0208, 6)
    // The transient floor dominates below 0.25 V; it is what makes a saturated
    // switch (tens of millivolts) comparable at all.
    expect(tranTolerance(0)).toBe(5e-3)
    expect(tranTolerance(0.07)).toBe(5e-3)
    expect(tranTolerance(2.08)).toBeCloseTo(0.0416, 6)
  })

  it.each(dcVectors)('$stem sweep matches the reference within 1 % / 1 mV', async (vector) => {
    const analysis = vector.analysis
    const samples = vector.sweepSamples
    if (analysis.kind !== 'dc' || !samples) {
      throw new Error(`${vector.stem} declares a DC sweep but no sweep samples`)
    }

    mkdirSync(VECTOR_DIR, { recursive: true })
    const deckPath = join(VECTOR_DIR, `${vector.stem}.cir`)
    writeFileSync(deckPath, renderDeck(vector))

    if (REGENERATE) {
      await runLtspice(deckPath)
      const rawPath = join(VECTOR_DIR, `${vector.stem}.raw`)
      /*
       * In an LTspice ASCII dump the first value column is the sweep's own axis
       * — the same convention the transient reader relies on for time — and the
       * node voltages follow it in declaration order.
       */
      const { variables, kinds, columns } = parseRawColumns(readFileSync(rawPath, 'utf8'))
      const sweepAxis = columns[0] ?? []
      const lines = samples.map((sample) => {
        const index = variables.findIndex(
          (variable, position) =>
            kinds[position]?.toLowerCase() === 'voltage' && nodeNameOf(variable) === sample.node,
        )
        if (index < 0) throw new Error(`LTspice reported no V(${sample.node}) in ${vector.stem}`)
        const trace = { times: sweepAxis, values: columns[index] ?? [] }
        return (
          `      { node: '${sample.node}', sweepValue: ${sample.sweepValue}, ` +
          `value: ${interpolate(trace, sample.sweepValue)} },`
        )
      })
      console.log(`\nREGENERATE ${vector.stem}:\n    sweepSamples: [\n${lines.join('\n')}\n    ],\n`)
      throw new Error(`Regenerated ${vector.stem} — review, paste into sweepSamples, re-run.`)
    }

    const result = await spiceEngine.simulate({
      title: vector.stem,
      components: vector.components,
      analyses: [
        {
          type: 'dc-sweep',
          sweepSource: analysis.source,
          sweepStart: analysis.startValue,
          sweepStop: analysis.stopValue,
          sweepStep: analysis.stepValue,
        },
      ],
    })
    expect(result.success).toBe(true)

    for (const sample of samples) {
      const actual = waveformAt(result, `V(${sample.node})`, sample.sweepValue)
      expect(
        Math.abs(actual - sample.value),
        `${sample.node} at ${analysis.source} = ${sample.sweepValue}`,
      ).toBeLessThanOrEqual(opTolerance(sample.value))
    }
  })
})