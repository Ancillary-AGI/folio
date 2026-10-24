/**
 * Strict, line-oriented parser for a compact digital netlist.
 *
 * The digital engine (`digitalLogic.ts`) is the trustworthy part; this is only
 * the text form the UI and tests feed it. It is deliberately tiny and strict:
 * every unrecognised line, malformed token, unknown gate/flip-flop, bad delay
 * or unknown logic value raises `DigitalParseError` naming the line number and
 * what was wrong. It never silently drops a line or guesses an intent — the
 * same fail-loud discipline as the solver.
 *
 * Grammar (one statement per line, `#` starts a comment):
 *
 *   GATE   <id> <TYPE> out=<node> in=<n1>[,<n2>...] [delay=<d>]
 *   FF     <id> D|T|JK|SR clock=<node> q=<node> qbar=<node> [in=<...>] [delay=<d>]
 *   CLOCK  <id> out=<node> period=<p> [duty=<f>] [start=0|1]
 *   SET    <node> <0|1|X|Z> [@<time>]
 *   RUN    until=<time>
 */

import type { Clock, DigitalNetlist, FlipFlopType, Gate, GateType, LogicValue, Stimulus } from './digitalLogic'

export class DigitalParseError extends Error {
  constructor(
    message: string,
    readonly lineNumber: number,
    readonly line: string,
  ) {
    super(`line ${lineNumber}: ${message} — "${line}"`)
    this.name = 'DigitalParseError'
  }
}

const GATE_TYPES: GateType[] = ['NOT', 'BUF', 'AND', 'NAND', 'OR', 'NOR', 'XOR', 'XNOR']
const FF_TYPES: FlipFlopType[] = ['D', 'T', 'JK', 'SR']
const LOGIC_VALUES: LogicValue[] = [0, 1, 'X', 'Z']

const isLogicValue = (value: string): value is `${LogicValue}` =>
  value === '0' || value === '1' || value === 'X' || value === 'Z'

const parseLogicValue = (raw: string, lineNumber: number, line: string): LogicValue => {
  const value = raw.toUpperCase()
  if (!isLogicValue(value)) throw new DigitalParseError(`expected 0/1/X/Z, got "${raw}"`, lineNumber, line)
  return (value === '0' ? 0 : value === '1' ? 1 : value === 'X' ? 'X' : 'Z') as LogicValue
}

const parseDelay = (raw: string | undefined, lineNumber: number, line: string): number => {
  if (raw === undefined) return 1
  const delay = Number(raw)
  if (!Number.isFinite(delay) || delay < 0) {
    throw new DigitalParseError(`delay must be a finite number >= 0, got "${raw}"`, lineNumber, line)
  }
  return delay
}
/** Parse `key=value` tokens into a lowercase-keyed map. */
function tokenize(line: string): Map<string, string> {
  const tokens = line.trim().split(/\s+/)
  const map = new Map<string, string>()
  for (const token of tokens) {
    const eq = token.indexOf('=')
    if (eq > 0) map.set(token.slice(0, eq).toLowerCase(), token.slice(eq + 1))
    else if (!map.has('_op0')) map.set('_op0', token)
  }
  return map
}

export interface ParsedDigitalNetlist {
  netlist: DigitalNetlist
  until: number
}

export function parseDigitalNetlist(text: string): ParsedDigitalNetlist {
  const gates: Gate[] = []
  const flipFlops: NonNullable<DigitalNetlist['flipFlops']> = []
  const clocks: Clock[] = []
  const stimuli: Stimulus[] = []
  let until = 100

  const lines = text.split(/\r?\n/)
  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1
    const stripped = rawLine.replace(/#.*$/, '').trim()
    if (stripped === '') return

    const tokens = tokenize(stripped)
    const keyword = tokens.get('_op0')?.toUpperCase()

    switch (keyword) {
      case 'GATE': {
        const parts = stripped.split(/\s+/)
        const id = parts[1]
        if (!id) throw new DigitalParseError('GATE requires an id', lineNumber, rawLine)
        const type = (parts[2] ?? '').toUpperCase() as GateType
        if (!GATE_TYPES.includes(type)) {
          throw new DigitalParseError(`unknown gate type "${parts[2] ?? ''}"`, lineNumber, rawLine)
        }
        const output = tokens.get('out')
        if (!output) throw new DigitalParseError('GATE requires out=<node>', lineNumber, rawLine)
        const inputs = (tokens.get('in') ?? '').split(',').filter((node) => node !== '')
        if (inputs.length === 0) throw new DigitalParseError('GATE requires in=<n1>[,n2...]', lineNumber, rawLine)
        if ((type === 'NOT' || type === 'BUF') && inputs.length !== 1) {
          throw new DigitalParseError(`${type} takes exactly one input`, lineNumber, rawLine)
        }
        gates.push({ id, type, inputs, output, delay: parseDelay(tokens.get('delay'), lineNumber, rawLine) })
        break
      }
      case 'FF': {
        const parts = stripped.split(/\s+/)
        const id = parts[1]
        if (!id) throw new DigitalParseError('FF requires an id', lineNumber, rawLine)
        const type = (parts[2] ?? '').toUpperCase() as FlipFlopType
        if (!FF_TYPES.includes(type)) {
          throw new DigitalParseError(`unknown flip-flop type "${parts[2] ?? ''}"`, lineNumber, rawLine)
        }
        const clock = tokens.get('clock')
        const q = tokens.get('q')
        const qbar = tokens.get('qbar')
        if (!clock || !q || !qbar) throw new DigitalParseError('FF requires clock=, q= and qbar=', lineNumber, rawLine)
        const inputs: Record<string, string> = {}
        for (const [role, node] of tokens) {
          if (role === 'in') {
            for (const entry of node.split(',')) {
              const [r, n] = entry.split(':')
              if (r && n) inputs[r.toUpperCase()] = n
            }
          } else if (['D', 'T', 'J', 'K', 'S', 'R'].includes(role.toUpperCase())) {
            inputs[role.toUpperCase()] = node
          }
        }
        const edgeRaw = (tokens.get('edge') ?? 'rising').toLowerCase()
        if (edgeRaw !== 'rising' && edgeRaw !== 'falling') {
          throw new DigitalParseError(`FF edge must be rising or falling, got "${tokens.get('edge')}"`, lineNumber, rawLine)
        }
        flipFlops.push({
          id,
          type,
          clock,
          q,
          qbar,
          inputs,
          edge: edgeRaw,
          delay: parseDelay(tokens.get('delay'), lineNumber, rawLine),
        })
        break
      }
      case 'CLOCK': {
        const id = stripped.split(/\s+/)[1]
        const output = tokens.get('out')
        if (!output) throw new DigitalParseError('CLOCK requires out=<node>', lineNumber, rawLine)
        const period = Number(tokens.get('period'))
        if (!Number.isFinite(period) || period <= 0) {
          throw new DigitalParseError('CLOCK period must be > 0', lineNumber, rawLine)
        }
        const dutyRaw = tokens.get('duty')
        const duty = dutyRaw === undefined ? undefined : Number(dutyRaw)
        if (duty !== undefined && (!Number.isFinite(duty) || duty <= 0 || duty >= 1)) {
          throw new DigitalParseError('CLOCK duty must be in (0,1)', lineNumber, rawLine)
        }
        const startRaw = tokens.get('start')
        const startState = startRaw === undefined ? undefined : parseLogicValue(startRaw, lineNumber, rawLine)
        if (startState !== undefined && startState !== 0 && startState !== 1) {
          throw new DigitalParseError('CLOCK start must be 0 or 1', lineNumber, rawLine)
        }
        clocks.push({ id: id ?? output, output, period, duty, startState })
        break
      }
      case 'SET': {
        const node = stripped.split(/\s+/)[1]
        if (!node) throw new DigitalParseError('SET requires a node', lineNumber, rawLine)
        const value = parseLogicValue(stripped.split(/\s+/)[2] ?? '', lineNumber, rawLine)
        const atRaw = stripped.split(/\s+/)[3]
        if (atRaw !== undefined && !atRaw.startsWith('@')) {
          throw new DigitalParseError('SET time must use @<time>', lineNumber, rawLine)
        }
        const at = atRaw === undefined ? 0 : Number(atRaw.slice(1))
        if (!Number.isFinite(at) || at < 0) {
          throw new DigitalParseError('SET time must be a non-negative number after @', lineNumber, rawLine)
        }
        stimuli.push({ node, value, time: at })
        break
      }
      case 'RUN': {
        const value = Number(tokens.get('until'))
        if (!Number.isFinite(value) || value <= 0) {
          throw new DigitalParseError('RUN requires until=<positive number>', lineNumber, rawLine)
        }
        until = value
        break
      }
      default:
        throw new DigitalParseError(`unknown statement "${stripped.split(/\s+/)[0] ?? ''}"`, lineNumber, rawLine)
    }
  })

  return { netlist: { gates, flipFlops, clocks, stimuli }, until }
}

export { LOGIC_VALUES }

