export type FPGAVendor = 'xilinx' | 'intel' | 'lattice' | 'gowin';

import { parseVerilogModule } from './verilogSubset';
import { parseVhdl } from './vhdlSubset';
import { simulateDigital } from '../simulation/digitalLogic';

/**
 * FPGA flow — structural elaboration only.
 *
 * The parsers turn Verilog/VHDL into a real gate-level netlist, and this module
 * reports the resources that netlist implies (gate and flip-flop counts, a
 * one-LUT-per-gate estimate). It does NOT bundle place-and-route, vendor
 * mapping, or timing analysis, so it never invents an Fmax, WNS, BRAM/DSP
 * inference, a vendor bitstream, or a successful device programming event.
 * Those steps require Vivado/Quartus/Diamond/Gowin EDA and a connected
 * programmer; this flow states that instead of fabricating results.
 */

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
  /** Null when the requested device id is unknown. */
  device: FPGADevice | null;
  /** Counts derived by elaborating the HDL into the structural netlist. */
  utilization: {
    gates: number;
    /** Estimate: one LUT per gate. Real mapping may share logic. */
    luts: number;
    flipFlops: number;
    /** Not inferred — zero until a memory-inference pass exists. */
    bramKb: number;
    /** Not inferred — zero until a DSP-inference pass exists. */
    dsp: number;
    lutPercent: number;
  };
  /**
   * Timing requires vendor place-and-route. `modelled: false` means Fmax and
   * WNS are unknown, not zero — callers must not display them as measurements.
   */
  timing: { fmaxMhz: null; wnsNs: null; modelled: false };
  warnings: string[];
  errors: string[];
  netlistHash: string;
}

/** A portable description of an elaborated design — not a vendor bitstream. */
export interface DesignManifest {
  format: 'folio-fpga-manifest/1';
  deviceId: string;
  netlistHash: string;
  gateCount: number;
  flipFlopCount: number;
  estimatedLuts: number;
  warnings: string[];
  /** Vendor bitstream assembly and device configuration are out of scope. */
  vendorBitstreamAvailable: false;
  createdAt: number;
}

export interface FPGAConfigurationResult {
  /** Always false: no programmer backend is bundled with this flow. */
  programmed: false;
  deviceId: string;
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

const EMPTY_UTILIZATION: SynthesisResult['utilization'] = {
  gates: 0, luts: 0, flipFlops: 0, bramKb: 0, dsp: 0, lutPercent: 0,
};

const NO_TIMING: SynthesisResult['timing'] = { fmaxMhz: null, wnsNs: null, modelled: false };

export class FPGADesignFlow {
  private retained: Map<string, DesignManifest> = new Map();

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
        device: null,
        utilization: { ...EMPTY_UTILIZATION },
        timing: { ...NO_TIMING },
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

    // Real HDL elaboration: parse structural Verilog/VHDL into the digital
    // netlist and functionally verify it on the digital engine, so counts come
    // from actual gates instead of source characters.
    let gateCount = 0;
    let ffCount = 0;
    for (const module of modules) {
      const lang = module.language.toLowerCase();
      try {
        if (lang === 'vhdl') {
          const { ports, netlist } = parseVhdl(module.source);
          gateCount += netlist.gates?.length ?? 0;
          ffCount += netlist.flipFlops?.length ?? 0;
          const sim = simulateDigital(
            {
              gates: netlist.gates,
              flipFlops: netlist.flipFlops,
              stimuli: ports
                .filter((p) => p.direction === 'in')
                .map((p) => ({ node: p.name, value: 0 as const, time: 0 })),
            },
            10,
          );
          if (!sim.success) {
            errors.push(`VHDL ${module.name}: functional check failed — ${sim.error ?? 'unknown'}`);
          }
        } else if (lang === 'verilog' || lang === 'systemverilog') {
          const { ports, netlist } = parseVerilogModule(module.source);
          gateCount += netlist.gates?.length ?? 0;
          ffCount += netlist.flipFlops?.length ?? 0;
          const sim = simulateDigital(
            {
              gates: netlist.gates,
              flipFlops: netlist.flipFlops,
              stimuli: ports
                .filter((p) => p.direction === 'input')
                .map((p) => ({ node: p.name, value: 0 as const, time: 0 })),
            },
            10,
          );
          if (!sim.success) {
            errors.push(`Verilog ${module.name}: functional check failed — ${sim.error ?? 'unknown'}`);
          }
        } else {
          errors.push(`HDL ${module.name}: unsupported language "${module.language}"`);
        }
      } catch (error) {
        errors.push(`HDL ${module.name}: ${error instanceof Error ? error.message : 'parse failed'}`);
      }
    }
    if (errors.length > 0) {
      return {
        success: false,
        device,
        utilization: { ...EMPTY_UTILIZATION },
        timing: { ...NO_TIMING },
        warnings,
        errors,
        netlistHash: '',
      };
    }

    // One LUT per parsed gate is an upper-bound estimate before mapping;
    // logic sharing in a real mapper can only reduce it. No source-length
    // fudging, no invented BRAM/DSP, no invented timing.
    const luts = gateCount;
    const lutPercent = (luts / device.luts) * 100;

    warnings.push(
      'Timing, BRAM and DSP inference are not modelled: Fmax/WNS are unavailable and BRAM/DSP report 0.',
    );
    if (luts > device.luts) {
      warnings.push(
        `LUT estimate (${luts}) exceeds ${device.part} capacity (${device.luts}); the design is likely over capacity.`,
      );
    }
    if (ffCount > device.flipFlops) {
      warnings.push(
        `Flip-flop count (${ffCount}) exceeds ${device.part} capacity (${device.flipFlops}).`,
      );
    }

    return {
      success: true,
      device,
      utilization: {
        gates: gateCount,
        luts,
        flipFlops: ffCount,
        bramKb: 0,
        dsp: 0,
        lutPercent,
      },
      timing: { ...NO_TIMING },
      warnings,
      errors,
      netlistHash: hashString(source + deviceId),
    };
  }

  generateManifest(synthesis: SynthesisResult): DesignManifest | null {
    if (!synthesis.success || !synthesis.device) return null;
    return {
      format: 'folio-fpga-manifest/1',
      deviceId: synthesis.device.id,
      netlistHash: synthesis.netlistHash,
      gateCount: synthesis.utilization.gates,
      flipFlopCount: synthesis.utilization.flipFlops,
      estimatedLuts: synthesis.utilization.luts,
      warnings: [...synthesis.warnings],
      vendorBitstreamAvailable: false,
      createdAt: Date.now(),
    };
  }

  /**
   * Keep the manifest locally for export. A vendor bitstream and a connected
   * programmer would be required to configure hardware, so this reports that
   * no device was programmed instead of claiming success.
   */
  retainManifest(manifest: DesignManifest): FPGAConfigurationResult {
    this.retained.set(manifest.deviceId, manifest);
    return {
      programmed: false,
      deviceId: manifest.deviceId,
      message:
        `Manifest retained for ${manifest.deviceId} (${manifest.gateCount} gates, ` +
        `${manifest.estimatedLuts} LUT estimate). No programmer is attached; ` +
        'no device was configured. Generate a vendor bitstream with the vendor toolchain first.',
    };
  }

  getRetainedManifest(deviceId: string): DesignManifest | undefined {
    return this.retained.get(deviceId);
  }
}

export const fpgaDesignFlow = new FPGADesignFlow();
