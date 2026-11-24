/**
 * KiCad netlist proofs.
 * Parse a KiCad export, emit one from Folio, round-trip it.
 */
import { describe, expect, it } from 'vitest'
import { emitKicadNetlist, parseKicadNetlist } from './kicadNetlist'

const KICAD_SAMPLE = `(export (version D)
  (components
    (comp (ref R1) (value "10k") (footprint "R_0805"))
    (comp (ref R2) (value "10k") (footprint "R_0805")))
  (nets
    (net 1 "VCC"
      (node (ref R1) (pin 1)))
    (net 2 "OUT"
      (node (ref R1) (pin 2))
      (node (ref R2) (pin 1)))
    (net 3 "GND"
      (node (ref R2) (pin 2)))))`

describe('KiCad netlist', () => {
  it('parses components, nets and nodes', () => {
    const parsed = parseKicadNetlist(KICAD_SAMPLE)
    expect(parsed.components).toHaveLength(2)
    expect(parsed.components[0]).toMatchObject({ ref: 'R1', value: '10k' })
    expect(parsed.nets).toHaveLength(3)
    expect(parsed.nets[1]).toMatchObject({ code: '2', name: 'OUT' })
    expect(parsed.nets[1].nodes).toHaveLength(2)
  })

  it('rejects malformed input instead of guessing', () => {
    expect(() => parseKicadNetlist('(export (components')).toThrow(/unterminated/i)
    expect(() => parseKicadNetlist('(netlist)')).toThrow(/export/i)
    expect(() => parseKicadNetlist('(export (components (comp (value "10k"))))')).toThrow(/ref/i)
  })

  it('emits Folio circuits and round-trips through the parser', () => {
    const emitted = emitKicadNetlist({
      title: 'divider',
      components: [
        { type: 'resistor', name: 'R1', nodes: ['VCC', 'OUT'], parameters: { value: '10k' } },
        { type: 'resistor', name: 'R2', nodes: ['OUT', '0'], parameters: { value: '10k' } },
      ],
      analyses: [{ type: 'dc' }],
    })
    expect(emitted).toContain('(export')
    const parsed = parseKicadNetlist(emitted)
    expect(parsed.components.map((c) => c.ref).sort()).toEqual(['R1', 'R2'])
    const out = parsed.nets.find((net) => net.name === 'OUT')
    expect(out?.nodes).toHaveLength(2)
  })
})
