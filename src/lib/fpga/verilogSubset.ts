/**
 * Verilog subset — structural gates, continuous expressions, buses and clocked
 * always blocks, elaborated to the digital engine's four-state netlist.
 *
 * The point of this parser is a real, bounded synthesizable subset rather than
 * a source highlighter. It accepts:
 *
 *   - structural gate instances: `and g1 (y, a, b);` with optional instance name;
 *   - `wire` / `reg` declarations, with `[msb:lsb]` buses expanded per bit;
 *   - continuous assignments with `~ ! & | ^ && || == != ?:`, reductions and
 *     unsigned `+` / `-` (lowered to ripple-carry gates with the assignment
 *     width supplying the context, so a wider target keeps the carry);
 *   - `always @(posedge clk)` / `negedge`, `if`/`else` chains, `case`/`default`
 *     decode over constant labels (lowered to a priority mux chain comparing
 *     the full selector width) and non-blocking assignments, inferred as D
 *     flip-flops (a synchronous reset becomes a mux ahead of the flop, which is
 *     what the hardware would be);
 *   - `1'b0`, `8'hff`, `12'd9` and plain decimal literals, zero-extended or
 *     truncated to the width of the left-hand side like the language does.
 *
 * It does not accept module hierarchy, `generate`, multiplication/division,
 * signed arithmetic, memories, asynchronously reset flops, or multi-clock CDC.
 * Those fail with a line-numbered error instead of being silently ignored, so
 * a design that elaborates here is one the rest of the flow can defend.
 */
import type { DigitalNetlist, FlipFlop, GateType } from '../simulation/digitalLogic';

export interface VPort {
  name: string;
  direction: 'input' | 'output';
  width: number;
  /** Bit nets in least-significant-first order; a scalar port holds its name. */
  bits: string[];
  /** Declared bit index for each entry of `bits`. */
  positions: number[];
  /** True when the port was declared `output reg`, so an always block may drive it. */
  reg?: boolean;
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

interface BusRange {
  msb: number;
  lsb: number;
  width: number;
}

/** Parse `[msb:lsb]` in either order; returns null for a scalar name. */
function parseBusRange(text: string): { base: string; range: BusRange | null } {
  const trailing = text.match(/^(.*?)\s*\[\s*(\d+)\s*:\s*(\d+)\s*\]$/);
  const leading = text.match(/^\[\s*(\d+)\s*:\s*(\d+)\s*\]\s*(.+)$/);
  const match = trailing ?? (leading ? [leading[0], leading[3], leading[1], leading[2]] : null);
  if (!match) return { base: text.trim(), range: null };
  const msb = Number(match[2]);
  const lsb = Number(match[3]);
  if (!Number.isInteger(msb) || !Number.isInteger(lsb)) throw new Error('non-integer bus range');
  return { base: match[1].trim(), range: { msb, lsb, width: Math.abs(msb - lsb) + 1 } };
}

/** Parse `[msb:lsb]` width suffix in either order; returns element count or 1. */
export function busWidth(name: string): { base: string; width: number } {
  const { base, range } = parseBusRange(name);
  return { base, width: range?.width ?? 1 };
}

/**
 * Bit nets in least-significant-first order. `[7:0]` yields d[0]..d[7]; the
 * less common ascending range `[0:7]` yields d[7]..d[0], because index 7 is its
 * least-significant bit.
 */
function bitNames(base: string, range: BusRange | null): { bits: string[]; positions: number[] } {
  if (!range) return { bits: [base], positions: [0] };
  const bits: string[] = [];
  const positions: number[] = [];
  if (range.msb >= range.lsb) {
    for (let index = range.lsb; index <= range.msb; index += 1) {
      bits.push(`${base}[${index}]`);
      positions.push(index);
    }
  } else {
    for (let index = range.lsb; index >= range.msb; index -= 1) {
      bits.push(`${base}[${index}]`);
      positions.push(index);
    }
  }
  return { bits, positions };
}

interface PortPiece {
  base: string;
  range: BusRange | null;
}

function readPortPiece(piece: string): PortPiece {
  const { base, range } = parseBusRange(piece);
  if (!/^[A-Za-z_]\w*$/.test(base)) throw new Error(`bad port name "${piece}"`);
  return { base, range };
}

/** Parse the module header and port list. Throws on anything malformed. */
export function parseModuleHeader(clean: string, firstLine: string): VModule {
  const headerMatch = clean.match(/module\s+([A-Za-z_]\w*)\s*\(([^;]*?)\)\s*;/);
  if (!headerMatch) throw new VerilogParseError('no module header found', 1, firstLine);
  const ports: VPort[] = [];
  for (const entry of splitTopLevel(headerMatch[2])) {
    // `input [7:0] d`, `input wire d`, `output reg q` and `input d` all occur.
    const dirMatch = entry.match(/^(input|output)\b\s*(wire|reg)?\s*(.+)$/i);
    if (!dirMatch) throw new VerilogParseError(`unparseable port "${entry}"`, 1, firstLine);
    const direction = dirMatch[1].toLowerCase() as VPort['direction'];
    const reg = dirMatch[2]?.toLowerCase() === 'reg';
    const rest = dirMatch[3].trim();
    for (const piece of splitTopLevel(rest)) {
      let parsed: PortPiece;
      try {
        parsed = readPortPiece(piece);
      } catch (error) {
        throw new VerilogParseError((error as Error).message, 1, firstLine);
      }
      const { bits, positions } = bitNames(parsed.base, parsed.range);
      if (ports.some((port) => port.name === parsed.base)) {
        throw new VerilogParseError(`port ${parsed.base} declared twice`, 1, firstLine);
      }
      ports.push({
        name: parsed.base,
        direction,
        width: parsed.range?.width ?? 1,
        bits,
        positions,
        ...(reg ? { reg: true } : {}),
      });
    }
  }
  return { name: headerMatch[1], ports };
}

/** Flat list of scalar bit ports, for simulation stimuli and synthesis I/O. */
export function expandVerilogPorts(
  ports: readonly VPort[],
): Array<{ name: string; direction: 'input' | 'output' }> {
  return ports.flatMap((port) => port.bits.map((bit) => ({ name: bit, direction: port.direction })));
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

/* ------------------------------------------------------------------ */
/* Expressions                                                        */
/* ------------------------------------------------------------------ */

type BitExpr =
  | { kind: 'net'; name: string }
  | { kind: 'const'; value: 0 | 1 }
  | { kind: 'not'; a: BitExpr }
  | { kind: 'bin'; op: 'and' | 'or' | 'xor'; a: BitExpr; b: BitExpr };

type BitVec = BitExpr[];

const CONST0: BitExpr = { kind: 'const', value: 0 };
const CONST1: BitExpr = { kind: 'const', value: 1 };
const GND = '__gnd';
const VDD = '__vdd';

const isConst = (expr: BitExpr, value: 0 | 1): boolean =>
  expr.kind === 'const' && expr.value === value;

function notBit(a: BitExpr): BitExpr {
  if (isConst(a, 0)) return CONST1;
  if (isConst(a, 1)) return CONST0;
  return { kind: 'not', a };
}

function andBit(a: BitExpr, b: BitExpr): BitExpr {
  if (isConst(a, 0) || isConst(b, 0)) return CONST0;
  if (isConst(a, 1)) return b;
  if (isConst(b, 1)) return a;
  return { kind: 'bin', op: 'and', a, b };
}

function orBit(a: BitExpr, b: BitExpr): BitExpr {
  if (isConst(a, 1) || isConst(b, 1)) return CONST1;
  if (isConst(a, 0)) return b;
  if (isConst(b, 0)) return a;
  return { kind: 'bin', op: 'or', a, b };
}

function xorBit(a: BitExpr, b: BitExpr): BitExpr {
  if (isConst(a, 0)) return b;
  if (isConst(b, 0)) return a;
  if (isConst(a, 1)) return notBit(b);
  if (isConst(b, 1)) return notBit(a);
  return { kind: 'bin', op: 'xor', a, b };
}

function muxBit(select: BitExpr, whenOne: BitExpr, whenZero: BitExpr): BitExpr {
  if (isConst(select, 1)) return whenOne;
  if (isConst(select, 0)) return whenZero;
  if (isConst(whenOne, 0)) return andBit(notBit(select), whenZero);
  if (isConst(whenZero, 0)) return andBit(select, whenOne);
  if (isConst(whenOne, 1)) return orBit(select, whenZero);
  if (isConst(whenZero, 1)) return orBit(whenOne, notBit(select));
  return orBit(andBit(select, whenOne), andBit(notBit(select), whenZero));
}

/** Zero-extend or truncate to `width`, matching Verilog's assignment rules. */
function resize(vec: BitVec, width: number): BitVec {
  if (vec.length === width) return vec;
  if (vec.length > width) return vec.slice(0, width);
  return [...vec, ...Array.from({ length: width - vec.length }, () => CONST0)];
}

function reduce(vec: BitVec, op: 'and' | 'or' | 'xor'): BitExpr {
  const combine = op === 'and' ? andBit : op === 'or' ? orBit : xorBit;
  return vec.reduce((carry, bit) => combine(carry, bit), op === 'and' ? CONST1 : CONST0);
}

function truthy(vec: BitVec): BitExpr {
  return reduce(vec, 'or');
}

/* ------------------------------------------------------------------ */
/* Lexer                                                              */
/* ------------------------------------------------------------------ */

type TokenKind = 'id' | 'number' | 'op' | 'punct';

interface Token {
  kind: TokenKind;
  text: string;
  at: number;
}

const PUNCTUATION = new Set(['(', ')', '[', ']', ':', ';', ',', '?']);
const OPERATORS = ['==', '!=', '<=', '&&', '||', '<<', '>>', '~', '!', '&', '|', '^', '+', '-', '*', '/', '<', '>', '=', '@'];

function tokenize(text: string, base: number): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (/\s/.test(ch)) { index += 1; continue; }
    if (/[A-Za-z_]/.test(ch)) {
      const start = index;
      while (index < text.length && /[A-Za-z0-9_$]/.test(text[index])) index += 1;
      tokens.push({ kind: 'id', text: text.slice(start, index), at: base + start });
      continue;
    }
    if (/\d/.test(ch)) {
      const rest = text.slice(index);
      const literal = rest.match(/^(\d*)'([bBdDhH])([0-9a-fA-F_xXzZ]+)/);
      if (literal) {
        tokens.push({ kind: 'number', text: literal[0], at: base + index });
        index += literal[0].length;
        continue;
      }
      const plain = rest.match(/^\d+/);
      if (!plain) throw new Error(`bad number near "${rest.slice(0, 8)}"`);
      tokens.push({ kind: 'number', text: plain[0], at: base + index });
      index += plain[0].length;
      continue;
    }
    const operator = OPERATORS.find((candidate) => text.startsWith(candidate, index));
    if (operator) {
      tokens.push({ kind: 'op', text: operator, at: base + index });
      index += operator.length;
      continue;
    }
    if (PUNCTUATION.has(ch)) {
      tokens.push({ kind: 'punct', text: ch, at: base + index });
      index += 1;
      continue;
    }
    throw new Error(`unexpected character "${ch}"`);
  }
  return tokens;
}

/* ------------------------------------------------------------------ */
/* Declarations and body                                              */
/* ------------------------------------------------------------------ */

interface Signal {
  name: string;
  width: number;
  kind: 'input' | 'output' | 'wire' | 'reg';
  bits: string[];
  positions: number[];
  /** `reg` signals and `output reg` ports can be assigned from an always block. */
  writableByAlways: boolean;
}

interface CaseItem {
  /** Constant labels selecting this arm; an empty list marks `default`. */
  labels: BitVec[];
  body: Statement;
}

interface Statement {
  kind: 'assign' | 'if' | 'block' | 'empty' | 'case';
  at: number;
  target?: BitVec;
  targetNames?: string[];
  value?: BitVec;
  cond?: BitVec;
  then?: Statement;
  otherwise?: Statement;
  items?: Statement[];
  caseItems?: CaseItem[];
}

class BodyParser {
  private index = 0;
  private gateSerial = 0;
  private tempSerial = 0;
  private readonly signals = new Map<string, Signal>();
  private readonly driven = new Map<string, string>();
  private readonly clocks = new Map<string, 'rising' | 'falling'>();
  private readonly reserved = new Set<string>([GND, VDD]);
  private usesConstants = false;
  /*
   * Expression nodes are immutable and routinely shared (a ripple-carry
   * chain reuses the same partial-sum XOR in the sum and the carry, and a
   * chained `a + b + a` embeds the earlier sum whole). Lowering without this
   * cache re-emits every shared subtree, which turns a six-term adder into
   * hundreds of thousands of gates instead of hundreds.
   */
  private readonly lowered = new Map<BitExpr, string>();
  /*
   * Assignment width, threaded into context-determined arithmetic the way
   * Verilog does: `assign [8:0] y = a + b;` extends both 8-bit operands to nine
   * bits and keeps the carry. Comparison, logical and condition operands reset
   * it because those are self-determined and must not be widened by the target.
   */
  private contextWidth: number | null = null;

  constructor(
    private readonly tokens: Token[],
    private readonly clean: string,
    private readonly source: string,
    private readonly netlist: DigitalNetlist,
    ports: readonly VPort[],
  ) {
    for (const port of ports) {
      const signal: Signal = {
        name: port.name,
        width: port.width,
        kind: port.direction,
        bits: port.bits,
        positions: port.positions,
        writableByAlways: Boolean(port.reg) && port.direction === 'output',
      };
      this.signals.set(port.name, signal);
      for (const bit of port.bits) this.reserved.add(bit);
      if (port.direction === 'input') {
        for (const bit of port.bits) this.driven.set(bit, 'port');
      }
    }
  }

  parse(): void {
    while (!this.atEnd()) {
      const token = this.peek();
      if (token.kind === 'id' && token.text === 'endmodule') { this.next(); break; }
      if (token.kind !== 'id') this.fail(`unexpected "${token.text}"`, token.at);
      switch (token.text) {
        case 'wire':
        case 'reg':
          this.parseDeclaration(token.text);
          break;
        case 'assign':
          this.parseAssign();
          break;
        case 'always':
          this.parseAlways();
          break;
        case 'input':
        case 'output':
          this.fail('port directions belong in the module header', token.at);
          break;
        default:
          if (GATE_MAP[token.text]) this.parseGateInstance();
          else this.fail(`unknown statement "${token.text}"`, token.at);
      }
    }
    if (!this.atEnd()) this.fail('only one module per source is supported', this.peek().at);
  }

  /* ── tokens ───────────────────────────────────────────────────────── */

  private atEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    if (!token) this.fail('unexpected end of module', this.source.length);
    this.index += 1;
    return token;
  }

  private accept(text: string): boolean {
    if (!this.atEnd() && this.peek().text === text) { this.index += 1; return true; }
    return false;
  }

  private expect(text: string): Token {
    if (this.atEnd() || this.peek().text !== text) {
      if (text === ';' && !this.atEnd() && this.peek().kind === 'op') {
        this.fail(`operator "${this.peek().text}" is not supported`, this.peek().at);
      }
      this.fail(`expected "${text}"`, this.atEnd() ? this.source.length : this.peek().at);
    }
    return this.next();
  }

  private expectIdentifier(what: string): Token {
    if (this.atEnd() || this.peek().kind !== 'id') {
      this.fail(`expected ${what}`, this.atEnd() ? this.source.length : this.peek().at);
    }
    return this.next();
  }

  private expectNumber(): number {
    if (this.atEnd() || this.peek().kind !== 'number' || !/^\d+$/.test(this.peek().text)) {
      this.fail('expected a decimal index', this.atEnd() ? this.source.length : this.peek().at);
    }
    return Number(this.next().text);
  }

  private fail(message: string, at: number): never {
    const line = this.clean.slice(0, Math.max(0, at)).split('\n');
    throw new VerilogParseError(message, line.length, line[line.length - 1]?.trim() ?? '');
  }

  /* ── declarations ─────────────────────────────────────────────────── */

  private readRange(): { msb: number; lsb: number } | null {
    if (!this.accept('[')) return null;
    const msb = this.expectNumber();
    this.expect(':');
    const lsb = this.expectNumber();
    this.expect(']');
    return { msb, lsb };
  }

  private declareSignal(base: string, range: { msb: number; lsb: number } | null, kind: Signal['kind'], at: number): void {
    if (this.signals.has(base)) this.fail(`signal ${base} declared twice`, at);
    const { bits, positions } = bitNames(base, range ? { ...range, width: Math.abs(range.msb - range.lsb) + 1 } : null);
    this.signals.set(base, {
      name: base,
      width: bits.length,
      kind,
      bits,
      positions,
      writableByAlways: kind === 'reg',
    });
    for (const bit of bits) this.reserved.add(bit);
  }

  private parseDeclaration(kind: 'wire' | 'reg'): void {
    this.next();
    const range = this.readRange();
    for (;;) {
      const name = this.expectIdentifier(`${kind} name`);
      if (!/^[A-Za-z_]\w*$/.test(name.text)) this.fail(`bad net name "${name.text}"`, name.at);
      this.declareSignal(name.text, range, kind, name.at);
      if (this.accept(',')) continue;
      this.expect(';');
      break;
    }
  }

  /* ── continuous assignment ────────────────────────────────────────── */

  private parseAssign(): void {
    const keyword = this.next();
    const target = this.readReference('assignment target');
    this.expect('=');
    const value = resize(this.withWidth(target.vec.length, () => this.parseExpression()), target.vec.length);
    this.expect(';');
    if (target.signal.writableByAlways) {
      this.fail(`reg ${target.signal.name} cannot be driven by assign`, keyword.at);
    }
    for (let index = 0; index < target.vec.length; index += 1) {
      const source = this.lower(value[index]);
      this.addGate('BUF', [source], target.nets[index], keyword.at);
    }
  }

  /* ── structural gate instance ─────────────────────────────────────── */

  private parseGateInstance(): void {
    const keyword = this.next();
    const type = GATE_MAP[keyword.text];
    if (!type) this.fail(`unknown gate "${keyword.text}"`, keyword.at);
    if (!this.accept('(')) {
      // Optional instance name before the pin list.
      this.expectIdentifier('an instance name or "("');
      this.expect('(');
    }
    const pins: Token[] = [this.expectIdentifier('a pin net')];
    while (this.accept(',')) pins.push(this.expectIdentifier('a pin net'));
    this.expect(')');
    this.expect(';');
    const arity = GATE_ARITY[type];
    if (pins.length - 1 < arity.min || pins.length - 1 > arity.max) {
      this.fail(`${keyword.text} needs ${arity.min}..${arity.max} inputs, got ${pins.length - 1}`, keyword.at);
    }
    const [out, ...inputs] = pins;
    for (const pin of [out, ...inputs]) {
      if (!/^[A-Za-z_]\w*$/.test(pin.text)) this.fail(`bad net name "${pin.text}"`, pin.at);
      const signal = this.signals.get(pin.text);
      if (!signal) this.fail(`undeclared net ${pin.text}`, pin.at);
      if (signal.width !== 1) this.fail(`gate pins must be scalar nets; index bus ${signal.name} bit by bit`, pin.at);
    }
    this.addGate(type, inputs.map((pin) => pin.text), out.text, keyword.at);
  }

  /* ── always block ─────────────────────────────────────────────────── */

  private parseAlways(): void {
    const keyword = this.next();
    this.expect('@');
    this.expect('(');
    const edgeToken = this.expectIdentifier('posedge or negedge');
    if (edgeToken.text !== 'posedge' && edgeToken.text !== 'negedge') {
      this.fail('only posedge/negedge clocked always blocks are supported; use assign for combinational logic', edgeToken.at);
    }
    const clockToken = this.expectIdentifier('a clock net');
    this.expect(')');
    const clock = this.signals.get(clockToken.text);
    if (!clock) this.fail(`undeclared clock ${clockToken.text}`, clockToken.at);
    if (clock.width !== 1) this.fail(`clock ${clock.name} must be a scalar`, clockToken.at);
    const driver = this.driven.get(clock.bits[0]);
    if (driver && driver !== 'port' && driver !== 'flip-flop') {
      this.fail(`clock ${clock.name} is driven by logic; clock it from an input or an undriven net`, clockToken.at);
    }
    const statement = this.parseStatement();
    const targets = new Set<string>();
    this.collectTargets(statement, targets);
    if (targets.size === 0) this.fail('always block assigns nothing', keyword.at);
    for (const net of targets) {
      const signal = this.signalForNet(net);
      if (!signal || !signal.writableByAlways) {
        this.fail(`${net} is not a reg; only regs and output reg ports can be assigned in an always block`, keyword.at);
      }
    }

    const env = new Map<string, string>();
    for (const net of targets) env.set(net, net);
    this.execute(statement, env);

    const edge = edgeToken.text === 'posedge' ? 'rising' : 'falling';
    this.clocks.set(clock.bits[0], edge);
    const after = 1;
    for (const net of targets) {
      this.drive(net, 'flip-flop', keyword.at);
      const qbar = this.fresh('__qb');
      const flipFlop: FlipFlop = {
        id: `ff${(this.netlist.flipFlops?.length ?? 0) + 1}`,
        type: 'D',
        clock: clock.bits[0],
        edge,
        delay: after,
        inputs: { D: env.get(net) ?? net },
        q: net,
        qbar,
      };
      (this.netlist.flipFlops ??= []).push(flipFlop);
      this.reserved.add(qbar);
    }
  }

  private collectTargets(statement: Statement, out: Set<string>): void {
    if (statement.kind === 'assign') {
      for (const net of statement.targetNames ?? []) out.add(net);
    } else if (statement.kind === 'block') {
      for (const item of statement.items ?? []) this.collectTargets(item, out);
    } else if (statement.kind === 'if') {
      if (statement.then) this.collectTargets(statement.then, out);
      if (statement.otherwise) this.collectTargets(statement.otherwise, out);
    } else if (statement.kind === 'case') {
      for (const item of statement.caseItems ?? []) this.collectTargets(item.body, out);
    }
  }

  private execute(statement: Statement, env: Map<string, string>): void {
    if (statement.kind === 'empty') return;
    if (statement.kind === 'assign') {
      const names = statement.targetNames ?? [];
      const values = resize(statement.value ?? [], names.length);
      for (const [index, net] of names.entries()) env.set(net, this.lower(values[index]));
      return;
    }
    if (statement.kind === 'block') {
      for (const item of statement.items ?? []) this.execute(item, env);
      return;
    }
    if (statement.kind === 'if') {
      const select = this.lower(truthy(statement.cond ?? []));
      const thenEnv = new Map(env);
      if (statement.then) this.execute(statement.then, thenEnv);
      const elseEnv = new Map(env);
      if (statement.otherwise) this.execute(statement.otherwise, elseEnv);
      const keys = new Set([...thenEnv.keys(), ...elseEnv.keys()]);
      for (const key of keys) {
        const whenOne = thenEnv.get(key) ?? env.get(key) ?? key;
        const whenZero = elseEnv.get(key) ?? env.get(key) ?? key;
        env.set(key, this.mux(select, whenOne, whenZero));
      }
      return;
    }
    if (statement.kind === 'case') {
      const labelWidths = (statement.caseItems ?? []).flatMap((item) => item.labels.map((label) => label.length));
      const width = Math.max((statement.cond ?? []).length, ...labelWidths);
      const selector = resize(statement.cond ?? [], width);
      // Start from the default arm (or the held value), then fold every labelled
      // arm over it from the last to the first, so the first match wins.
      const result = new Map(env);
      const fallback = (statement.caseItems ?? []).find((item) => item.labels.length === 0);
      if (fallback) this.execute(fallback.body, result);      const arms = (statement.caseItems ?? []).filter((item) => item.labels.length > 0);
      for (let index = arms.length - 1; index >= 0; index -= 1) {
        const arm = arms[index];
        const armEnv = new Map(env);
        this.execute(arm.body, armEnv);
        let select: BitExpr = CONST0;
        for (const label of arm.labels) select = orBit(select, this.equalBits(selector, resize(label, width)));
        const selectNet = this.lower(select);
        const keys = new Set([...armEnv.keys(), ...result.keys()]);
        for (const key of keys) {
          const whenOne = armEnv.get(key) ?? result.get(key) ?? key;
          const whenZero = result.get(key) ?? env.get(key) ?? key;
          result.set(key, this.mux(selectNet, whenOne, whenZero));
        }
      }
      for (const [key, value] of result) env.set(key, value);
      return;
    }
  }

  /** Bitwise equality of two equal-width vectors, folded at construction time. */
  private equalBits(a: BitVec, b: BitVec): BitExpr {
    let equal: BitExpr = CONST1;
    for (let index = 0; index < a.length; index += 1) {
      equal = andBit(equal, notBit(xorBit(a[index], b[index])));
    }
    return equal;
  }

  private parseStatement(): Statement {
    if (this.accept(';')) return { kind: 'empty', at: this.peek().at };
    if (this.accept('begin')) {
      const items: Statement[] = [];
      while (!this.atEnd() && this.peek().text !== 'end') items.push(this.parseStatement());
      this.expect('end');
      return { kind: 'block', at: this.peek().at, items };
    }
    if (this.accept('if')) {
      const at = this.peek().at;
      this.expect('(');
      const cond = this.withWidth(null, () => this.parseExpression());
      this.expect(')');
      const then = this.parseStatement();
      const otherwise = this.accept('else') ? this.parseStatement() : undefined;
      return { kind: 'if', at, cond, then, otherwise };
    }
    if (this.accept('case')) {
      const at = this.peek().at;
      this.expect('(');
      const cond = this.withWidth(null, () => this.parseExpression());
      this.expect(')');
      const caseItems: CaseItem[] = [];
      let sawDefault = false;
      while (!this.atEnd() && this.peek().text !== 'endcase') {
        if (this.accept('default')) {
          if (sawDefault) this.fail('duplicate default arm in case', at);
          sawDefault = true;
          this.expect(':');
          caseItems.push({ labels: [], body: this.parseStatement() });
          continue;
        }
        const labels: BitVec[] = [];
        for (;;) {
          const labelAt = this.peek().at;
          const label = this.withWidth(null, () => this.parseExpression());
          if (!label.every((bit) => bit.kind === 'const')) {
            this.fail('case labels must be integer constants', labelAt);
          }
          labels.push(label);
          if (!this.accept(',')) break;
        }
        this.expect(':');
        caseItems.push({ labels, body: this.parseStatement() });
      }
      this.expect('endcase');
      return { kind: 'case', at, cond, caseItems };
    }
    const target = this.readReference('assignment target');
    if (!this.accept('<=')) {
      if (this.peek().text === '=') this.fail('use non-blocking "<=" inside a clocked always block', this.peek().at);
      this.fail('expected "<="', this.peek().at);
    }
    const value = this.withWidth(target.vec.length, () => this.parseExpression());
    this.expect(';');
    return { kind: 'assign', at: 0, target: target.vec, targetNames: target.nets, value };
  }

  /* ── references and expressions ───────────────────────────────────── */

  private signalForNet(net: string): Signal | undefined {
    for (const signal of this.signals.values()) if (signal.bits.includes(net)) return signal;
    return undefined;
  }

  private readReference(what: string): { signal: Signal; vec: BitVec; nets: string[] } {
    const token = this.expectIdentifier(what);
    const signal = this.signals.get(token.text);
    if (!signal) this.fail(`undeclared signal ${token.text}`, token.at);
    if (!this.accept('[')) {
      const nets = signal.bits;
      return { signal, vec: nets.map((name) => ({ kind: 'net', name })), nets };
    }
    const first = this.expectNumber();
    if (this.accept(':')) {
      const second = this.expectNumber();
      this.expect(']');
      if (first < second) this.fail('ascending part select is not supported', token.at);
      const nets: string[] = [];
      for (let index = second; index <= first; index += 1) {
        const position = signal.positions.indexOf(index);
        if (position < 0) this.fail(`bit ${index} is outside ${signal.name}`, token.at);
        nets.push(signal.bits[position]);
      }
      return { signal, vec: nets.map((name) => ({ kind: 'net', name })), nets };
    }
    this.expect(']');
    const position = signal.positions.indexOf(first);
    if (position < 0) this.fail(`bit ${first} is outside ${signal.name}`, token.at);
    const name = signal.bits[position];
    return { signal, vec: [{ kind: 'net', name }], nets: [name] };
  }

  private withWidth<T>(width: number | null, parse: () => T): T {
    const previous = this.contextWidth;
    this.contextWidth = width;
    try {
      return parse();
    } finally {
      this.contextWidth = previous;
    }
  }

  private parseExpression(): BitVec {
    return this.parseTernary();
  }

  private parseTernary(): BitVec {
    const cond = this.parseLogicalOr();
    if (!this.accept('?')) return cond;
    const whenOne = this.parseTernary();
    this.expect(':');
    const whenZero = this.parseTernary();
    const width = Math.max(whenOne.length, whenZero.length);
    const select = truthy(cond);
    return Array.from({ length: width }, (_, index) =>
      muxBit(select, resize(whenOne, width)[index], resize(whenZero, width)[index]),
    );
  }

  private binaryVec(left: BitVec, right: BitVec, op: 'and' | 'or' | 'xor'): BitVec {
    const width = Math.max(left.length, right.length);
    const a = resize(left, width);
    const b = resize(right, width);
    const combine = op === 'and' ? andBit : op === 'or' ? orBit : xorBit;
    return a.map((bit, index) => combine(bit, b[index]));
  }

  private parseLogicalOr(): BitVec {
    let left = this.parseLogicalAnd();
    while (this.accept('||')) {
      const right = this.parseLogicalAnd();
      left = [orBit(truthy(left), truthy(right))];
    }
    return left;
  }

  private parseLogicalAnd(): BitVec {
    let left = this.parseBitOr();
    while (this.accept('&&')) {
      const right = this.parseBitOr();
      left = [andBit(truthy(left), truthy(right))];
    }
    return left;
  }

  private parseBitOr(): BitVec {
    let left = this.parseBitXor();
    while (this.accept('|')) left = this.binaryVec(left, this.parseBitXor(), 'or');
    return left;
  }

  private parseBitXor(): BitVec {
    let left = this.parseBitAnd();
    while (this.accept('^')) left = this.binaryVec(left, this.parseBitAnd(), 'xor');
    return left;
  }

  private parseBitAnd(): BitVec {
    let left = this.parseEquality();
    while (this.accept('&')) left = this.binaryVec(left, this.parseEquality(), 'and');
    return left;
  }

  private parseEquality(): BitVec {
    let left = this.parseAdditive();
    for (;;) {
      const negate = this.accept('!=');
      const equal = !negate && this.accept('==');
      if (!negate && !equal) return left;
      const right = this.parseAdditive();
      const width = Math.max(left.length, right.length);
      const a = resize(left, width);
      const b = resize(right, width);
      let equalBit: BitExpr = CONST1;
      for (let index = 0; index < width; index += 1) {
        equalBit = andBit(equalBit, notBit(xorBit(a[index], b[index])));
      }
      left = [negate ? notBit(equalBit) : equalBit];
    }
  }

  /**
   * Unsigned add/subtract at the context width (or the widest operand), lowered
   * to a ripple-carry chain. Subtraction complements the right operand and
   * injects a carry-in of one, which is two's complement modulo the width.
   */
  private parseAdditive(): BitVec {
    let left = this.parseUnary();
    for (;;) {
      const subtract = this.accept('-');
      const add = !subtract && this.accept('+');
      if (!add && !subtract) return left;
      left = this.rippleAdd(left, this.parseUnary(), subtract);
    }
  }

  private rippleAdd(left: BitVec, right: BitVec, subtract: boolean): BitVec {
    const width = Math.max(this.contextWidth ?? 0, left.length, right.length);
    const a = resize(left, width);
    const b = resize(right, width);
    let carry: BitExpr = subtract ? CONST1 : CONST0;
    const result: BitVec = [];
    for (let bit = 0; bit < width; bit += 1) {
      const operand = subtract ? notBit(b[bit]) : b[bit];
      const partial = xorBit(a[bit], operand);
      result.push(xorBit(partial, carry));
      carry = orBit(andBit(a[bit], operand), andBit(carry, partial));
    }
    return result;
  }

  private parseUnary(): BitVec {
    if (this.accept('~')) {
      const operand = this.parseUnary();
      const width = Math.max(this.contextWidth ?? 0, operand.length);
      return resize(operand, width).map(notBit);
    }
    if (this.accept('!')) return [notBit(truthy(this.parseUnary()))];
    if (this.accept('&')) return [reduce(this.parseUnary(), 'and')];
    if (this.accept('|')) return [reduce(this.parseUnary(), 'or')];
    if (this.accept('^')) return [reduce(this.parseUnary(), 'xor')];
    return this.parsePrimary();
  }

  private parsePrimary(): BitVec {
    if (this.accept('(')) {
      const inner = this.parseExpression();
      this.expect(')');
      return inner;
    }
    const token = this.peek();
    if (token.kind === 'number') {
      this.next();
      return this.readLiteral(token);
    }
    if (token.kind === 'id') {
      return this.readReference('a signal').vec;
    }
    return this.fail(`unexpected "${token.text}" in expression`, token.at);
  }

  private readLiteral(token: Token): BitVec {
    const sized = token.text.match(/^(\d*)'([bBdDhH])([0-9a-fA-F_xXzZ]+)$/);
    if (!sized) {
      const value = Number(token.text);
      if (!Number.isSafeInteger(value) || value < 0) this.fail(`unsupported literal "${token.text}"`, token.at);
      const bits: BitVec = [];
      let rest = value;
      do {
        bits.push(rest % 2 === 1 ? CONST1 : CONST0);
        rest = Math.floor(rest / 2);
      } while (rest > 0);
      return bits;
    }
    const declaredWidth = sized[1] ? Number(sized[1]) : 0;
    const base = sized[2].toLowerCase();
    const digits = sized[3].replace(/_/g, '');
    if (/[xXzZ]/.test(digits)) this.fail('x/z literals cannot be mapped to gates', token.at);
    const seed = base === 'b' ? 2 : base === 'h' ? 16 : 10;
    let value = 0n;
    for (const digit of digits.toLowerCase()) {
      const number = parseInt(digit, seed);
      if (!Number.isInteger(number) || number >= seed) this.fail(`bad literal "${token.text}"`, token.at);
      value = value * BigInt(seed) + BigInt(number);
    }
    let width = declaredWidth;
    if (width === 0) {
      width = 1;
      let rest = value;
      while (rest > 1n) { rest >>= 1n; width += 1; }
    }
    const bits: BitVec = [];
    for (let index = 0; index < width; index += 1) {
      bits.push((value >> BigInt(index)) & 1n ? CONST1 : CONST0);
    }
    return bits;
  }

  /* ── lowering ─────────────────────────────────────────────────────── */

  private constant(value: 0 | 1): string {
    this.usesConstants = true;
    return value === 1 ? VDD : GND;
  }

  private lower(expr: BitExpr): string {
    const cached = this.lowered.get(expr);
    if (cached !== undefined) return cached;
    let result: string;
    if (expr.kind === 'net') {
      result = expr.name;
    } else if (expr.kind === 'const') {
      result = this.constant(expr.value);
    } else if (expr.kind === 'not') {
      result = this.gate('NOT', [this.lower(expr.a)]);
    } else {
      const left = this.lower(expr.a);
      const right = this.lower(expr.b);
      const type: GateType = expr.op === 'and' ? 'AND' : expr.op === 'or' ? 'OR' : 'XOR';
      result = left === right ? (expr.op === 'xor' ? this.constant(0) : left) : this.gate(type, [left, right]);
    }
    this.lowered.set(expr, result);
    return result;
  }

  private mux(select: string, whenOne: string, whenZero: string): string {
    if (whenOne === whenZero) return whenOne;
    if (whenOne === GND) return this.gate('AND', [this.gate('NOT', [select]), whenZero]);
    if (whenZero === GND) return this.gate('AND', [select, whenOne]);
    if (whenOne === VDD) return this.gate('OR', [select, whenZero]);
    if (whenZero === VDD) return this.gate('OR', [whenOne, this.gate('NOT', [select])]);
    const selectAndOne = this.gate('AND', [select, whenOne]);
    const notSelect = this.gate('NOT', [select]);
    const notSelectAndZero = this.gate('AND', [notSelect, whenZero]);
    return this.gate('OR', [selectAndOne, notSelectAndZero]);
  }

  private fresh(prefix: string): string {
    let name = `${prefix}${++this.tempSerial}`;
    while (this.reserved.has(name)) name = `${prefix}${++this.tempSerial}`;
    this.reserved.add(name);
    return name;
  }

  private gate(type: GateType, inputs: string[]): string {
    return this.addGate(type, inputs, this.fresh('__t'), this.source.length);
  }

  private addGate(type: GateType, inputs: string[], output: string, at: number): string {
    if (inputs.some((net) => net === output)) {
      this.fail(`gate ${type} would drive its own input ${output}`, at);
    }
    if (this.driven.has(output)) this.fail(`net ${output} driven twice`, at);
    this.driven.set(output, `gate:${type}`);
    this.gateSerial += 1;
    this.netlist.gates.push({
      id: `g${this.gateSerial}`,
      type,
      output,
      inputs,
      delay: 1,
    });
    return output;
  }

  private drive(net: string, kind: string, at: number): void {
    if (this.driven.has(net)) this.fail(`net ${net} driven twice`, at);
    this.driven.set(net, kind);
  }

  /**
   * Longest combinational path, in gate delays. The generated clock uses it so
   * a sequential design gets a period its own logic can settle inside; this is
   * still a functional clock, not a timing sign-off (the SKY130 STA pass is the
   * sign-off for a mapped design).
   */
  private combinationalDepth(): number {
    const byOutput = new Map(this.netlist.gates.map((gate) => [gate.output, gate]));
    const memo = new Map<string, number>();
    const visiting = new Set<string>();
    const depth = (net: string): number => {
      const settled = memo.get(net);
      if (settled !== undefined) return settled;
      const gate = byOutput.get(net);
      if (!gate || visiting.has(net)) return 0;
      visiting.add(net);
      let deepest = 0;
      for (const input of gate.inputs) deepest = Math.max(deepest, depth(input));
      visiting.delete(net);
      const result = deepest + 1;
      memo.set(net, result);
      return result;
    };
    let deepest = 0;
    for (const gate of this.netlist.gates) deepest = Math.max(deepest, depth(gate.output));
    return deepest;
  }

  finish(ports: readonly VPort[]): DigitalNetlist {
    for (const port of ports) {
      if (port.direction !== 'output') continue;
      if (port.bits.every((bit) => this.driven.has(bit))) continue;
      this.fail(`output ${port.name} is never driven`, this.source.length);
    }
    const depth = this.combinationalDepth();
    const period = Math.max(10, 2 * (depth + 2));
    for (const [clock, edge] of this.clocks) {
      const clocks = (this.netlist.clocks ??= []);
      clocks.push({
        id: `clk${clocks.length + 1}`,
        output: clock,
        period,
        duty: 0.5,
        startState: edge === 'rising' ? 0 : 1,
      });
    }
    if (this.usesConstants) {
      this.netlist.initialValues = { [GND]: 0, [VDD]: 1 };
    }
    return this.netlist;
  }
}

/** Elaborate a full source string into ports + a runnable digital netlist. */
export function parseVerilogModule(source: string): VerilogElaboration {
  const rawLines = source.split(/\r?\n/);
  const clean = stripComments(source);
  const { name, ports } = parseModuleHeader(clean, rawLines[0] ?? '');
  if (!/endmodule/i.test(clean)) {
    throw new VerilogParseError(`module ${name} missing endmodule`, rawLines.length, rawLines[rawLines.length - 1] ?? '');
  }
  const headerSemicolon = clean.indexOf(';');
  const endmodule = clean.search(/\bendmodule\b/i);
  if (endmodule < 0) throw new VerilogParseError(`module ${name} missing endmodule`, rawLines.length, '');
  const body = clean.slice(headerSemicolon + 1, endmodule);
  const netlist: DigitalNetlist = { gates: [], flipFlops: [], clocks: [], stimuli: [] };
  let tokens: Token[];
  try {
    tokens = tokenize(body, headerSemicolon + 1);
  } catch (error) {
    const message = (error as Error).message;
    throw new VerilogParseError(message, 1, body.trim().split('\n')[0] ?? '');
  }
  const parser = new BodyParser(tokens, clean, source, netlist, ports);
  parser.parse();
  return { name, ports, netlist: parser.finish(ports) };
}
