import { describe, expect, it } from 'vitest';
import { FPGADesignFlow, FPGA_DEVICES, type HDLModule } from './fpgaDesignFlow';

const HALF_ADDER = `module half_adder(input a, input b, output sum, output carry);
  xor g1(sum, a, b);
  and g2(carry, a, b);
endmodule
`;

const HALF_ADDER_VHDL = `entity half_adder is port(a : in bit; b : in bit; sum : out bit; carry : out bit); end half_adder;
architecture rtl of half_adder is begin
u1 : xor2 port map(sum, a, b);
u2 : and2 port map(carry, a, b);
end rtl;
`;

const verilog = (source = HALF_ADDER): HDLModule[] => [{ name: 'half_adder', language: 'verilog', source }];

describe('FPGA design flow — elaboration only, no invented results', () => {
  it('rejects an unknown device instead of falling back to a real part', () => {
    const flow = new FPGADesignFlow();
    const result = flow.synthesize(verilog(), 'not-a-device');
    expect(result.success).toBe(false);
    expect(result.device).toBeNull();
    expect(result.errors[0]).toContain('Unknown FPGA device');
    expect(result.netlistHash).toBe('');
  });

  it('counts gates from the elaborated netlist, not source length', () => {
    const flow = new FPGADesignFlow();
    const result = flow.synthesize(verilog(), 'xc7a35t');
    expect(result.success).toBe(true);
    expect(result.device?.id).toBe('xc7a35t');
    expect(result.utilization.gates).toBe(2);
    expect(result.utilization.luts).toBe(2);
    expect(result.utilization.flipFlops).toBe(0);
    expect(result.utilization.lutPercent).toBeCloseTo((2 / 20800) * 100, 6);
    expect(result.errors).toEqual([]);
  });

  it('reports timing as not modelled rather than inventing Fmax/WNS', () => {
    const flow = new FPGADesignFlow();
    const result = flow.synthesize(verilog(), 'xc7a35t');
    expect(result.timing).toEqual({ fmaxMhz: null, wnsNs: null, modelled: false });
    expect(result.warnings.join(' ')).toMatch(/Timing, BRAM and DSP inference are not modelled/);
  });

  it('does not infer BRAM or DSP usage', () => {
    const flow = new FPGADesignFlow();
    const result = flow.synthesize(verilog(HALF_ADDER.replace('endmodule', '  // multiplier * usage\nendmodule')), 'xc7a35t');
    expect(result.success).toBe(true);
    expect(result.utilization.bramKb).toBe(0);
    expect(result.utilization.dsp).toBe(0);
  });

  it('elaborates VHDL and systemverilog modules into the same resource counts', () => {
    const flow = new FPGADesignFlow();
    const vhdl = flow.synthesize([{ name: 'half_adder', language: 'vhdl', source: HALF_ADDER_VHDL }], 'xc7a35t');
    const sv = flow.synthesize([{ name: 'half_adder', language: 'systemverilog', source: HALF_ADDER }], 'xc7a35t');
    expect(vhdl.success).toBe(true);
    expect(vhdl.utilization.gates).toBe(2);
    expect(sv.success).toBe(true);
    expect(sv.utilization.gates).toBe(2);
  });

  it('sums gate counts across modules', () => {
    const flow = new FPGADesignFlow();
    const result = flow.synthesize([
      { name: 'half_adder', language: 'verilog', source: HALF_ADDER },
      { name: 'half_adder', language: 'vhdl', source: HALF_ADDER_VHDL },
    ], '10cl016');
    expect(result.success).toBe(true);
    expect(result.utilization.gates).toBe(4);
  });

  it('fails on empty source, unsupported languages, and parse errors', () => {
    const flow = new FPGADesignFlow();
    expect(flow.synthesize([], 'xc7a35t')).toMatchObject({ success: false });
    expect(flow.synthesize([{ name: 'x', language: 'verilog', source: '  ' }], 'xc7a35t').errors)
      .toContain('No HDL source provided');
    expect(flow.synthesize([{ name: 'x', language: 'tcl', source: HALF_ADDER } as unknown as HDLModule], 'xc7a35t').errors.join(' '))
      .toMatch(/unsupported language/i);
    expect(flow.synthesize(verilog('module broken(input a);'), 'xc7a35t').success).toBe(false);
  });

  it('produces a deterministic netlist hash scoped to the device', () => {
    const flow = new FPGADesignFlow();
    const a = flow.synthesize(verilog(), 'xc7a35t');
    const b = flow.synthesize(verilog(), 'xc7a35t');
    const c = flow.synthesize(verilog(), '10cl016');
    expect(a.netlistHash).toMatch(/^[0-9a-f]{8}$/);
    expect(a.netlistHash).toBe(b.netlistHash);
    expect(a.netlistHash).not.toBe(c.netlistHash);
  });

  it('emits a portable manifest and never claims a vendor bitstream', () => {
    const flow = new FPGADesignFlow();
    const synthesis = flow.synthesize(verilog(), 'xc7a35t');
    const manifest = flow.generateManifest(synthesis);
    expect(manifest).toMatchObject({
      format: 'folio-fpga-manifest/1',
      deviceId: 'xc7a35t',
      gateCount: 2,
      flipFlopCount: 0,
      estimatedLuts: 2,
      vendorBitstreamAvailable: false,
    });
    expect(synthesis.warnings).toEqual(expect.arrayContaining(manifest!.warnings));
    expect(flow.generateManifest(flow.synthesize([], 'xc7a35t'))).toBeNull();
  });

  it('retains a manifest locally and reports that no device was programmed', () => {
    const flow = new FPGADesignFlow();
    const manifest = flow.generateManifest(flow.synthesize(verilog(), 'xc7a35t'))!;
    const retained = flow.retainManifest(manifest);
    expect(retained.programmed).toBe(false);
    expect(retained.deviceId).toBe('xc7a35t');
    expect(retained.message).toMatch(/No programmer is attached/);
    expect(retained.message).toMatch(/no device was configured/);
    expect(flow.getRetainedManifest('xc7a35t')).toBe(manifest);
  });

  it('exposes the documented device list without duplicates', () => {
    const flow = new FPGADesignFlow();
    expect(flow.getDevices()).toHaveLength(FPGA_DEVICES.length);
    expect(new Set(FPGA_DEVICES.map((d) => d.id)).size).toBe(FPGA_DEVICES.length);
    expect(flow.getDevices('xilinx').every((d) => d.vendor === 'xilinx')).toBe(true);
  });
});
