import { describe, expect, it } from 'vitest'
import { parseDigitalNetlist } from './digitalNetlistParser'

describe('digitalNetlistParser', () => {
  const FULL_ADDER = [
    '# full adder over discrete gates',
    'GATE x1 XOR out=s in=a,b delay=1',
    'GATE x2 XOR out=sum in=s,cin delay=1',
    'GATE a1 AND out=ab in=a,b delay=1',
    'GATE a2 AND out=sc in=s,cin delay=1',
    'GATE o1 OR  out=cout in=ab,sc delay=1',
    'RUN until=10',
  ].join('\n')

  it('parses a full-adder deck into gates and a run time', () => {
    const { netlist, until } = parseDigitalNetlist(FULL_ADDER)
    expect(until).toBe(10)
    expect(netlist.gates).toHaveLength(5)
    const xor = netlist.gates[0]
    expect(xor).toMatchObject({ id: 'x1', type: 'XOR', output: 's', inputs: ['a', 'b'], delay: 1 })
  })

  it('parses a clock, flip-flop and stimulus', () => {
    const { netlist } = parseDigitalNetlist(
      ['CLOCK clk out=clk period=10 duty=0.5 start=0', 'FF q0 D clock=clk q=q0 qbar=nq0 D=d delay=2', 'SET d 1 @3'].join('\n'),
    )
    expect(netlist.clocks?.[0]).toMatchObject({ output: 'clk', period: 10, duty: 0.5, startState: 0 })
    const ff = netlist.flipFlops![0]
    expect(ff).toMatchObject({ id: 'q0', type: 'D', clock: 'clk', q: 'q0', qbar: 'nq0', delay: 2 })
    expect(ff.inputs).toEqual({ D: 'd' })
    expect(netlist.stimuli?.[0]).toEqual({ node: 'd', value: 1, time: 3 })
  })

  it('defaults delay to 1 and until to 100', () => {
    const { netlist, until } = parseDigitalNetlist('GATE n1 NOT out=y in=a')
    expect(netlist.gates[0].delay).toBe(1)
    expect(until).toBe(100)
  })

  it('fails loud on an unknown statement', () => {
    expect(() => parseDigitalNetlist('FROB x1 out=y')).toThrowError(/unknown statement "FROB"/)
  })

  it('fails loud on an unknown gate type', () => {
    expect(() => parseDigitalNetlist('GATE g1 MAJ out=y in=a,b')).toThrowError(/unknown gate type "MAJ"/)
  })

  it('fails loud on a gate missing inputs', () => {
    expect(() => parseDigitalNetlist('GATE g1 AND out=y')).toThrowError(/requires in=/)
  })

  it('fails loud on a bad logic value', () => {
    expect(() => parseDigitalNetlist('SET a 2')).toThrowError(/expected 0\/1\/X\/Z/)
  })

  it('fails loud on a non-positive clock period', () => {
    expect(() => parseDigitalNetlist('CLOCK c out=clk period=0')).toThrowError(/period must be > 0/)
  })

  it('fails loud on a unary gate with more than one input', () => {
    expect(() => parseDigitalNetlist('GATE g1 NOT out=y in=a,b')).toThrowError(/exactly one input/)
  })

  it('fails loud on an unknown flip-flop edge', () => {
    expect(() =>
      parseDigitalNetlist('FF f1 D clock=clk q=q qbar=nq D=d edge=both'),
    ).toThrowError(/edge must be rising or falling/)
  })

  it('rejects a clock duty with no low phase', () => {
    expect(() => parseDigitalNetlist('CLOCK c out=clk period=10 duty=1')).toThrowError(/duty must be in \(0,1\)/)
  })

  it('rejects negative or malformed stimulus times', () => {
    expect(() => parseDigitalNetlist('SET a 1 @-5')).toThrowError(/non-negative/)
    expect(() => parseDigitalNetlist('SET a 1 5')).toThrowError(/must use @/)
  })

  it('names the offending line number', () => {
    try {
      parseDigitalNetlist('GATE g1 NOT out=y in=a\nSET a 9')
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).toMatch(/^line 2:/)
    }
  })
})
