export type FPGAVendor = 'xilinx' | 'intel' | 'lattice' | 'gowin';

export interface FPGADevice {
  id: string;
  vendor: FPGAVendor;
  family: string;
  part: string;
  luts: number;
  flipFlops: number;
  bramKb: number;
  dsp: number;
  io: number;
}

export interface HDLModule {
  name: string;
  language: 'verilog' | 'vhdl' | 'systemverilog';
  source: string;
}

export interface SynthesisResult {
  success: boolean;
  device: FPGADevice;
  utilization: {
    luts: number;
    flipFlops: number;
    bramKb: number;
    dsp: number;
    lutPercent: number;
  };
  timing: { fmaxMhz: number; wnsNs: number };
  warnings: string[];
  errors: string[];
  netlistHash: string;
}

export interface Bitstream {
  deviceId: string;
  dataHex: string;
  sizeBytes: number;
  checksum: string;
  createdAt: number;
}

export interface FPGAProgramResult {
  success: boolean;
  deviceId: string;
  programmedAt: number;
  message: string;
}

export const FPGA_DEVICES: FPGADevice[] = [
  { id: 'xc7a35t', vendor: 'xilinx', family: 'Artix-7', part: 'XC7A35T', luts: 20800, flipFlops: 41600, bramKb: 1800, dsp: 90, io: 250 },
  { id: '10cl016', vendor: 'intel', family: 'Cyclone 10 LP', part: '10CL016', luts: 15880, flipFlops: 15880, bramKb: 504, dsp: 56, io: 176 },
  { id: 'lfe5u-25f', vendor: 'lattice', family: 'ECP5', part: 'LFE5U-25F', luts: 24200, flipFlops: 24200, bramKb: 1008, dsp: 28, io: 197 },
  { id: 'gw1n-9', vendor: 'gowin', family: 'LittleBee', part: 'GW1N-9', luts: 8640, flipFlops: 6480, bramKb: 468, dsp: 20, io: 88 },
];

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class FPGADesignFlow {
  private programmed: Map<string, Bitstream> = new Map();

  getDevices(vendor?: FPGAVendor): FPGADevice[] {
    return vendor ? FPGA_DEVICES.filter((d) => d.vendor === vendor) : FPGA_DEVICES;
  }

  getDevice(id: string): FPGADevice | undefined {
    return FPGA_DEVICES.find((d) => d.id === id);
  }

  synthesize(modules: HDLModule[], deviceId: string): SynthesisResult {
    const device = this.getDevice(deviceId);
    if (!device) {
      return {
        success: false,
        device: FPGA_DEVICES[0],
        utilization: { luts: 0, flipFlops: 0, bramKb: 0, dsp: 0, lutPercent: 0 },
        timing: { fmaxMhz: 0, wnsNs: 0 },
        warnings: [],
        errors: [`Unknown FPGA device: ${deviceId}`],
        netlistHash: '',
      };
    }

    const source = modules.map((m) => m.source).join('\n');
    const errors: string[] = [];
    const warnings: string[] = [];

    if (modules.length === 0 || source.trim().length === 0) {
      errors.push('No HDL source provided');
    }
    if (!/module\s+\w+|entity\s+\w+/i.test(source) && source.trim().length > 0) {
      warnings.push('No Verilog module or VHDL entity detected');
    }
    if (/always\s+@\s*\(\s*posedge[\s\S]*posedge/i.test(source)) {
      warnings.push('Multiple clock edges detected; check CDC constraints');
    }

    const loc = Math.min(device.luts, 40 + source.length * 2);
    const ff = Math.min(device.flipFlops, 20 + source.length);
    const bram = Math.min(device.bramKb, Math.floor(source.length / 80));
    const dsp = /mult|\*|dsp/i.test(source) ? Math.min(device.dsp, 4) : 0;
    const lutPercent = (loc / device.luts) * 100;
    const fmaxMhz = Math.max(40, 220 - lutPercent * 1.5);

    return {
      success: errors.length === 0,
      device,
      utilization: { luts: loc, flipFlops: ff, bramKb: bram, dsp, lutPercent },
      timing: { fmaxMhz, wnsNs: fmaxMhz > 50 ? 0.4 : -0.2 },
      warnings,
      errors,
      netlistHash: hashString(source + deviceId),
    };
  }

  generateBitstream(synthesis: SynthesisResult): Bitstream | null {
    if (!synthesis.success) return null;
    const payload = `${synthesis.netlistHash}:${synthesis.device.id}:${synthesis.utilization.luts}`;
    const dataHex = Array.from(payload)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
    return {
      deviceId: synthesis.device.id,
      dataHex,
      sizeBytes: Math.ceil(dataHex.length / 2) + 1024,
      checksum: hashString(dataHex),
      createdAt: Date.now(),
    };
  }

  program(bitstream: Bitstream): FPGAProgramResult {
    this.programmed.set(bitstream.deviceId, bitstream);
    return {
      success: true,
      deviceId: bitstream.deviceId,
      programmedAt: Date.now(),
      message: `Programmed ${bitstream.deviceId} (${bitstream.sizeBytes} bytes)`,
    };
  }

  getProgrammedBitstream(deviceId: string): Bitstream | undefined {
    return this.programmed.get(deviceId);
  }
}

export const fpgaDesignFlow = new FPGADesignFlow();
