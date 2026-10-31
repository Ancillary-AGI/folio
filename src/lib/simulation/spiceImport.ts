/**
 * SPICE deck import.
 *
 * The importer reads the subset of a SPICE deck this solver can actually run and
 * reports every construct it does not support. It never drops an element or a
 * card silently: a deck either becomes a `CircuitNetlist` with warnings that
 * name what was ignored, or it returns errors that say why it was refused.
 *
 * Supported elements: R, C, L, V, I, D, Q, M, J, E, G, B, S, W (with explicit
 * parameters), T and K. Supported cards: `.model`, `.op`, `.dc`, `.tran`, `.ac`,
 * `.noise`, `.temp`, `.options`, `.end` and `.title`. Subcircuits (`X`),
 * current-controlled sources (F/H), parameter expressions (`.param`), external
 * includes (`.include`/`.lib`) and file-based `.ic`/`.nodeset` are reported
 * unsupported — this engine has no hierarchy or file resolution, and pretending
 * otherwise would simulate a different circuit.
 */

import { parseSpiceValue } from './devices'
import { parseSpiceModelLibrary, type SpiceModelCard } from './modelLibrary'
import { buildCircuitModel } from './circuitModel'
import type { CircuitNetlist, Component, SimulationParameters } from './spiceEngine'

export interface SpiceDeckImport {
  netlist: CircuitNetlist
  warnings: string[]
  errors: string[]
}

type Positional = { tokens: string[]; line: number }

interface LogicalStatement {
  text: string
  line: number
}

const ELEMENT_MINIMUM_TOKENS: Readonly<Record<string, number>> = {
  R: 4,
  C: 4,
  L: 4,
  V: 4,
  I: 4,
  D: 4,
  Q: 5,
  M: 6,
  J: 5,
  E: 5,
  G: 5,
  F: 5,
  H: 5,
  B: 5,
  S: 5,
  W: 5,
  T: 5,
  K: 4,
  X: 2,
}

const SUPPORTED_ELEMENT = /^[RCLVIDQMJEGBHSTKW]$/i

/** Strip a `;`/`$` comment that is not inside quotes; full-line `*` is handled earlier. */
function stripInlineComment(line: string): string {
  let quote: string | null = null
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === ';' || character === '$') return line.slice(0, index)
  }
  return line
}

/** Split on whitespace while keeping `FUNC(a b c)` together. */
function tokenize(statement: string): string[] {
  const tokens: string[] = []
  let current = ''
  let depth = 0
  let quote: string | null = null
  for (const character of statement) {
    if (quote) {
      current += character
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      current += character
      continue
    }
    if (character === '(') {
      depth += 1
      current += character
      continue
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1)
      current += character
      continue
    }
    if (/\s/.test(character) && depth === 0) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += character
  }
  if (current) tokens.push(current)
  return tokens
}

function looksLikeElement(statement: string): boolean {
  const tokens = tokenize(statement)
  if (tokens.length === 0) return false
  const prefix = tokens[0][0]?.toUpperCase() ?? ''
  if (!SUPPORTED_ELEMENT.test(prefix) && prefix !== 'F' && prefix !== 'H' && prefix !== 'X') return false
  return tokens.length >= (ELEMENT_MINIMUM_TOKENS[prefix] ?? Number.POSITIVE_INFINITY)
}

function readLogicalLines(source: string): { title: string; statements: LogicalStatement[] } {
  const physical = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  const statements: LogicalStatement[] = []
  let title = ''
  let firstContentSeen = false

  for (let index = 0; index < physical.length; index += 1) {
    const raw = physical[index].trim()
    if (raw === '') continue
    if (raw.startsWith('*')) {
      if (!firstContentSeen && title === '') {
        title = raw.replace(/^\*+\s*/, '').trim()
      }
      continue
    }
    const text = stripInlineComment(raw).trim()
    if (text === '') continue

    if (text.startsWith('+')) {
      if (statements.length === 0) {
        throw new Error(`Line ${index + 1}: continuation has no preceding card.`)
      }
      statements[statements.length - 1].text += ` ${text.slice(1).trim()}`
      continue
    }

    if (!firstContentSeen) {
      firstContentSeen = true
      /*
       * SPICE's first line is a title. Decks pasted from a simulator often
       * omit it, so a line that is unmistakably an element card is treated as
       * the first card instead of being silently discarded. A line whose
       * following line continues it is a card even when that first line is
       * short.
       */
      const continuation = physical
        .slice(index + 1)
        .find((candidate) => candidate.trim() !== '')
        ?.trim()
        .startsWith('+')
      const isCard = text.startsWith('.') || looksLikeElement(text) || continuation === true
      if (!isCard) {
        title = text
        continue
      }
    }

    statements.push({ text, line: index + 1 })
    if (/^\.end\b/i.test(text)) break
  }

  if (title === '') title = 'Imported SPICE deck'
  return { title, statements }
}

function splitKeyValue(token: string): { key: string; value: string } | null {
  const match = /^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(token)
  if (!match) return null
  return { key: match[1].toLowerCase(), value: match[2] }
}

function isNumericToken(token: string | undefined): boolean {
  if (token === undefined) return false
  try {
    parseSpiceValue(token, 'value')
    return true
  } catch {
    return false
  }
}

function number(token: string, label: string): number {
  return parseSpiceValue(token, label)
}

function sourceSpecs(
  tokens: string[],
  label: string,
  errors: string[],
  warnings: string[],
): Record<string, string | number | boolean> {
  const parameters: Record<string, string | number | boolean> = {}
  let sawValue = false
  let hasWaveform = false
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    const upper = token.toUpperCase()

    if (upper === 'DC') {
      const value = tokens[index + 1]
      if (value === undefined) {
        errors.push(`${label}: DC needs a value.`)
        return parameters
      }
      parameters.value = value
      sawValue = true
      index += 2
      continue
    }

    if (upper === 'AC') {
      const magnitude = tokens[index + 1]
      if (magnitude === undefined) {
        errors.push(`${label}: AC needs a magnitude.`)
        return parameters
      }
      parameters.acMagnitude = magnitude
      const phase = tokens[index + 2]
      if (phase !== undefined && isNumericToken(phase)) {
        parameters.acPhase = phase
        index += 3
      } else {
        index += 2
      }
      sawValue = true
      continue
    }

    const waveform = /^(SIN|PULSE|PWL|EXP|SFFM)\((.*)\)$/i.exec(token)
    if (waveform) {
      const name = waveform[1].toUpperCase()
      hasWaveform = true
      const args = waveform[2]
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
      parameters.type = name
      if (name === 'SIN') {
        if (args.length < 3) {
          errors.push(`${label}: SIN needs at least offset, amplitude and frequency.`)
          return parameters
        }
        parameters.vo = args[0]
        parameters.va = args[1]
        parameters.freq = args[2]
        if (args[3] !== undefined) parameters.td = args[3]
        if (args[4] !== undefined) parameters.theta = args[4]
        if (args[5] !== undefined) parameters.phase = args[5]
      } else if (name === 'PULSE') {
        if (args.length < 7) {
          errors.push(`${label}: PULSE needs V1 V2 TD TR TF PW PER (all seven values).`)
          return parameters
        }
        const keys = ['v1', 'v2', 'td', 'tr', 'tf', 'pw', 'per']
        keys.forEach((key, at) => {
          parameters[key] = args[at]
        })
      } else if (name === 'PWL') {
        if (args.length < 2 || args.length % 2 !== 0) {
          errors.push(`${label}: PWL needs time/value pairs.`)
          return parameters
        }
        const points: string[] = []
        for (let at = 0; at < args.length; at += 2) points.push(`${args[at]},${args[at + 1]}`)
        parameters.points = points.join(' ')
      } else if (name === 'EXP') {
        if (args.length < 6) {
          errors.push(`${label}: EXP needs V1 V2 TD1 TAU1 TD2 TAU2 (all six values).`)
          return parameters
        }
        const keys = ['v1', 'v2', 'td1', 'tau1', 'td2', 'tau2']
        keys.forEach((key, at) => {
          parameters[key] = args[at]
        })
      } else {
        if (args.length < 5) {
          errors.push(`${label}: SFFM needs VO VA FC MDI FS (all five values).`)
          return parameters
        }
        const keys = ['vo', 'va', 'fc', 'mdi', 'fs']
        keys.forEach((key, at) => {
          parameters[key] = args[at]
        })
      }
      sawValue = true
      index += 1
      continue
    }

    const named = splitKeyValue(token)
    if (named) {
      parameters[named.key] = named.value
      sawValue = true
      index += 1
      continue
    }

    if (/^[A-Za-z]+\(/.test(token)) {
      errors.push(`${label}: unsupported source function "${token.split('(')[0].toUpperCase()}".`)
      return parameters
    }

    if (parameters.value === undefined) {
      parameters.value = token
      sawValue = true
    } else {
      warnings.push(`${label}: extra token "${token}" was ignored.`)
    }
    index += 1
  }

  if (!sawValue) {
    errors.push(`${label}: a source needs a DC value, an AC magnitude or a waveform.`)
  } else if (!hasWaveform && parameters.value === undefined) {
    /*
     * An AC-only source rests at 0 V (or 0 A) in SPICE. The DC level is left
     * alone for a waveform source, where the model starts at the waveform's
     * own initial value instead.
     */
    parameters.value = '0'
  }
  return parameters
}

function positionalTokens(tokens: string[], start: number): { positional: string[]; named: Record<string, string> } {
  const positional: string[] = []
  const named: Record<string, string> = {}
  for (let index = start; index < tokens.length; index += 1) {
    const entry = splitKeyValue(tokens[index])
    if (entry) named[entry.key] = entry.value
    else positional.push(tokens[index])
  }
  return { positional, named }
}

interface DeckBuilder {
  components: Component[]
  warnings: string[]
  errors: string[]
  usedNames: Set<string>
}

function addComponent(builder: DeckBuilder, component: Component, line: number): void {
  const key = component.name.toUpperCase()
  if (builder.usedNames.has(key)) {
    builder.errors.push(`Line ${line}: duplicate reference "${component.name}".`)
    return
  }
  builder.usedNames.add(key)
  builder.components.push(component)
}

function parseElement(builder: DeckBuilder, statement: Positional): void {
  const { tokens, line } = statement
  const name = tokens[0]
  const prefix = name[0].toUpperCase()
  const fail = (message: string): void => {
    builder.errors.push(`Line ${line}: ${message}`)
  }
  const parameters: Record<string, string | number | boolean> = {}
  const requireTokens = (minimum: number, usage: string): boolean => {
    if (tokens.length >= minimum) return true
    fail(`${name}: expected ${usage}.`)
    return false
  }

  switch (prefix) {
    case 'R':
    case 'C':
    case 'L': {
      if (!requireTokens(4, `a ${prefix} card "name node1 node2 value"`)) return
      const { positional, named } = positionalTokens(tokens, 3)
      const value = positional[0] ?? named.value ?? named[prefix.toLowerCase()]
      if (value === undefined) {
        fail(`${name}: no value.`)
        return
      }
      if (positional.length > 1) {
        fail(`${name}: unexpected token "${positional[1]}" after the value.`)
        return
      }
      Object.assign(parameters, named, { value })
      addComponent(
        builder,
        {
          type: prefix === 'R' ? 'resistor' : prefix === 'C' ? 'capacitor' : 'inductor',
          name,
          nodes: [tokens[1], tokens[2]],
          parameters,
        },
        line,
      )
      return
    }

    case 'V':
    case 'I': {
      if (!requireTokens(4, `a ${prefix} card "name node1 node2 value"`)) return
      const specs = sourceSpecs(tokens.slice(3), name, builder.errors, builder.warnings)
      addComponent(
        builder,
        {
          type: prefix === 'V' ? 'voltage_source' : 'current_source',
          name,
          nodes: [tokens[1], tokens[2]],
          parameters: specs,
        },
        line,
      )
      return
    }

    case 'D': {
      if (!requireTokens(4, 'a D card "name anode cathode model"')) return
      const { positional, named } = positionalTokens(tokens, 3)
      const model = positional[0]
      if (model === undefined) {
        fail(`${name}: no model name.`)
        return
      }
      if (positional.length > 1) {
        builder.warnings.push(
          `Line ${line}: ${name}: diode area factor "${positional[1]}" is not modelled and was ignored.`,
        )
      }
      Object.assign(parameters, named, { model })
      addComponent(builder, { type: 'diode', name, nodes: [tokens[1], tokens[2]], parameters }, line)
      return
    }

    case 'Q': {
      if (!requireTokens(5, 'a Q card "name collector base emitter model"')) return
      const { positional, named } = positionalTokens(tokens, 1)
      if (positional.length >= 5 && isNumericToken(positional[positional.length - 1])) {
        builder.warnings.push(
          `Line ${line}: ${name}: BJT area factor "${positional[positional.length - 1]}" is not modelled and was ignored.`,
        )
        positional.pop()
      }
      if (positional.length < 4) {
        fail(`${name}: a BJT needs collector, base, emitter and a model.`)
        return
      }
      const model = positional[positional.length - 1]
      const nodes = positional.slice(0, -1)
      if (nodes.length > 3) {
        fail(`${name}: substrate terminals are not modelled; collapse to collector/base/emitter.`)
        return
      }
      Object.assign(parameters, named, { model })
      addComponent(builder, { type: 'bjt', name, nodes, parameters }, line)
      return
    }

    case 'M': {
      if (!requireTokens(6, 'an M card "name drain gate source bulk model"')) return
      const model = tokens[5]
      if (!model) {
        fail(`${name}: no model name.`)
        return
      }
      const { named } = positionalTokens(tokens, 6)
      Object.assign(parameters, named, { model })
      addComponent(
        builder,
        { type: 'mosfet', name, nodes: [tokens[1], tokens[2], tokens[3], tokens[4]], parameters },
        line,
      )
      return
    }

    case 'J': {
      if (!requireTokens(5, 'a J card "name drain gate source model"')) return
      const { named } = positionalTokens(tokens, 5)
      Object.assign(parameters, named, { model: tokens[4] })
      addComponent(
        builder,
        { type: 'jfet', name, nodes: [tokens[1], tokens[2], tokens[3]], parameters },
        line,
      )
      return
    }

    case 'E':
    case 'G': {
      if (!requireTokens(5, 'a controlled source "name out+ out- in+ in- gain"')) return
      const { positional, named } = positionalTokens(tokens, 5)
      const gain = positional[0] ?? named.gain
      if (gain === undefined) {
        fail(`${name}: no gain.`)
        return
      }
      Object.assign(parameters, named, { gain })
      addComponent(
        builder,
        {
          type: prefix === 'E' ? 'voltage_controlled_voltage_source' : 'voltage_controlled_current_source',
          name,
          nodes: [tokens[1], tokens[2], tokens[3], tokens[4]],
          parameters,
        },
        line,
      )
      return
    }

    case 'B': {
      if (!requireTokens(5, 'a B card "name out+ out- V=expression"')) return
      const { positional, named } = positionalTokens(tokens, 5)
      if (positional.length > 0) {
        fail(`${name}: the behavioural expression must be written as V=… or I=….`)
        return
      }
      if (named.v === undefined && named.i === undefined) {
        fail(`${name}: a B source needs V=… or I=….`)
        return
      }
      Object.assign(parameters, named)
      addComponent(builder, { type: 'behavioral_source', name, nodes: [tokens[1], tokens[2]], parameters }, line)
      return
    }

    case 'S': {
      if (!requireTokens(5, 'an S card "name out+ out- ctrl+ ctrl- VT=… VH=… RON=… ROFF=…"')) return
      const { positional, named } = positionalTokens(tokens, 5)
      if (positional.length > 0) {
        fail(`${name}: switch model cards are not modelled; give VT, VH, RON and ROFF explicitly.`)
        return
      }
      Object.assign(parameters, named)
      addComponent(
        builder,
        { type: 'voltage_switch', name, nodes: [tokens[1], tokens[2], tokens[3], tokens[4]], parameters },
        line,
      )
      return
    }

    case 'W': {
      if (!requireTokens(5, 'a W card "name out+ out- controlling-source IT=… IH=… RON=… ROFF=…"')) return
      const { positional, named } = positionalTokens(tokens, 5)
      if (positional.length !== 1) {
        fail(`${name}: a current-controlled switch needs exactly one controlling source name.`)
        return
      }
      Object.assign(parameters, named, { control: positional[0] })
      addComponent(builder, { type: 'current_switch', name, nodes: [tokens[1], tokens[2]], parameters }, line)
      return
    }

    case 'T': {
      if (!requireTokens(5, 'a T card "name p1 n1 p2 n2 Z0=… TD=…"')) return
      const { positional, named } = positionalTokens(tokens, 5)
      if (positional.length > 0) {
        fail(`${name}: give the line as Z0=… TD=… (lossy T models are not supported).`)
        return
      }
      if (named.f !== undefined || named.nl !== undefined) {
        fail(`${name}: frequency-dependent loss is not modelled; give Z0 and TD.`)
        return
      }
      if (named.z0 === undefined || named.td === undefined) {
        fail(`${name}: a transmission line needs Z0 and TD.`)
        return
      }
      Object.assign(parameters, named)
      addComponent(
        builder,
        { type: 'transmission_line', name, nodes: [tokens[1], tokens[2], tokens[3], tokens[4]], parameters },
        line,
      )
      return
    }

    case 'K': {
      if (!requireTokens(4, 'a K card "name inductor1 inductor2 coupling"')) return
      const k = tokens[3]
      addComponent(
        builder,
        { type: 'mutual', name, nodes: [], parameters: { l1: tokens[1], l2: tokens[2], k } },
        line,
      )
      return
    }

    case 'X':
      fail(`${name}: subcircuits are not supported (this engine has no hierarchy). Expand the X instance or use a .model card.`)
      return

    case 'F':
    case 'H':
      fail(`${name}: current-controlled sources (F/H) are not supported.`)
      return

    default:
      fail(`${name}: unsupported element card "${prefix}".`)
  }
}

function parseAnalysis(
  statement: LogicalStatement,
  analyses: SimulationParameters[],
  errors: string[],
  warnings: string[],
): void {
  const tokens = tokenize(statement.text)
  const directive = tokens[0].toLowerCase()
  const line = statement.line
  const fail = (message: string): void => {
    errors.push(`Line ${line}: ${message}`)
  }
  const numeric = (token: string | undefined, label: string): number | undefined => {
    if (token === undefined) return undefined
    try {
      return number(token, label)
    } catch {
      fail(`${directive}: ${label} "${token}" is not a number.`)
      return undefined
    }
  }

  switch (directive) {
    case '.op':
      analyses.push({ type: 'dc' })
      return

    case '.dc': {
      if (tokens.length < 5) {
        fail('.dc needs "source start stop step" (or "TEMP start stop step").')
        return
      }
      const source = tokens[1]
      if (source.includes('[') || source.includes('@')) {
        fail('.dc nested parameter sweeps are not supported.')
        return
      }
      const start = numeric(tokens[2], 'start')
      const stop = numeric(tokens[3], 'stop')
      const step = numeric(tokens[4], 'step')
      if (start === undefined || stop === undefined || step === undefined) return
      analyses.push({ type: 'dc-sweep', sweepSource: source, sweepStart: start, sweepStop: stop, sweepStep: step })
      return
    }

    case '.tran': {
      if (tokens.length < 3) {
        fail('.tran needs "step stop".')
        return
      }
      const step = numeric(tokens[1], 'step')
      const stop = numeric(tokens[2], 'stop')
      if (step === undefined || stop === undefined) return
      const rest = tokens.slice(3).map((token) => token.toUpperCase())
      const useInitialConditions = rest.includes('UIC')
      const numericRest = rest.filter((token) => isNumericToken(token))
      if (numericRest.length > 0) {
        warnings.push(
          `Line ${line}: .tran start/max timestep values are not used; the transient starts at 0 and adapts its step.`,
        )
      }
      analyses.push({
        type: 'transient',
        stepTime: step,
        stopTime: stop,
        ...(useInitialConditions ? { useInitialConditions: true } : {}),
      })
      return
    }

    case '.ac': {
      if (tokens.length < 5) {
        fail('.ac needs "dec points start stop".')
        return
      }
      if (tokens[1].toLowerCase() !== 'dec') {
        fail(`.ac ${tokens[1]}: only a decade sweep is supported; use "dec".`)
        return
      }
      const points = numeric(tokens[2], 'points per decade')
      const start = numeric(tokens[3], 'start frequency')
      const stop = numeric(tokens[4], 'stop frequency')
      if (points === undefined || start === undefined || stop === undefined) return
      analyses.push({
        type: 'ac',
        pointsPerDecade: Math.max(1, Math.round(points)),
        startFreq: start,
        stopFreq: stop,
      })
      return
    }

    case '.noise': {
      if (tokens.length < 7) {
        fail('.noise needs "v(node) source dec points start stop".')
        return
      }
      const output = /^v\(([^,)]+)\)$/i.exec(tokens[1])
      if (!output) {
        fail(`.noise output "${tokens[1]}" must be a single node: v(node).`)
        return
      }
      if (tokens[3].toLowerCase() !== 'dec') {
        fail(`.noise ${tokens[3]}: only a decade sweep is supported; use "dec".`)
        return
      }
      const points = numeric(tokens[4], 'points per decade')
      const start = numeric(tokens[5], 'start frequency')
      const stop = numeric(tokens[6], 'stop frequency')
      if (points === undefined || start === undefined || stop === undefined) return
      analyses.push({
        type: 'noise',
        outputNode: output[1].trim(),
        pointsPerDecade: Math.max(1, Math.round(points)),
        startFreq: start,
        stopFreq: stop,
      })
      return
    }

    case '.model':
      // Collected before this function runs; nothing to do here.
      return

    case '.end':
      return

    case '.include':
    case '.lib':
      fail(`${directive} cannot be resolved: this browser import has no external file access.`)
      return

    case '.subckt':
    case '.ends':
      fail(`${directive}: subcircuits are not supported (this engine has no hierarchy).`)
      return

    case '.param':
    case '.func':
      fail(`${directive}: parameter expressions are not evaluated; substitute the value.`)
      return

    case '.ic':
    case '.nodeset':
      warnings.push(
        `Line ${line}: ${directive} is not imported; the operating point starts from the solver's own initial guess.`,
      )
      return

    case '.step':
      fail('.step sweeps are not supported; export one deck per corner.')
      return

    case '.plot':
    case '.print':
    case '.save':
    case '.probe':
    case '.backanno':
      // Output selection only; the importer keeps every solved waveform.
      return

    default:
      fail(`unsupported directive "${tokens[0]}".`)
  }
}

function applyOptions(
  options: Record<string, string | number | boolean>,
  statement: LogicalStatement,
  warnings: string[],
): void {
  const tokens = tokenize(statement.text).slice(1)
  for (const token of tokens) {
    const entry = splitKeyValue(token)
    if (!entry) {
      warnings.push(`Line ${statement.line}: .options entry "${token}" has no value and was ignored.`)
      continue
    }
    options[entry.key] = entry.value
  }
}

function analyseOptions(
  options: Record<string, string | number | boolean>,
  analyses: SimulationParameters[],
  errors: string[],
  warnings: string[],
): void {
  const method = options.method?.toString().toLowerCase()
  if (method !== undefined) {
    const transient = analyses.filter((analysis) => analysis.type === 'transient')
    if (transient.length === 0) {
      warnings.push('.options method has no .tran card to apply to.')
    } else if (method === 'trap' || method === 'trapezoidal') {
      transient.forEach((analysis) => {
        analysis.integrationMethod = 'trapezoidal'
      })
    } else if (method === 'gear') {
      const order = Number(options.maxord ?? '2')
      if (order !== 2) {
        errors.push(
          `Gear order ${Number.isNaN(order) ? '(invalid)' : order} is not supported; use maxord=2 (BDF2).`,
        )
      } else {
        transient.forEach((analysis) => {
          analysis.integrationMethod = 'bdf2'
        })
      }
    } else if (method === 'euler' || method === 'backward-euler') {
      transient.forEach((analysis) => {
        analysis.integrationMethod = 'backward-euler'
      })
    } else {
      errors.push(`Integration method "${method}" is not supported.`)
    }
  }
}

/**
 * Parse a SPICE deck into the app's netlist shape.
 *
 * The returned `errors` are blocking: a deck with an unsupported construct is
 * refused rather than simulated with that construct missing. Warnings describe
 * things that were accepted but do not affect this engine.
 */
export function parseSpiceDeck(source: string): SpiceDeckImport {
  const warnings: string[] = []
  const errors: string[] = []
  const components: Component[] = []
  const analyses: SimulationParameters[] = []
  const options: Record<string, string | number | boolean> = {}
  const modelStatements: string[] = []
  let title = 'Imported SPICE deck'
  let statements: LogicalStatement[] = []

  try {
    const logical = readLogicalLines(source)
    title = logical.title
    statements = logical.statements
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'The deck could not be read.')
  }

  /*
   * `.model` cards may appear anywhere. Collect them first so a device card can
   * reference one declared later in the deck, as SPICE allows.
   */
  for (const statement of statements) {
    if (/^\.model\b/i.test(statement.text)) modelStatements.push(statement.text)
  }

  const builder: DeckBuilder = {
    components,
    warnings,
    errors,
    usedNames: new Set<string>(),
  }

  let globalTemperature: number | undefined

  for (const statement of statements) {
    if (statement.text.startsWith('.')) {
      const tokens = tokenize(statement.text)
      const directive = tokens[0].toLowerCase()
      if (directive === '.options') {
        applyOptions(options, statement, warnings)
        continue
      }
      if (directive === '.title') {
        title = tokens.slice(1).join(' ').trim() || title
        continue
      }
      if (directive === '.temp') {
        try {
          globalTemperature = number(tokens[1], 'temperature')
        } catch (error) {
          errors.push(
            `Line ${statement.line}: ${error instanceof Error ? error.message : '.temp is invalid.'}`,
          )
        }
        continue
      }
      parseAnalysis(statement, analyses, errors, warnings)
      continue
    }
    parseElement(builder, { tokens: tokenize(statement.text), line: statement.line })
  }

  const models: Record<string, SpiceModelCard> = {}
  if (modelStatements.length > 0) {
    const library = parseSpiceModelLibrary(modelStatements.join('\n'))
    library.errors.forEach((message) => errors.push(`.model: ${message}`))
    library.unsupported.forEach((entry) => {
      errors.push(`.model: ${entry} is not supported in a deck import.`)
    })
    for (const [name, card] of library.models) models[name] = card
  }

  if (analyses.length === 0) {
    warnings.push('No analysis card was found; the deck is imported as a DC operating point.')
    analyses.push({ type: 'dc' })
  } else if (analyses.length > 1) {
    // The engine solves one analysis per run. Say so instead of silently
    // dropping the others.
    warnings.push(
      `The deck has ${analyses.length} analysis cards; this build solves the first (${analyses[0].type}) and does not run the rest.`,
    )
  }

  analyseOptions(options, analyses, errors, warnings)

  let effectiveTemperature = globalTemperature
  if (effectiveTemperature === undefined && options.temp !== undefined) {
    try {
      effectiveTemperature = number(options.temp.toString(), 'temperature')
    } catch {
      errors.push(`.options temp "${options.temp}" is not a number.`)
    }
  }
  if (effectiveTemperature !== undefined) {
    analyses.forEach((analysis) => {
      analysis.temperature = effectiveTemperature
    })
  }

  if (components.length === 0) errors.push('The deck contains no element cards.')

  const netlist: CircuitNetlist = {
    title,
    components,
    analyses,
    ...(Object.keys(options).length > 0 ? { options } : {}),
    ...(Object.keys(models).length > 0 ? { models } : {}),
  }

  if (components.length > 0 && errors.length === 0) {
    const built = buildCircuitModel(netlist)
    built.errors.forEach((message) => errors.push(`SPICE deck: ${message}`))
  }

  return { netlist, warnings, errors }
}
