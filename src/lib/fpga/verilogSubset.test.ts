import { describe, expect, it } from 'vitest';
import { parseVerilogModule } from './verilogSubset';
import { simulateDigital } from '../simulation/digitalLogic';

const HALF_ADDER = `module half_adder(input a, input b, output sum, output carry);
  wire axb;
  xor x1(axb, a, b);
  and a1(carry, a, b);
  assign sum = axb;
endmodule
`;

describe('Verilog structural subset', () => {
  it('elaborates a half-adder and runs its truth table on the digital engine', () => {
    const { name, ports, netlist } = parseVerilogModule(HALF_ADDER);
    expect(name).toBe('half_adder');
    expect(ports.map((p) => p.name)).toEqual(['a', 'b', 'sum', 'carry']);
    for (const [a, b, sum, carry] of [[0, 0, 0, 0], [0, 1, 1, 0], [1, 0, 1, 0], [1, 1, 0, 1]] as const) {
      const result = simulateDigital(
        { gates: netlist.gates, stimuli: [{ node: 'a', value: a as 0 | 1, time: 0 }, { node: 'b', value: b as 0 | 1, time: 0 }] },
        10,
      );
      expect(result.success).toBe(true);
      expect(result.finalValues['sum']).toBe(sum);
      expect(result.finalValues['carry']).toBe(carry);
    }
  });
  it('parses bus ports to widths and rejects malformed input', () => {
    const { ports } = parseVerilogModule('module m(input [7:0] d, output y);\nassign y = d;\nendmodule');
    expect(ports.find((p) => p.name === 'd')?.width).toBe(8);
    expect(() => parseVerilogModule('wire x;')).toThrow(/no module header/);
    expect(() => parseVerilogModule('module m(input a, output y);\nendmodule')).toThrow(/never driven/);
    expect(() => parseVerilogModule('module m(input a, output y);\nbuf b1(y, a);\nbuf b2(y, a);\nendmodule')).toThrow(/driven twice/);
    expect(() => parseVerilogModule('module m(input a, output y);\nand a1(y, a);\nendmodule')).toThrow(/needs 2/);
    expect(() => parseVerilogModule('module m(input a, output y);\nbuf b1(y, a);')).toThrow(/endmodule/);
  });
});
