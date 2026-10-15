/**
 * VHDL structural subset — entity/architecture with port map + gate instances.
 *
 * Folio simulates Verilog already (`verilogSubset.ts`); VHDL-only teams had no
 * path in. This parses the synthesizable structural subset:
 * `entity X is port(a: in bit; y: out bit); end;` +
 * `architecture s of X is begin u1: and2 port map(a,b,y); end;`
 * for AND/OR/NAND/NOR/XOR/NOT/BUF cells, elaborating to the same runnable
 * digital netlist. Fail-loud with line numbers; unmapped ports rejected.
 */
import type { DigitalNetlist, GateType } from '../simulation/digitalLogic';

export class VhdlParseError extends Error {
  constructor(message: string, readonly lineNumber: number, readonly line: string) {
    super(`line ${lineNumber}: ${message} — "${line}"`);
    this.name = 'VhdlParseError';
  }
}

export interface VhdlPort { name: string; direction: 'in' | 'out'; }
export interface VhdlElaboration { entity: string; ports: VhdlPort[]; netlist: DigitalNetlist; }

const GATE_MAP: Record<string, { type: GateType; inputs: number }> = {
  and2: { type: 'AND', inputs: 2 }, nand2: { type: 'NAND', inputs: 2 },
  or2: { type: 'OR', inputs: 2 }, nor2: { type: 'NOR', inputs: 2 },
  xor2: { type: 'XOR', inputs: 2 }, inv: { type: 'NOT', inputs: 1 },
  buf: { type: 'BUF', inputs: 1 },
};

const lineOf = (src: string, index: number): number => src.slice(0, index).split('\n').length;

export function parseVhdl(source: string): VhdlElaboration {
  const clean = source.replace(/--[^\n]*/g, ' ');
  const entityMatch = clean.match(/entity\s+([A-Za-z_]\w*)\s+is\b/i);
  if (!entityMatch) throw new VhdlParseError('no entity found', 1, source.split('\n')[0] ?? '');
  const entity = entityMatch[1];
  const portOpen = clean.match(/port\s*\(/i);
  if (!portOpen || portOpen.index === undefined) throw new VhdlParseError(`entity ${entity} has no port clause`, 1, entity);
  const start = portOpen.index + portOpen[0].length;
  let depth = 1; let end = -1;
  for (let i = start; i < clean.length; i += 1) {
    if (clean[i] === '(') depth += 1;
    else if (clean[i] === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new VhdlParseError(`entity ${entity} has unterminated port clause`, 1, entity);
  const portText = clean.slice(start, end);
  const ports: VhdlPort[] = [];
  for (const piece of portText.split(';').map((s) => s.trim()).filter(Boolean)) {
    const m = piece.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:\s*(in|out)\b/i);
    if (!m) throw new VhdlParseError(`unparseable port "${piece}"`, 1, piece);
    for (const name of m[1].split(',').map((s) => s.trim())) {
      ports.push({ name, direction: m[2].toLowerCase() as 'in' | 'out' });
    }
  }
  if (!/architecture\b/i.test(clean)) throw new VhdlParseError(`entity ${entity} has no architecture`, 1, entity);
  const netlist: DigitalNetlist = { gates: [], flipFlops: [], clocks: [], stimuli: [] };
  const driven = new Map<string, number>();
  for (const p of ports) if (p.direction === 'in') driven.set(p.name.toLowerCase(), 1);
  const instPattern = /(\w+)\s*:\s*(\w+)\s+port\s+map\s*\(([^;]*?)\)\s*;/gi;
  let count = 0; let found = false;
  for (const m of clean.matchAll(instPattern)) {
    found = true;
    const cell = m[2].toLowerCase();
    const spec = GATE_MAP[cell];
    if (!spec) throw new VhdlParseError(`unknown cell "${m[2]}"`, lineOf(source, m.index ?? 0), m[0].trim());
    const pins = m[3].split(',').map((s) => s.trim()).filter(Boolean);
    if (pins.length !== spec.inputs + 1) {
      throw new VhdlParseError(`${m[2]} needs ${spec.inputs + 1} pins, got ${pins.length}`, lineOf(source, m.index ?? 0), m[0].trim());
    }
    const [out, ...ins] = pins;
    for (const n of [out, ...ins]) if (!/^[A-Za-z_]\w*$/.test(n)) throw new VhdlParseError(`bad net "${n}"`, lineOf(source, m.index ?? 0), m[0].trim());
    if (driven.has(out.toLowerCase())) throw new VhdlParseError(`net ${out} driven twice`, lineOf(source, m.index ?? 0), m[0].trim());
    driven.set(out.toLowerCase(), 1);
    count += 1;
    netlist.gates!.push({ id: `g${count}`, type: spec.type, output: out, inputs: ins, delay: 1 });
  }
  if (!found) throw new VhdlParseError('architecture has no instances', 1, entity);
  for (const p of ports) {
    if (p.direction === 'out' && !driven.has(p.name.toLowerCase())) throw new VhdlParseError(`output ${p.name} never driven`, 1, entity);
  }
  return { entity, ports, netlist };
}
