/**
 * SPICE parameter expressions: `.param`, `.func` and `{…}` substitution.
 *
 * A deck writes `R1 a b {gain*1k}` and defines `gain` with a `.param` card, an
 * `X` instance parameter or a `.func` helper. The solver never sees a brace:
 * this module evaluates them at import time and hands the parser a plain
 * number, so an unknown parameter is a deck error that names the card using it
 * instead of a silent zero.
 *
 * Scoping is shadowed inheritance: a child scope starts as a copy of its
 * parent's definitions, so a subcircuit sees the global parameters, its own
 * `.param` cards override those, and an instance's `name=value` overrides
 * those again. Each scope owns fresh parameter records, which is what makes a
 * memoised `{x*2}` safe — one instance's `x` cannot leak into another's.
 */

import { parseSpiceValue } from './devices'
import { BEHAVIORAL_CONSTANTS, BEHAVIORAL_FUNCTIONS } from './circuitModel'

export interface SpiceParameter {
  readonly expr: string
  value: number
  resolved: boolean
  resolving: boolean
}

export interface SpiceFunction {
  readonly args: readonly string[]
  readonly body: string
}

export interface SpiceScope {
  readonly params: Map<string, SpiceParameter>
  readonly funcs: Map<string, SpiceFunction>
}

/** Cap on expression nesting and `.func` recursion: a typo, not a workload. */
const MAX_NESTING = 32

export const createSpiceScope = (): SpiceScope => ({ params: new Map(), funcs: new Map() })

export function childSpiceScope(parent: SpiceScope): SpiceScope {
  return {
    params: new Map([...parent.params].map(([name, entry]) => [name, { ...entry }])),
    funcs: new Map(parent.funcs),
  }
}

export function defineSpiceParam(scope: SpiceScope, name: string, expr: string): void {
  scope.params.set(name.toLowerCase(), { expr, value: 0, resolved: false, resolving: false })
}

export function defineSpiceFunc(scope: SpiceScope, name: string, args: readonly string[], body: string): void {
  scope.funcs.set(name.toLowerCase(), { args, body })
}

type Token = { kind: 'number'; value: number } | { kind: 'ident'; name: string } | { kind: 'op'; text: string }

const OPERATORS = ['<=', '>=', '==', '!=', '&&', '||', '**', '+', '-', '*', '/', '%', '^', '(', ')', ',', '<', '>', '=', '!', '?', ':']

function lexExpression(text: string, label: string): Token[] {
  /*
   * ngspice lets a parameter be spelled `$x`, `${x}` or `param::x`. All three
   * mean the same lookup, so the sigil and the scope prefix are folded away
   * before the grammar sees them and one identifier rule covers every deck.
   */
  const normalised = text
    .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, '$1')
    .replace(/\b(?:param|p)::/gi, '')
  const tokens: Token[] = []
  let index = 0
  while (index < normalised.length) {
    const rest = normalised.slice(index)
    const space = /^\s+/.exec(rest)
    if (space) {
      index += space[0].length
      continue
    }
    const numeric = /^[0-9]+\.?[0-9]*(?:e[+-]?[0-9]+)?[a-zµμ]*|^\.[0-9]+(?:e[+-]?[0-9]+)?[a-zµμ]*/i.exec(rest)
    if (numeric) {
      tokens.push({ kind: 'number', value: parseSpiceValue(numeric[0], `${label} number "${numeric[0]}"`) })
      index += numeric[0].length
      continue
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)
    if (identifier) {
      tokens.push({ kind: 'ident', name: identifier[0].toLowerCase() })
      index += identifier[0].length
      continue
    }
    const operator = OPERATORS.find((candidate) => rest.startsWith(candidate))
    if (!operator) throw new Error(`${label}: unexpected "${rest[0]}".`)
    /*
     * SPICE writes equality with a bare `=` inside an expression, and `**` for
     * a power; both fold onto the operator the grammar already knows.
     */
    const folded = operator === '=' ? '==' : operator === '**' ? '^' : operator
    tokens.push({ kind: 'op', text: folded })
    index += operator.length
  }
  return tokens
}

interface Evaluator {
  readonly scope: SpiceScope
  readonly label: string
  readonly tokens: Token[]
  index: number
  depth: number
}

const peek = (state: Evaluator): Token | undefined => state.tokens[state.index]

const consume = (state: Evaluator, text: string): boolean => {
  const token = peek(state)
  if (token?.kind !== 'op' || token.text !== text) return false
  state.index += 1
  return true
}

function requireOperator(state: Evaluator, text: string): void {
  if (consume(state, text)) return
  const found = peek(state)
  throw new Error(
    `${state.label}: expected "${text}"${found === undefined ? ' but the expression ended' : `, found "${tokenText(found)}"`}.`,
  )
}

const tokenText = (token: Token): string => (token.kind === 'number' ? String(token.value) : token.kind === 'ident' ? token.name : token.text)

function enter(state: Evaluator): void {
  state.depth += 1
  if (state.depth > MAX_NESTING) throw new Error(`${state.label}: nests more than ${MAX_NESTING} levels deep.`)
}

const leave = (state: Evaluator): void => {
  state.depth -= 1
}

/**
 * Evaluate `text` against `scope`.
 *
 * The grammar is the arithmetic, comparison and logic subset SPICE allows in a
 * parameter or `.func` body: `+ - * / % ^`, unary `- + !`, comparisons and
 * `&&`/`||` returning 1/0, the ternary `a ? b : c`, parentheses, the built-in
 * functions the B-source already knows, user `.func` calls and parameters.
 * Anything else is a parse error — no text is ever handed to `eval`.
 */
export function evaluateSpiceExpression(text: string, scope: SpiceScope, label: string): number {
  const tokens = lexExpression(text, label)
  if (tokens.length === 0) throw new Error(`${label}: expression is empty.`)
  const state: Evaluator = { scope, label, tokens, index: 0, depth: 0 }
  const value = parseTernary(state)
  if (state.index < tokens.length) {
    throw new Error(`${label}: unexpected "${tokenText(tokens[state.index])}" after the expression.`)
  }
  if (!Number.isFinite(value)) throw new Error(`${label}: "${text}" evaluates to ${value}.`)
  return value
}

function parseTernary(state: Evaluator): number {
  const condition = parseBinary(state, 0)
  if (!consume(state, '?')) return condition
  // SPICE evaluates only the arm the condition selects; the other arm is
  // skipped, never evaluated — an undefined parameter there is not an error.
  if (condition !== 0) {
    const whenTrue = parseTernary(state)
    requireOperator(state, ':')
    skipTernary(state)
    return whenTrue
  }
  skipTernary(state)
  requireOperator(state, ':')
  return parseTernary(state)
}

/*
 * Grammar-shaped skippers: consume one sub-expression's tokens without
 * evaluating anything. parseTernary and the &&/|| short-circuit use these so
 * an untaken arm costs nothing and can contain deck constructs this scope
 * cannot resolve (undefined corner parameters, unknown functions). They must
 * mirror the grammar above; drift between the two is a silent mis-skip, so
 * keep them side by side.
 */
function skipTernary(state: Evaluator): void {
  skipBinary(state, 0)
  if (consume(state, '?')) {
    enter(state)
    skipTernary(state)
    requireOperator(state, ':')
    skipTernary(state)
    leave(state)
  }
}

function skipBinary(state: Evaluator, level: number): void {
  if (level >= PRECEDENCE.length) {
    skipUnary(state)
    return
  }
  skipBinary(state, level + 1)
  for (;;) {
    const token = peek(state)
    const operator = token?.kind === 'op' && PRECEDENCE[level].includes(token.text) ? token.text : undefined
    if (operator === undefined) return
    state.index += 1
    skipBinary(state, level + 1)
  }
}

function skipUnary(state: Evaluator): void {
  if (consume(state, '-') || consume(state, '+') || consume(state, '!')) {
    enter(state)
    skipUnary(state)
    leave(state)
    return
  }
  // `^` binds to the right of the base inside parsePower.
  skipPower(state)
}

function skipPower(state: Evaluator): void {
  skipPrimary(state)
  if (consume(state, '^')) skipUnary(state)
}

function skipPrimary(state: Evaluator): void {
  const token = peek(state)
  if (token === undefined) throw new Error(`${state.label}: the expression ends early.`)
  if (token.kind === 'number') {
    state.index += 1
    return
  }
  if (consume(state, '(')) {
    enter(state)
    skipTernary(state)
    requireOperator(state, ')')
    leave(state)
    return
  }
  if (token.kind !== 'ident') throw new Error(`${state.label}: unexpected "${tokenText(token)}".`)
  state.index += 1
  if (!consume(state, '(')) return
  enter(state)
  if (consume(state, ')')) {
    leave(state)
    return
  }
  for (;;) {
    skipTernary(state)
    if (consume(state, ',')) continue
    requireOperator(state, ')')
    break
  }
  leave(state)
}

const PRECEDENCE: readonly string[][] = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<', '>', '<=', '>='],
  ['+', '-'],
  ['*', '/', '%'],
]

function parseBinary(state: Evaluator, level: number): number {
  if (level >= PRECEDENCE.length) return parseUnary(state)
  let left = parseBinary(state, level + 1)
  for (;;) {
    const token = peek(state)
    const operator = token?.kind === 'op' && PRECEDENCE[level].includes(token.text) ? token.text : undefined
    if (operator === undefined) return left
    state.index += 1
    // Logical operators short-circuit (SPICE semantics): the untaken arm is
    // skipped, never evaluated.
    if (operator === '&&' && left === 0) {
      skipBinary(state, level + 1)
      continue
    }
    if (operator === '||' && left !== 0) {
      skipBinary(state, level + 1)
      continue
    }
    const right = parseBinary(state, level + 1)
    left = apply(operator, left, right, state.label)
  }
}

function apply(operator: string, left: number, right: number, label: string): number {
  switch (operator) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      return left / right
    case '%':
      return left % right
    case '<':
      return left < right ? 1 : 0
    case '>':
      return left > right ? 1 : 0
    case '<=':
      return left <= right ? 1 : 0
    case '>=':
      return left >= right ? 1 : 0
    case '==':
      return left === right ? 1 : 0
    case '!=':
      return left !== right ? 1 : 0
    case '&&':
      return left !== 0 && right !== 0 ? 1 : 0
    case '||':
      return left !== 0 || right !== 0 ? 1 : 0
    default:
      // Unreachable through the grammar — a new operator must be handled here,
      // not silently pass its left operand through.
      throw new Error(`${label}: unsupported operator "${operator}".`)
  }
}

function parseUnary(state: Evaluator): number {
  if (consume(state, '-')) return -parseUnary(state)
  if (consume(state, '+')) return parseUnary(state)
  if (consume(state, '!')) return parseUnary(state) === 0 ? 1 : 0
  return parsePower(state)
}

/** `2^3^2` is `2^(3^2)`, and the exponent binds tighter than a unary minus. */
function parsePower(state: Evaluator): number {
  const base = parsePrimary(state)
  if (!consume(state, '^')) return base
  const exponent = parseUnary(state)
  return Math.pow(base, exponent)
}

function parsePrimary(state: Evaluator): number {
  const token = peek(state)
  if (token === undefined) throw new Error(`${state.label}: the expression ends early.`)
  if (token.kind === 'number') {
    state.index += 1
    return token.value
  }
  if (consume(state, '(')) {
    enter(state)
    const inner = parseTernary(state)
    requireOperator(state, ')')
    leave(state)
    return inner
  }
  if (token.kind !== 'ident') throw new Error(`${state.label}: unexpected "${tokenText(token)}".`)
  state.index += 1
  const next = peek(state)
  const isCall = next?.kind === 'op' && next.text === '('
  if (!isCall) {
    const constant = BEHAVIORAL_CONSTANTS[token.name]
    if (constant !== undefined) return constant
    return readParameter(state, token.name)
  }
  state.index += 1
  enter(state)
  const args: number[] = []
  if (!consume(state, ')')) {
    for (;;) {
      args.push(parseTernary(state))
      if (consume(state, ',')) continue
      requireOperator(state, ')')
      break
    }
  }
  leave(state)
  return callFunction(state, token.name, args)
}

function readParameter(state: Evaluator, name: string): number {
  const entry = state.scope.params.get(name)
  if (entry === undefined) throw new Error(`${state.label}: parameter "${name}" is not defined.`)
  if (entry.resolving) throw new Error(`${state.label}: parameter "${name}" is defined in a cycle.`)
  if (entry.resolved) return entry.value
  entry.resolving = true
  try {
    entry.value = evaluateSpiceExpression(entry.expr, state.scope, `${state.label} (parameter ${name})`)
  } finally {
    entry.resolving = false
  }
  entry.resolved = true
  return entry.value
}

function callFunction(state: Evaluator, name: string, args: number[]): number {
  const builtin = BEHAVIORAL_FUNCTIONS[name]
  if (builtin !== undefined) {
    const value = builtin(...args)
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`${state.label}: ${name}(...) has no numeric result for ${args.join(', ')}.`)
    }
    return value
  }
  const user = state.scope.funcs.get(name)
  if (user === undefined) throw new Error(`${state.label}: unknown function "${name}".`)
  if (args.length !== user.args.length) {
    throw new Error(`${state.label}: ${name}() takes ${user.args.length} argument(s), got ${args.length}.`)
  }
  /*
   * A `.func` body is looked up in the scope of its caller, so a function can
   * read the parameters of the subcircuit that calls it — the way ngspice
   * resolves `eval()` inside a hierarchy.
   */
  const local = childSpiceScope(state.scope)
  user.args.forEach((arg, at) => defineSpiceParam(local, arg, String(args[at])))
  return evaluateSpiceExpression(user.body, local, `${state.label} (function ${name})`)
}

/**
 * Render a number so `parseSpiceValue` reads it back unchanged.
 *
 * Engineering suffixes are deliberately avoided: `4e-2` round-trips, `40m`
 * would be re-read as milli, and a long decimal string is what a hand-written
 * card would have said anyway.
 */
export function formatSpiceNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`"${value}" is not a finite number.`)
  if (value === 0) return '0'
  const magnitude = Math.abs(value)
  if (Number.isInteger(value) && magnitude >= 1 && magnitude < 1e15) return String(value)
  return value.toExponential().replace('e+', 'e')
}

/**
 * Replace every `{expression}` in a deck line with its evaluated value.
 *
 * Brace groups nest, so `{a{b}}` is read as one group; quotes are respected so
 * a literal never rewrites itself. This is the textual pre-substitution SPICE
 * itself performs, which is why the rest of the importer never has to know a
 * parameter existed.
 */
export function substituteBraces(text: string, scope: SpiceScope, label: string): string {
  if (!text.includes('{')) return text
  let output = ''
  let index = 0
  while (index < text.length) {
    const character = text[index]
    if (character === '"' || character === "'") {
      const closing = text.indexOf(character, index + 1)
      if (closing === -1) {
        output += text.slice(index)
        break
      }
      output += text.slice(index, closing + 1)
      index = closing + 1
      continue
    }
    if (character !== '{') {
      output += character
      index += 1
      continue
    }
    let depth = 0
    let end = -1
    for (let at = index; at < text.length; at += 1) {
      if (text[at] === '{') depth += 1
      else if (text[at] === '}') {
        depth -= 1
        if (depth === 0) {
          end = at
          break
        }
      }
    }
    if (end === -1) throw new Error(`${label}: "{${text.slice(index + 1)}" is never closed.`)
    const expression = text.slice(index + 1, end).trim()
    if (expression === '') throw new Error(`${label}: "{{}}" is empty.`)
    output += formatSpiceNumber(evaluateSpiceExpression(expression, scope, label))
    index = end + 1
  }
  return output
}
