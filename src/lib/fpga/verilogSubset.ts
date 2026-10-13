/**
 * Verilog structural subset - module header, ports, wire/reg declarations.
 * Part 1 of 2: header + declarations. Part 2 adds gate elaboration.
 */
import type { DigitalNetlist, GateType } from '../simulation/digitalLogic';

export interface VPort {
  name: string;
  direction: 'input' | 'output';
  width: number;
}

export interface VModule {
  name: string;
  ports: VPort[];
}

export class VerilogParseError extends Error {
  constructor(
    message: string,
    readonly lineNumber: number,
    readonly line: string,
  ) {
    super(`line ${lineNumber}: ${message} — "${line}"`);
    this.name = 'VerilogParseError';
  }
}

export const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');

/** Split a comma list, dropping empties. */
export function splitTopLevel(list: string): string[] {
  return list.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Parse `[msb:lsb]` width suffix in either order; returns element count or 1. */
export function busWidth(name: string): { base: string; width: number } {
  const trailing = name.match(/^(.*?)\s*\[\s*(\d+)\s*:\s*(\d+)\s*\]$/);
  const leading = name.match(/^\[\s*(\d+)\s*:\s*(\d+)\s*\]\s*(.+)$/);
  const match = trailing ?? (leading ? [leading[0], leading[3], leading[1], leading[2]] : null);
  if (!match) return { base: name.trim(), width: 1 };
  const msb = Number(match[2]);
  const lsb = Number(match[3]);
  if (!Number.isInteger(msb) || !Number.isInteger(lsb)) throw new Error('non-integer bus range');
  return { base: match[1].trim(), width: Math.abs(msb - lsb) + 1 };
}

/** Parse the module header and port list. Throws on anything malformed. */
export function parseModuleHeader(clean: string, firstLine: string): VModule {
  const headerMatch = clean.match(/module\s+([A-Za-z_]\w*)\s*\(([^;]*?)\)\s*;/);
  if (!headerMatch) throw new VerilogParseError('no module header found', 1, firstLine);
  const ports: VPort[] = [];
  for (const entry of splitTopLevel(headerMatch[2])) {
    // Both `input [7:0] d` and `input d` forms.
    const dirMatch = entry.match(/^(input|output)\b\s*(?:wire|reg)?\s*(.+)$/i);
    if (!dirMatch) throw new VerilogParseError(`unparseable port "${entry}"`, 1, firstLine);
    const rest = dirMatch[2].trim();
    for (const piece of splitTopLevel(rest)) {
      const { base, width } = busWidth(piece);
      if (!/^[A-Za-z_]\w*$/.test(base)) throw new VerilogParseError(`bad port name "${piece}"`, 1, firstLine);
      ports.push({ name: base, direction: dirMatch[1].toLowerCase() as VPort['direction'], width });
    }
  }
  return { name: headerMatch[1], ports };
}

const GATE_MAP: Record<string, GateType> = {
  and: 'AND', nand: 'NAND', or: 'OR', nor: 'NOR', xor: 'XOR', xnor: 'XNOR', not: 'NOT', buf: 'BUF',
};

const GATE_ARITY: Record<GateType, { min: number; max: number }> = {
  AND: { min: 2, max: 8 }, NAND: { min: 2, max: 8 }, OR: { min: 2, max: 8 },
  NOR: { min: 2, max: 8 }, XOR: { min: 2, max: 8 }, XNOR: { min: 2, max: 8 },
  NOT: { min: 1, max: 1 }, BUF: { min: 1, max: 1 },
};

export interface VerilogElaboration {
  name: string;
  ports: VPort[];
  netlist: DigitalNetlist;
}

/** Elaborate a full source string into ports + a runnable digital netlist. */
export function parseVerilogModule(source: string): VerilogElaboration {
  const rawLines = source.split(/\r?\n/);
  const clean = stripComments(source);
  const { name, ports } = parseModuleHeader(clean, rawLines[0] ?? '');
  if (!/endmodule/i.test(clean)) {
    throw new VerilogParseError(`module ${name} missing endmodule`, rawLines.length, rawLines[rawLines.length - 1] ?? '');
  }
  const body = clean.slice(clean.indexOf(';') + 1);
  for (const decl of body.matchAll(/\b(?:wire|reg)\b([^;]*);/gi)) {
    for (const piece of splitTopLevel(decl[1])) {
      const { base } = busWidth(piece);
      if (!/^[A-Za-z_]\w*$/.test(base)) throw new VerilogParseError(`bad net name "${piece}"`, 1, piece);
    }
  }
  const netlist: DigitalNetlist = { gates: [], flipFlops: [], clocks: [], stimuli: [] };
  const driven = new Map<string, number>();
  for (const p of ports) {
    if (p.direction === 'input') driven.set(p.name, 0);
  }
  let gateCount = 0;
  const gatePattern = /\b(and|nand|or|nor|xor|xnor|not|buf)\b\s*(?:[A-Za-z_]\w*\s*)?\(\s*([^;]*?)\)\s*;/gi;
  for (const match of body.matchAll(gatePattern)) {
    gateCount += 1;
    const type = GATE_MAP[match[1].toLowerCase()];
    const pins = splitTopLevel(match[2]);
    const arity = GATE_ARITY[type];
    if (pins.length - 1 < arity.min || pins.length - 1 > arity.max) {
      throw new VerilogParseError(`${match[1]} needs ${arity.min}..${arity.max} inputs, got ${pins.length - 1}`, 1, match[0]);
    }
    const [out, ...ins] = pins;
    for (const node of [out, ...ins]) {
      if (!/^[A-Za-z_]\w*$/.test(node)) throw new VerilogParseError(`bad net name "${node}"`, 1, match[0]);
    }
    if (driven.has(out)) {
      throw new VerilogParseError(`net ${out} driven twice`, 1, match[0]);
    }
    driven.set(out, 1);
    netlist.gates!.push({ id: `g${gateCount}`, type, output: out, inputs: ins, delay: 1 });
  }
  for (const match of body.matchAll(/\bassign\b\s*([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;/gi)) {
    const [, out, src] = match;
    if (driven.has(out)) throw new VerilogParseError(`net ${out} driven twice`, 1, match[0]);
    driven.set(out, 1);
    gateCount += 1;
    netlist.gates!.push({ id: `g${gateCount}`, type: 'BUF', output: out, inputs: [src], delay: 1 });
  }
  for (const p of ports) {
    if (p.direction === 'output' && !driven.has(p.name)) {
      throw new VerilogParseError(`output ${p.name} is never driven`, 1, `module ${name}`);
    }
  }
  return { name, ports, netlist };
}

