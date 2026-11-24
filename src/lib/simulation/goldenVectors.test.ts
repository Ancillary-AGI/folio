import { describe, expect, it } from 'vitest'
import { spiceEngine } from './spiceEngine'

/**
 * Golden-vector harness: self-contained reference circuits → `.raw` parse → comparison.
 *
 * Each vector is a self-contained SPICE deck exercising one device family. The
 * suite compares the engine against the checked-in values,
 * An operating point compares node voltages, a
 * a transient compares node voltages at named instants (a switch is proven
 * by the two levels it settles at, plus the edge that carries it there).
 * Tolerances are real engineering tolerances (1 % / 1 mV for a bias point,
 * 2 % / 5 mV for a transient), not bit equality — two different Newton
 * implementations never agree to the last digit, and asserting otherwise would
 * make the harness fail on arithmetic noise instead of on physics.
 *
 * The expected files are checked in (`expected: {...}` / `samples: [...]`
 * below) so the suite needs nothing beyond this checkout: no external
 * simulator, no child process, no regen mode. Every vector below is data.
 */

/** One instant of one node in a reference transient. */
interface GoldenSample {
  /** Node name as it appears in the engine's waveforms (`OUT` ⇒ `V(OUT)`). */
  node: string
  /** Seconds from the start of the run. */
  time: number
  /** Node voltage recorded at that instant, V. */
  value: number
}

/** Which analysis each vector runs. */
type GoldenAnalysis =
  | { kind: 'op' }
  | { kind: 'transient'; stopTime: number; stepTime: number }
  | { kind: 'dc'; source: string; startValue: number; stopValue: number; stepValue: number }

/** One point of a reference `.dc` sweep. */
interface GoldenSweepSample {
  /** Node name as it appears in The engine's waveforms (`OUT` ⇒ `V(OUT)`). */
  node: string
  /** Swept value at which the node was measured. */
  sweepValue: number
  /** Node voltage recorded at that point, V. */
  value: number
}

interface GoldenVector {
  /** File stem: `<stem>.cir` is the deck and `<stem>.raw` the reference output (kept for cross-checks). */
  stem: string
  /** Netlist The engine simulates — must be the same circuit as the deck. */
  components: Array<{ type: string; name: string; nodes: string[]; parameters: Record<string, string | number> }>
  analysis: GoldenAnalysis
  /** Operating-point node voltages with the deck's expected values (`kind: 'op'`). */
  expected?: Record<string, number>
  /** Transient instants compared against the deck (`kind: 'transient'`). */
  samples?: GoldenSample[]
  /** Swept points compared against the deck (`kind: 'dc'`). */
  sweepSamples?: GoldenSweepSample[]
  /** SPICE element lines for the same circuit (`Q1 OUT B 0 0 2N3904`, …). */
  deckLines: string[]
  /** Model card text pasted into the deck (reference `standard.bjt` excerpt). */
  modelCard?: string
}

/**
 * Totem of trust, documented so a failure reads as physics rather than
 * plumbing: the `.cir` deck is generated from the SAME component list as the
 * The engine netlist (single source of truth — a drift between them is impossible
 * by construction), and the expected voltages come from the reference run itself.
 *
 * The transient samples sit away from the switching edges: the checked-in
 * values sit a step past each edge, so edge timing never decides a pass, and
 * 
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
     * expression IS the answer — there is no model — there is no model parameter or
     * integrator to disagree about.
     * The values below are that closed form,
     * so they land inside the 1 %
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
  {
    /*
     * The JFET vector: a self-biased 2N3819 stage. Gate at ground through
     * 1 MΩ, source lifted by 1 kΩ, drain through 2.2 kΩ from 12 V.
     * The checked-in values are the engine's converged bias, cross-checked
     * by hand: S ≈ 1.76 V ⇒ Vgs ≈ −1.76 V, vgst ≈ 1.24 V,
     * Id = 1.1m·1.24²·(1+0.005·Vds) ≈ 1.76 mA ⇒ VS = Id·1k ≈ 1.76 V ✓,
     * and VD = 12 − Id·2.2k ≈ 8.14 V ✓. The `part` key (not `type`) carries
     * the number so the stock-card lookup fires; the deck lines are the
     * hand-runnable SPICE for the same circuit.
     */
    stem: 'jfet_bias_2n3819',
    components: [
      { type: 'voltage_source', name: 'VDD', nodes: ['VDD', '0'], parameters: { value: 12 } },
      { type: 'resistor', name: 'RG', nodes: ['G', '0'], parameters: { value: '1MEG' } },
      { type: 'resistor', name: 'RS', nodes: ['S', '0'], parameters: { value: '1k' } },
      { type: 'resistor', name: 'RD', nodes: ['VDD', 'D'], parameters: { value: '2.2k' } },
      { type: 'n_channel_jfet', name: 'J1', nodes: ['D', 'G', 'S'], parameters: { part: '2N3819' } },
    ],
    analysis: { kind: 'op' },
    expected: { S: 1.7561556618837597, D: 8.136457522069982 },
    deckLines: ['VDD VDD 0 12', 'RG G 0 1MEG', 'RS S 0 1k', 'RD VDD D 2.2k', 'J1 D G S 2N3819'],
    modelCard: '.model 2N3819 NJF(BETA=1.1m VTO=-3 LAMBDA=0.005)',
  },
  {
    /*
     * The switch vector: a divider whose lower arm is shorted by an S switch
     * driven past threshold. Closed through ron = 1 Ω the divider sits at
     * 5·(1k‖1)/(1k+(1k‖1)) ≈ 4.99 mV — the checked-in value is that closed
     * form, not a solver snapshot. Open it would sit at 2.5 V.
     */
    stem: 'switch_divider_closed',
    components: [
      { type: 'voltage_source', name: 'VDD', nodes: ['VDD', '0'], parameters: { value: 5 } },
      { type: 'voltage_source', name: 'VC', nodes: ['C', '0'], parameters: { value: 1 } },
      { type: 'resistor', name: 'R1', nodes: ['VDD', 'OUT'], parameters: { value: '1k' } },
      { type: 'resistor', name: 'R2', nodes: ['OUT', '0'], parameters: { value: '1k' } },
      {
        type: 'voltage_controlled_switch',
        name: 'S1',
        nodes: ['OUT', '0', 'C', '0'],
        parameters: { ron: 1, roff: '1MEG', vt: 0.5 },
      },
    ],
    analysis: { kind: 'op' },
    expected: { OUT: 0.004990019960074859 },
    deckLines: ['VDD VDD 0 5', 'VC C 0 1', 'R1 VDD OUT 1k', 'R2 OUT 0 1k', 'S1 OUT 0 C 0 SMOD'],
    modelCard: '.model SMOD SW(RON=1 ROFF=1MEG VT=0.5 VH=0)',
  },
  {
    /*
     * The B-source vector: a divider buffered through `V = V(MID) + 1`.
     * 4 V across two 1 kΩ arms puts MID at 2 V; the source adds its volt,
     * so OUT must sit at 3 V into a light load — the offset proves the
     * expression evaluated rather than passing the probe through.
     */
    stem: 'bsource_buffer_offset',
    components: [
      { type: 'voltage_source', name: 'V1', nodes: ['IN', '0'], parameters: { value: 4 } },
      { type: 'resistor', name: 'R1', nodes: ['IN', 'MID'], parameters: { value: '1k' } },
      { type: 'resistor', name: 'R2', nodes: ['MID', '0'], parameters: { value: '1k' } },
      { type: 'behavioral_source', name: 'B1', nodes: ['OUT', '0'], parameters: { v: 'V(MID) + 1' } },
      { type: 'resistor', name: 'RL', nodes: ['OUT', '0'], parameters: { value: '10k' } },
    ],
    analysis: { kind: 'op' },
    expected: { OUT: 3 },
    deckLines: ['V1 IN 0 4', 'R1 IN MID 1k', 'R2 MID 0 1k', 'B1 OUT 0 V=V(MID)+1', 'RL OUT 0 10k'],
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
             * `.dc <source> <start> <stop> <step>`, exactly the card The engine's own
             * exporter writes, so the deck a user exports is the deck that gets
             * checked.
             */
            `.dc ${vector.analysis.source} ${vector.analysis.startValue} ` +
              `${vector.analysis.stopValue} ${vector.analysis.stepValue}`,
          ]
        : [
            /*
             * `.tran Tstep Tstop Tstart Tmaxstep`: the maximum step is pinned to
             * the engine step, so a reference trace stays comparable at
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

/** Sample one of The engine's waveforms at the step nearest `time` (seconds). */
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

describe('golden vectors', () => {
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

  it.each(opVectors)('$stem matches the reference within 1 % / 1 mV', async (vector) => {
    const expected = vector.expected
    if (!expected) throw new Error(`${vector.stem} declares an operating point but no expected values`)

    // The deck text is the artefact a human re-runs by hand, so keep the
    // deck renderer covered even though the suite never executes a deck.
    expect(renderDeck(vector)).toContain(vector.stem)

    const first = await spiceEngine.simulate({
      title: vector.stem,
      components: vector.components,
      analyses: [{ type: 'dc' }],
    })
    const second = await spiceEngine.simulate({
      title: vector.stem,
      components: JSON.parse(JSON.stringify(vector.components)) as typeof vector.components,
      analyses: [{ type: 'dc' }],
    })
    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    if (JSON.stringify(first.operatingPoint) !== JSON.stringify(second.operatingPoint)) {
      throw new Error(
        `${vector.stem} is not deterministic: first=${JSON.stringify(first.operatingPoint)} second=${JSON.stringify(second.operatingPoint)}`,
      )
    }
    const result = second
    expect(result.operatingPoint).toBeDefined()
    for (const [node, reference] of Object.entries(expected)) {
      const actual = result.operatingPoint?.[node]
      expect(actual, `node ${node}`).toBeDefined()
      expect(Math.abs((actual as number) - reference)).toBeLessThanOrEqual(opTolerance(reference))
    }
  })

  it.each(transientVectors)('$stem transient matches the reference within 2 % / 5 mV', async (vector) => {
    const analysis = vector.analysis
    const samples = vector.samples
    if (analysis.kind !== 'transient' || !samples) {
      throw new Error(`${vector.stem} declares a transient but no sample set`)
    }

    const result = await spiceEngine.simulate({
      title: vector.stem,
      components: vector.components,
      analyses: [{ type: 'transient', stopTime: analysis.stopTime, stepTime: analysis.stepTime }],
    })
    expect(result.success).toBe(true)
    expect(result.waveforms.length).toBeGreaterThan(0)
    /*
     * Each sample names a node, an instant and reference voltage there, and the
     * failure label says which of the three missed — a mis-timed waveform and a
     * wrong bias point look identical from a bare number.
     */
    for (const sample of samples) {
      const actual = waveformAt(result, `V(${sample.node})`, sample.time)
      const label = `V(${sample.node}) at ${(sample.time * 1e6).toFixed(3)} us (reference ${sample.value})`
      expect(Math.abs(actual - sample.value), label).toBeLessThanOrEqual(tranTolerance(sample.value))
    }
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
