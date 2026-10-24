/**
 * Demo HDL: half-adder in BOTH structural languages.
 *
 * Both sources describe the SAME feed-forward half-adder (AND carry, XOR sum,
 * buffered carry-out), elaborate on the real parsers, verify on the real
 * digital engine, and produce netlist-derived resource estimates. The emitted
 * artifact is a portable design manifest — vendor place-and-route and bitstream
 * assembly are explicitly out of scope. Proven by `demoHdl.test.ts`.
 */
import { fpgaDesignFlow, type DesignManifest, type SynthesisResult } from '../fpga/fpgaDesignFlow';
import { parseVerilogModule } from '../fpga/verilogSubset';
import { parseVhdl } from '../fpga/vhdlSubset';
import { simulateDigital } from '../simulation/digitalLogic';

export const DEMO_VERILOG = `module blink_div(input a, input b, output q0, output q1);
  wire m0;
  and a0(m0, a, b);
  buf b0(q0, m0);
  xor x0(q1, a, b);
endmodule
`;

export const DEMO_VHDL = `entity blink_div is port(a : in bit; b : in bit; q0 : out bit; q1 : out bit); end blink_div;
architecture s of blink_div is begin
a0 : and2 port map(m0, a, b);
b0 : buf port map(q0, m0);
x0 : xor2 port map(q1, a, b);
end s;
`;

export interface DemoHdl {
  verilogGates: number;
  vhdlGates: number;
  synthesis: SynthesisResult;
  manifest: DesignManifest;
  manifestBytes: number;
  verdict: string;
}

export function buildDemoHdl(deviceId = 'xc7a35t'): DemoHdl {
  const v = parseVerilogModule(DEMO_VERILOG);
  const h = parseVhdl(DEMO_VHDL);
  // Functional check on the shared engine: the half-adder truth table.
  for (const [a, b, sum, carry] of [[0, 0, 0, 0], [0, 1, 1, 0], [1, 0, 1, 0], [1, 1, 0, 1]] as const) {
    const vSim = simulateDigital({ gates: v.netlist.gates, stimuli: [{ node: 'a', value: a, time: 0 }, { node: 'b', value: b, time: 0 }] }, 10);
    const hSim = simulateDigital({ gates: h.netlist.gates, stimuli: [{ node: 'a', value: a, time: 0 }, { node: 'b', value: b, time: 0 }] }, 10);
    if (!vSim.success || vSim.finalValues['q1'] !== sum || vSim.finalValues['q0'] !== carry) {
      throw new Error(`Demo Verilog fails the half-adder table at a=${a} b=${b}.`);
    }
    if (!hSim.success || hSim.finalValues['q1'] !== sum || hSim.finalValues['q0'] !== carry) {
      throw new Error(`Demo VHDL fails the half-adder table at a=${a} b=${b}.`);
    }
  }
  const synthesis = fpgaDesignFlow.synthesize(
    [
      { name: 'blink_div', language: 'verilog', source: DEMO_VERILOG },
      { name: 'blink_div', language: 'vhdl', source: DEMO_VHDL },
    ],
    deviceId,
  );
  if (!synthesis.success) throw new Error(`Demo HDL does not synthesize: ${synthesis.errors.join('; ')}`);
  const manifest = fpgaDesignFlow.generateManifest(synthesis);
  if (!manifest) throw new Error('Demo synthesis produced no manifest.');
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest)).length;
  const verdict = `PASS: Verilog ${v.netlist.gates?.length ?? 0} gates + VHDL ${h.netlist.gates?.length ?? 0} gates → ${synthesis.utilization.luts} estimated LUTs, ${manifestBytes} B manifest (no vendor bitstream).`;
  return {
    verilogGates: v.netlist.gates?.length ?? 0,
    vhdlGates: h.netlist.gates?.length ?? 0,
    synthesis, manifest, manifestBytes, verdict,
  };
}
