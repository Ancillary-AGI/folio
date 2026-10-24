import { describe, expect, it } from 'vitest'
import {
  normalizeModelCards,
  parseSpiceModelLibrary,
  resolveModelCard,
  type SpiceModelCard,
} from './modelLibrary'
import { buildCircuitModel } from './circuitModel'
import { spiceEngine, type CircuitNetlist, type Component } from './spiceEngine'
import type { BjtDevice, DiodeDevice } from './devices'

describe('SPICE model library parser', () => {
  it('parses supported cards and SI engineering suffixes', () => {
    const result = parseSpiceModelLibrary([
      '.model 2N3904 NPN (IS=1E-14 BF=300 VAF=100)',
      '.model IRF540 NMOS (VTO=2.8 KP=1.1m LAMBDA=5m)',
      '.model DFAST D (IS=2n N=1.2)',
    ].join('\n'))

    expect(result.errors).toEqual([])
    expect(result.models.get('2N3904')?.parameters.bf).toBe(300)
    expect(result.models.get('IRF540')?.parameters.kp).toBeCloseTo(1.1e-3)
    expect(result.models.get('DFAST')?.parameters.is).toBeCloseTo(2e-9)
  })

  it('joins continuation lines and resolves names case-insensitively', () => {
    const result = parseSpiceModelLibrary('.model BC547 NPN (IS=1e-14\n+ BF=200 VAF=80)')

    expect(result.errors).toEqual([])
    expect(result.models.get('BC547')?.parameters.bf).toBe(200)
  })

  it('reports duplicate, malformed, and unsupported constructs instead of silently skipping them', () => {
    const result = parseSpiceModelLibrary([
      '.model BAD NPN (BF=100 BF=200)',
      '.model ALSO_BAD NMOS (KP=not-a-number)',
      '.model POWER VDMOS (VTO=2)',
      '.SUBCKT AMP IN OUT VCC VEE',
    ].join('\n'))

    expect(result.errors).toHaveLength(2)
    expect(result.unsupported).toEqual(['POWER: VDMOS', '.SUBCKT'])
    expect(result.models.size).toBe(0)
  })
})

const card = (name: string, type: SpiceModelCard['type'], parameters: Record<string, number>): SpiceModelCard => ({
  name,
  type,
  parameters,
})

const npn = (name: string, model: string, extra: Record<string, string | number | boolean> = {}): Component => ({
  type: 'npn_transistor',
  name,
  nodes: ['C', 'B', '0'],
  parameters: { model, ...extra },
})

const modelNetlist = (components: Component[], models: Record<string, SpiceModelCard>): CircuitNetlist => ({
  title: 'model-card integration',
  components,
  analyses: [{ type: 'dc' }],
  models,
})

describe('SPICE model cards in the solver', () => {
  it('resolves a card by part property, symbol name, or a bin-suffixed token', () => {
    const library = parseSpiceModelLibrary('.model 2N3904 NPN (BF=300)')
    const cards = normalizeModelCards(Object.fromEntries(library.models))

    expect(resolveModelCard({ name: 'Q1', parameters: { type: '2N3904' } }, cards)?.name).toBe('2N3904')
    expect(resolveModelCard({ name: 'Q2', parameters: { model: '2n3904A' } }, cards)?.name).toBe('2N3904')
    expect(resolveModelCard({ name: '2N3904', parameters: {} }, cards)?.name).toBe('2N3904')
    expect(resolveModelCard({ name: 'Q3', parameters: { type: '2N2222' } }, cards)).toBeUndefined()
  })

  it('uses card values in place of the SPICE defaults', () => {
    const { model, errors } = buildCircuitModel(
      modelNetlist([npn('Q1', 'MYNPN')], {
        MYNPN: card('MYNPN', 'NPN', { is: 1e-14, bf: 20, vaf: 50 }),
      }),
    )

    expect(errors).toEqual([])
    const device = model.devices.find((candidate): candidate is BjtDevice => candidate.kind === 'bjt')
    expect(device?.polarity).toBe('npn')
    expect(device?.model.bf).toBe(20)
    expect(device?.model.vaf).toBe(50)
  })

  it('lets an explicit symbol property beat the card, and reports unmodelled card fields', () => {
    const { model, errors } = buildCircuitModel(
      modelNetlist([npn('Q1', 'MYNPN', { bf: 75 })], {
        MYNPN: card('MYNPN', 'NPN', { is: 1e-14, bf: 20, xtb: 1.5 }),
      }),
    )

    expect(errors).toEqual([])
    const device = model.devices.find((candidate): candidate is BjtDevice => candidate.kind === 'bjt')
    expect(device?.model.bf).toBe(75)
    expect(model.notes.join(' ')).toContain('xtb')
  })

  it('takes polarity from the card and rejects a card of the wrong family', () => {
    const pnp = buildCircuitModel(
      modelNetlist([npn('Q1', 'MYPNP')], { MYPNP: card('MYPNP', 'PNP', { is: 1e-14, bf: 100 }) }),
    )
    const pnpDevice = pnp.model.devices.find(
      (candidate): candidate is BjtDevice => candidate.kind === 'bjt',
    )
    expect(pnp.errors).toEqual([])
    expect(pnpDevice?.polarity).toBe('pnp')

    const wrong = buildCircuitModel(
      modelNetlist(
        [{ type: 'n_channel_mosfet', name: 'M1', nodes: ['D', 'G', '0'], parameters: { model: 'QMODEL' } }],
        { QMODEL: card('QMODEL', 'NPN', { is: 1e-14, bf: 100 }) },
      ),
    )
    expect(wrong.errors.join(' ')).toContain('not a mosfet model')
  })

  it('supplies diode parameters that would otherwise be required', () => {
    const component: Component = { type: 'diode', name: 'D1', nodes: ['A', '0'], parameters: { model: 'DFAST' } }
    const withoutCard = buildCircuitModel(modelNetlist([component], {}))
    expect(withoutCard.errors.join(' ')).toContain('saturation current')

    const withCard = buildCircuitModel(
      modelNetlist([component], { DFAST: card('DFAST', 'D', { is: 2e-9, n: 1.2 }) }),
    )
    expect(withCard.errors).toEqual([])
    const diode = withCard.model.devices.find(
      (candidate): candidate is DiodeDevice => candidate.kind === 'diode',
    )
    expect(diode?.saturationCurrent).toBeCloseTo(2e-9)
    expect(diode?.emissionCoefficient).toBe(1.2)
  })

  it('changes the solved operating point when the card changes beta', async () => {
    const circuit = (model: string): CircuitNetlist =>
      modelNetlist(
        [
          { type: 'voltage_source', name: 'V1', nodes: ['VCC', '0'], parameters: { value: 5 } },
          { type: 'resistor', name: 'R1', nodes: ['VCC', 'C'], parameters: { value: 1000 } },
          { type: 'resistor', name: 'R2', nodes: ['VCC', 'B'], parameters: { value: 1e6 } },
          npn('Q1', model),
        ],
        {
          LOWBETA: card('LOWBETA', 'NPN', { is: 1e-14, bf: 20 }),
          HIGHBETA: card('HIGHBETA', 'NPN', { is: 1e-14, bf: 300 }),
        },
      )

    const low = await spiceEngine.simulate(circuit('LOWBETA'))
    const high = await spiceEngine.simulate(circuit('HIGHBETA'))

    expect(low.success).toBe(true)
    expect(high.success).toBe(true)
    // Higher beta draws more collector current, so the collector sits lower.
    expect(high.operatingPoint?.C ?? 0).toBeLessThan(low.operatingPoint?.C ?? 0)
  })

  it('exports the card and a matching transistor element line', () => {
    const deck = spiceEngine.generateSPICENetlist(
      modelNetlist([npn('Q1', 'MYNPN')], {
        MYNPN: card('MYNPN', 'NPN', { is: 1e-14, bf: 20 }),
      }),
    )

    expect(deck).toContain('Q1 C B 0 MYNPN')
    expect(deck).toMatch(/\.model MYNPN NPN \(is=1e-14 bf=20\)/)
  })
})
