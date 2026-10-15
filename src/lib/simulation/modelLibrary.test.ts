import { describe, expect, it } from 'vitest'
import { parseSpiceModelLibrary } from './modelLibrary'

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
