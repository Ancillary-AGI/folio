import { describe, expect, it } from 'vitest';
import { parseVerilogModule } from './verilogSubset';
import { ACC_CPU_VERILOG, cpuBits } from './accCpu';
import { FIR_DSP_VERILOG } from './firDsp';
import { simulateDigital, valueAt, type DigitalResult } from '../simulation/digitalLogic';

const HALF_ADDER = `module half_adder(input a, input b, output sum, output carry);
  wire axb;
  xor x1(axb, a, b);
  and a1(carry, a, b);
  assign sum = axb;
endmodule
`;

const bitsOf = cpuBits;
const ACC_CPU = ACC_CPU_VERILOG;

const driveBus = (
  stimuli: Array<{ node: string; time: number; value: 0 | 1 }>,
  name: string,
  width: number,
  value: number,
  time: number,
): void => {
  bitsOf(value, width).forEach((bit, index) => stimuli.push({ node: `${name}[${index}]`, time, value: bit }));
};

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

describe('Verilog expressions, buses and clocked logic', () => {
  it('lowers continuous expressions with reductions and bit selects', () => {
    const { netlist } = parseVerilogModule(`module expr(input a, input b, input c, output y, output z, output w);
      wire [1:0] v;
      assign v[0] = a;
      assign v[1] = b;
      assign y = (a & b) | ~c;
      assign z = ~|v;
      assign w = (a == b) ? 1'b1 : 1'b0;
    endmodule`);
    for (const [a, b, c, y, z, w] of [
      [0, 0, 0, 1, 1, 1], [0, 1, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0],
      [1, 1, 1, 1, 0, 1], [1, 1, 0, 1, 0, 1], [1, 0, 1, 0, 0, 0],
    ] as const) {
      const result = simulateDigital({
        gates: netlist.gates,
        stimuli: [
          { node: 'a', time: 0, value: a }, { node: 'b', time: 0, value: b }, { node: 'c', time: 0, value: c },
        ],
      }, 20);
      expect(result.success).toBe(true);
      expect(result.finalValues['y']).toBe(y);
      expect(result.finalValues['z']).toBe(z);
      expect(result.finalValues['w']).toBe(w);
    }
  });

  it('infers one D flip-flop per register bit and adds the clock it is written on', () => {
    const { netlist } = parseVerilogModule(ACC_CPU);
    expect(netlist.flipFlops).toHaveLength(8);
    expect(netlist.clocks).toHaveLength(1);
    expect(netlist.clocks?.[0]).toMatchObject({ output: 'clk' });
    // The generated period follows the elaborated depth, so this datapath gets
    // more than the 10-unit floor.
    expect(netlist.clocks?.[0].period).toBeGreaterThan(10);
    expect(netlist.flipFlops?.every((ff) => ff.type === 'D' && ff.clock === 'clk')).toBe(true);
  });

  it('runs an 8-bit CPU through reset, load, add, and, and xor on real edges', () => {
    const { netlist } = parseVerilogModule(ACC_CPU);
    const clock = netlist.clocks?.[0];
    expect(clock).toBeDefined();
    // The elaborated clock is wide enough for the ripple-carry path to settle,
    // so every stimulus is placed just after an edge and sampled on the next.
    const half = (clock?.period ?? 10) / 2;
    const edge = (count: number) => half + count * (clock?.period ?? 10);
    const stimuli: Array<{ node: string; time: number; value: 0 | 1 }> = [
      { node: 'rst', time: 0, value: 1 },
      { node: 'op[0]', time: 0, value: 0 }, { node: 'op[1]', time: 0, value: 0 },
    ];
    driveBus(stimuli, 'operand', 8, 0, 0);
    const at = (count: number) => edge(count) + 1;
    stimuli.push({ node: 'rst', time: at(0), value: 0 });
    driveBus(stimuli, 'op', 2, 1, at(0));
    driveBus(stimuli, 'operand', 8, 5, at(0)); // load 5
    driveBus(stimuli, 'op', 2, 0, at(1));
    driveBus(stimuli, 'operand', 8, 3, at(1)); // 5 + 3
    driveBus(stimuli, 'op', 2, 2, at(2));
    driveBus(stimuli, 'operand', 8, 15, at(2)); // 8 & 15
    driveBus(stimuli, 'op', 2, 3, at(3));
    driveBus(stimuli, 'operand', 8, 3, at(3)); // 8 ^ 3

    const result = simulateDigital({ ...netlist, stimuli }, edge(5));
    expect(result.success).toBe(true);
    expect(bitsOf(11, 8).map((_, index) => result.finalValues[`acc[${index}]`])).toEqual(bitsOf(11, 8));
    expect(result.finalValues['zero']).toBe(0);
  });

  it('lowers unsigned addition at the assignment width, keeping the carry in a wider target', () => {
    const { netlist } = parseVerilogModule(`module add8(input [7:0] a, input [7:0] b, output [7:0] sum, output [8:0] wide);
      assign sum = a + b;
      assign wide = a + b;
    endmodule`);
    const stimuli = [
      ...bitsOf(200, 8).map((value, i) => ({ node: `a[${i}]`, time: 0, value })),
      ...bitsOf(100, 8).map((value, i) => ({ node: `b[${i}]`, time: 0, value })),
    ];
    const result = simulateDigital({ ...netlist, stimuli }, 30);
    expect(result.success).toBe(true);
    expect(bitsOf(44, 8).map((_, i) => result.finalValues[`sum[${i}]`])).toEqual(bitsOf(44, 8));
    expect(bitsOf(300, 9).map((_, i) => result.finalValues[`wide[${i}]`])).toEqual(bitsOf(300, 9));
  });

  it('subtracts modulo the width and chains mixed additive operators left to right', () => {
    const { netlist } = parseVerilogModule(`module sub8(input [7:0] a, input [7:0] b, input [7:0] c, output [7:0] diff);
      assign diff = a - b + c;
    endmodule`);
    const run = (a: number, b: number, c: number) => {
      const stimuli = [
        ...bitsOf(a, 8).map((value, i) => ({ node: `a[${i}]`, time: 0, value })),
        ...bitsOf(b, 8).map((value, i) => ({ node: `b[${i}]`, time: 0, value })),
        ...bitsOf(c, 8).map((value, i) => ({ node: `c[${i}]`, time: 0, value })),
      ];
      const result = simulateDigital({ ...netlist, stimuli }, 30);
      expect(result.success).toBe(true);
      return bitsOf(0, 8).map((_, i) => result.finalValues[`diff[${i}]`]);
    };
    expect(run(9, 3, 4)).toEqual(bitsOf(10, 8)); // (9 - 3) + 4
    expect(run(3, 5, 0)).toEqual(bitsOf(254, 8)); // borrow wraps at 8 bits
    expect(run(0, 1, 0)).toEqual(bitsOf(255, 8));
  });

  it('increments a register with "+ 1" on real clock edges', () => {
    const { netlist } = parseVerilogModule(`module counter(input clk, input rst, output [7:0] q);
      reg [7:0] count;
      always @(posedge clk) begin
        if (rst) count <= 8'd0;
        else count <= count + 8'd1;
      end
      assign q = count;
    endmodule`);
    const clock = netlist.clocks?.[0];
    expect(clock).toBeDefined();
    const half = (clock?.period ?? 10) / 2;
    const edge = (count: number) => half + count * (clock?.period ?? 10);
    const stimuli: Array<{ node: string; time: number; value: 0 | 1 }> = [
      { node: 'rst', time: 0, value: 1 },
    ];
    stimuli.push({ node: 'rst', time: edge(0) + 1, value: 0 });
    // Settle the flop and its output buffer before the next rising edge.
    const result = simulateDigital({ ...netlist, stimuli }, edge(3) + 5);
    expect(result.success).toBe(true);
    expect(bitsOf(3, 8).map((_, i) => result.finalValues[`q[${i}]`])).toEqual(bitsOf(3, 8));
  });

  it('runs the 4-tap FIR delay line and weighted sum exactly', () => {
    const { netlist } = parseVerilogModule(FIR_DSP_VERILOG);
    expect(netlist.flipFlops).toHaveLength(24);
    const clock = netlist.clocks?.[0];
    expect(clock).toBeDefined();
    const half = (clock?.period ?? 10) / 2;
    const edge = (count: number) => half + count * (clock?.period ?? 10);
    const stimuli: Array<{ node: string; time: number; value: 0 | 1 }> = [
      { node: 'rst', time: 0, value: 1 },
      ...bitsOf(1, 8).map((value, i) => ({ node: `sample[${i}]`, time: 0, value })),
    ];
    stimuli.push({ node: 'rst', time: edge(0) + 1, value: 0 });
    // Hold one sample for three edges, then drop it and watch the taps decay.
    stimuli.push(...bitsOf(0, 8).map((value, i) => ({ node: `sample[${i}]`, time: edge(3) + 1, value })));
    const result = simulateDigital({ ...netlist, stimuli }, edge(6) + 5);
    expect(result.success).toBe(true);

    const bus = (width: number, time: number) =>
      bitsOf(0, width).reduce<number>((value, _, i) => {
        const bit = valueAt(result as DigitalResult, `y[${i}]`, time);
        return bit === 1 ? value | (1 << i) : value;
      }, 0);
    // Read mid-period: the 12-bit adder chain needs longer than a gate to settle.
    expect(bus(12, edge(3) + half - 1)).toBe(5); // taps 1,1,1 weighted 2,2,1 with x = 0
    expect(bus(12, edge(4) + half - 1)).toBe(3); // taps 0,1,1 weighted 2,1
    expect(bus(12, edge(5) + half - 1)).toBe(1); // only the last tap remains
    expect(bus(12, edge(6) + half - 1)).toBe(0);
  });

  it('shares arithmetic subtrees instead of re-emitting them per bit', () => {
    // A chained sum embeds the previous adder whole. Lowering without sharing
    // turned this six-term expression into ~178k gates; the cache keeps it in
    // the hundreds, which is what makes sequential DSP designs simulable.
    const { netlist } = parseVerilogModule(`module m(input [7:0] a, input [7:0] b, output [11:0] y);
      assign y = a + b + a + b + a + b;
    endmodule`);
    expect(netlist.gates.length).toBeLessThan(400);
  });

  it('decodes a clocked case with multi-label arms and a default', () => {
    const { netlist } = parseVerilogModule(`module dec(input clk, input rst, input [1:0] op, output reg [3:0] q);
      always @(posedge clk) begin
        if (rst) q <= 4'd0;
        else case (op)
          2'b00: q <= 4'd1;
          2'b01, 2'b10: q <= 4'd2;
          default: q <= 4'd3;
        endcase
      end
    endmodule`);
    const clock = netlist.clocks?.[0];
    expect(clock).toBeDefined();
    const half = (clock?.period ?? 10) / 2;
    const edge = (count: number) => half + count * (clock?.period ?? 10);
    const stimuli: Array<{ node: string; time: number; value: 0 | 1 }> = [
      { node: 'rst', time: 0, value: 1 },
    ];
    stimuli.push({ node: 'rst', time: edge(0) + 1, value: 0 });
    [0, 1, 2, 3].forEach((op, index) => driveBus(stimuli, 'op', 2, op, edge(index) + 1));
    const result = simulateDigital({ ...netlist, stimuli }, edge(4) + 5);
    expect(result.success).toBe(true);
    expect(bitsOf(3, 4).map((_, i) => result.finalValues[`q[${i}]`])).toEqual(bitsOf(3, 4));
  });

  it('holds the register when no case arm matches and there is no default', () => {
    const { netlist } = parseVerilogModule(`module hold(input clk, input [1:0] op, output reg [3:0] q);
      always @(posedge clk)
        case (op)
          2'b00: q <= 4'd9;
        endcase
    endmodule`);
    const clock = netlist.clocks?.[0];
    const half = (clock?.period ?? 10) / 2;
    const edge = (count: number) => half + count * (clock?.period ?? 10);
    const stimuli: Array<{ node: string; time: number; value: 0 | 1 }> = [
      { node: 'op[0]', time: 0, value: 1 }, { node: 'op[1]', time: 0, value: 0 },
    ];
    stimuli.push({ node: 'op[0]', time: edge(1) + 1, value: 0 }); // match -> 9
    stimuli.push({ node: 'op[0]', time: edge(2) + 1, value: 1 }); // unmapped -> hold
    const result = simulateDigital({ ...netlist, stimuli }, edge(3) + 5);
    expect(result.success).toBe(true);
    expect(bitsOf(9, 4).map((_, i) => result.finalValues[`q[${i}]`])).toEqual(bitsOf(9, 4));
  });

  it('fails loud on non-constant case labels and duplicate defaults', () => {
    expect(() => parseVerilogModule(`module m(input clk, input [1:0] op, output reg q);
      always @(posedge clk) case (op) q: q <= 1'b0; endcase
    endmodule`)).toThrow(/case labels must be integer constants/);
    expect(() => parseVerilogModule(`module m(input clk, input a, output reg q);
      always @(posedge clk) case (a) default: q <= 1'b0; default: q <= 1'b1; endcase
    endmodule`)).toThrow(/duplicate default/);
  });

  it('fails loud on constructs it cannot defend', () => {
    expect(() => parseVerilogModule(`module m(input clk, input d, output reg q);
      always @(posedge clk) q = d;
    endmodule`)).toThrow(/non-blocking/);
    expect(() => parseVerilogModule(`module m(input clk, input d, output y);
      wire q;
      always @(posedge clk) q <= d;
      assign y = q;
    endmodule`)).toThrow(/not a reg/);
    expect(() => parseVerilogModule(`module m(input a, output y);
      assign y = z;
    endmodule`)).toThrow(/undeclared signal z/);
    expect(() => parseVerilogModule(`module m(input clk, input d, output q);
      always @(posedge clk) q <= d * 2;
    endmodule`)).toThrow(/operator "\*" is not supported/);
  });
});
