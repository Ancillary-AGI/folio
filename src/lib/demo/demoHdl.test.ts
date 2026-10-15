import { describe, expect, it } from 'vitest';
import { buildDemoHdl, DEMO_VERILOG, DEMO_VHDL } from './demoHdl';
import { parseVerilogModule } from '../fpga/verilogSubset';
import { parseVhdl } from '../fpga/vhdlSubset';
import { simulateDigital } from '../simulation/digitalLogic';

describe('demo HDL — both languages, one truth table, bitstream out', () => {
  it('elaborates the same 3-gate half-adder in Verilog and VHDL', () => {
    const v = parseVerilogModule(DEMO_VERILOG);
    const h = parseVhdl(DEMO_VHDL);
    expect(v.netlist.gates).toHaveLength(3);
    expect(h.netlist.gates).toHaveLength(3);
  });
  it('runs a buffer chain on the digital engine (no fought drivers)', () => {
    const { netlist } = parseVerilogModule(
      'module chain(input a, output y);\nwire m;\nbuf u1(m, a);\nbuf u2(y, m);\nendmodule',
    );
    const r = simulateDigital({ gates: netlist.gates, stimuli: [{ node: 'a', value: 1, time: 0 }] }, 10);
    expect(r.success).toBe(true);
    expect(r.finalValues['y']).toBe(1);
  });
  it('synthesizes both modules to LUTs and emits a bitstream', () => {
    const demo = buildDemoHdl();
    expect(demo.verilogGates).toBe(3);
    expect(demo.vhdlGates).toBe(3);
    expect(demo.synthesis.success).toBe(true);
    expect(demo.synthesis.utilization.luts).toBeGreaterThan(0);
    expect(demo.bitstreamBytes).toBeGreaterThan(1024);
    expect(demo.verdict).toMatch(/^PASS/);
  });
});
