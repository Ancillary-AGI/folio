import { describe, expect, it } from 'vitest';
import { parseVhdl } from './vhdlSubset';
import { simulateDigital } from '../simulation/digitalLogic';
import { fpgaDesignFlow } from './fpgaDesignFlow';

const NAND_LATCH = `entity latch is port(s_n : in bit; r_n : in bit; q : out bit; qb : out bit); end latch;
architecture s of latch is begin
u1 : nand2 port map(q, s_n, qb);
u2 : nand2 port map(qb, r_n, q);
end s;
`;
describe('VHDL structural subset', () => {
  it('elaborates a NAND latch and runs on the digital engine', () => {
    const { entity, ports, netlist } = parseVhdl(NAND_LATCH);
    expect(entity).toBe('latch');
    expect(ports.map((p) => p.name)).toEqual(['s_n', 'r_n', 'q', 'qb']);
    const r = simulateDigital({ gates: netlist.gates, stimuli: [{ node: 's_n', value: 1, time: 0 }, { node: 'r_n', value: 1, time: 0 }] }, 10);
    expect(r.success).toBe(true);
  });
  it('rejects unknown cells, arity errors, double drivers, undriven outputs', () => {
    expect(() => parseVhdl('entity e is port(a: in bit; y: out bit); end e;\narchitecture s of e is begin\nu: foo port map(y, a);\nend s;')).toThrow(/unknown cell/);
    expect(() => parseVhdl('entity e is port(a: in bit; y: out bit); end e;\narchitecture s of e is begin\nu: and2 port map(y, a);\nend s;')).toThrow(/needs 3 pins/);
    expect(() => parseVhdl('entity e is port(a: in bit; y: out bit); end e;\narchitecture s of e is begin\nu1: buf port map(y, a);\nu2: buf port map(y, a);\nend s;')).toThrow(/driven twice/);
    expect(() => parseVhdl('wire x;')).toThrow(/no entity/);
  });
  it('flows into synthesis: VHDL gates drive LUT estimates, bad HDL fails', () => {
    const ok = fpgaDesignFlow.synthesize([{ name: 'latch', language: 'vhdl', source: NAND_LATCH }], 'xc7a35t');
    expect(ok.success).toBe(true);
    expect(ok.utilization.luts).toBeGreaterThan(0);
    const bad = fpgaDesignFlow.synthesize([{ name: 'bad', language: 'vhdl', source: 'entity e is port(a: in bit); end e;' }], 'xc7a35t');
    expect(bad.success).toBe(false);
  });
});
