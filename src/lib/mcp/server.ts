/**
 * Folio MCP — the CAD's engines exposed to any MCP-capable agent.
 *
 * Three honest, headless tools. No canvas, no browser, no project files: an
 * agent pointed at this endpoint can ask for parts from the real library,
 * parse and check a SPICE deck, and actually solve the circuit. That is the
 * whole point — the harness is for doing, not for gesturing.
 *
 * Transport: JSON-RPC 2.0 over HTTP POST at /api/mcp. Authenticated by a
 * single shared token in the `x-api-key` header, configured with
 * FOLIO_MCP_KEY. With no key configured, every request is refused.
 */
import { standardComponents } from '../componentLibrary'
import { parseSpiceDeck } from '../simulation/spiceImport'
import { buildCircuitModel } from '../simulation/circuitModel'
import { runCircuitAnalysis, DEFAULT_TEMPERATURE_CELSIUS } from '../simulation/analysisRunner'
import { summarizeWaveforms } from '../simulation/waveformStats'
import type { SimulationParameters, SimulationResult } from '../simulation/spiceEngine'

export const MCP_TOOL_SCHEMAS = {
  component_search: {
    name: 'component_search',
    description: 'Search Folio\'s built-in standard component library by keyword. Returns at most `limit` parts with category, name, default value and the parameters the library ships — nothing invented, nothing from memory.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword or designator fragment, e.g. "resistor", "2N3904", "0805".' },
        category: { type: 'string', description: 'Optional category filter: passive, discrete, integrated, rf, mechanical, embedded.' },
        limit: { type: 'number', description: 'Max results (1–50, default 10).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  netlist_verify: {
    name: 'netlist_verify',
    description: 'Parse a SPICE deck and report every construct the simulator supports or refuses: element types, .model/.subckt cards, parameter counts, dangling references, missing ground. Returns structural summary plus raw errors and warnings from the importer — verification that refuses decks it cannot really run.',
    inputSchema: {
      type: 'object',
      properties: {
        netlist: { type: 'string', description: 'Full SPICE deck as text (.title ... .end).' },
      },
      required: ['netlist'],
      additionalProperties: false,
    },
  },
  circuit_simulate: {
    name: 'circuit_simulate',
    description: 'Parse and run a SPICE deck through Folio\'s real solver (MNA + Newton-Raphson). Returns the analysis outcome with a statistical summary of every waveform: points, start, final, min, max, peak-to-peak, mean, rms. Choose analysis: transient (needs stopTime, stepTime), dc (operating point), dc-sweep, ac (frequency response), noise, montecarlo.',
    inputSchema: {
      type: 'object',
      properties: {
        netlist: { type: 'string', description: 'Full SPICE deck as text.' },
        analysis: { type: 'string', enum: ['transient', 'dc', 'dc-sweep', 'ac', 'noise', 'montecarlo'], description: 'Analysis to run.' },
        stopTime: { type: 'number', description: 'Transient stop time in seconds.' },
        stepTime: { type: 'number', description: 'Transient time-step in seconds.' },
        startFrequency: { type: 'number', description: 'AC/noise start in Hz.' },
        stopFrequency: { type: 'number', description: 'AC/noise stop in Hz.' },
        sweepSource: { type: 'string', description: 'DC sweep source reference (or TEMP).' },
        sweepStart: { type: 'number' },
        sweepStop: { type: 'number' },
        sweepStep: { type: 'number' },
        pointsPerDecade: { type: 'number', description: 'AC/noise points per decade.' },
        temperature: { type: 'number', description: 'Celsius, default 27.' },
      },
      required: ['netlist', 'analysis'],
      additionalProperties: false,
    },
  },
} as const

export type McpToolName = keyof typeof MCP_TOOL_SCHEMAS

/* Every analysis name the dispatcher implements. The declared schema enum and
 * the runtime check come from the same list, so a tool call can never name an
 * analysis the solver does not branch on. */
export const MCP_ANALYSES = ['transient', 'dc', 'dc-sweep', 'ac', 'noise', 'montecarlo'] as const
export type McpAnalysis = (typeof MCP_ANALYSES)[number]

const isMcpAnalysis = (value: string): value is McpAnalysis =>
  (MCP_ANALYSES as readonly string[]).includes(value)

/* Bounds on what one headless call may ask for. The solvers cap themselves
 * (Monte Carlo at 500 runs, AC grids at a fixed point count, DC sweeps at
 * 2 000), so these are the remaining doors: deck size, and the transient time
 * window, which is the one request that otherwise decides its own work. */
export const MCP_LIMITS = {
  maxDeckChars: 2_000_000,
  maxBodyChars: 4_000_000,
  /** 1 µs … 10 s, i.e. at most 10 million 1 µs steps. */
  minStepTime: 1e-6,
  maxStopTime: 10,
} as const

const str = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string.`)
  return value.trim()
}
const optNum = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** Read a SPICE deck from the arguments, refusing an absurdly large one. */
const readDeck = (args: Record<string, unknown>): string => {
  const deck = str(args.netlist, 'netlist')
  if (deck.length > MCP_LIMITS.maxDeckChars) {
    throw new Error(`netlist exceeds the ${MCP_LIMITS.maxDeckChars.toLocaleString('en-US')} character limit for one MCP call.`)
  }
  return deck
}

/** Validate the requested analysis and the transient window before solving. */
const readAnalysis = (args: Record<string, unknown>): McpAnalysis => {
  const analysis = str(args.analysis, 'analysis')
  if (!isMcpAnalysis(analysis)) {
    throw new Error(`analysis must be one of ${MCP_ANALYSES.join(', ')}; received "${analysis}".`)
  }
  if (analysis === 'transient') {
    const stopTime = optNum(args.stopTime)
    const stepTime = optNum(args.stepTime)
    if (stepTime !== undefined && stepTime < MCP_LIMITS.minStepTime) {
      throw new Error(`stepTime must be at least ${MCP_LIMITS.minStepTime} s (1 µs) for a headless MCP call.`)
    }
    if (stopTime !== undefined && stopTime > MCP_LIMITS.maxStopTime) {
      throw new Error(`stopTime must be at most ${MCP_LIMITS.maxStopTime} s for a headless MCP call.`)
    }
  }
  return analysis
}

/* ── component_search ───────────────────────────────────────────────────── */
function componentSearch(args: Record<string, unknown>): string {
  const query = str(args.query, 'query').toLowerCase()
  const category = typeof args.category === 'string' ? args.category.trim().toLowerCase() : undefined
  const limit = Math.max(1, Math.min(50, typeof args.limit === 'number' ? Math.floor(args.limit) : 10))
  const hits = standardComponents.filter((part) => {
    if (category && part.category !== category) return false
    const haystack = `${part.name} ${part.category} ${Object.values(part.default_properties ?? {}).join(' ')}`.toLowerCase()
    return haystack.includes(query)
  }).slice(0, limit)
  if (hits.length === 0) return JSON.stringify({ matches: [], note: 'No parts in the built-in library match; the vendor catalog is searchable through the CAD.' })
  return JSON.stringify({ matches: hits.map((part) => ({ name: part.name, category: part.category, default_properties: part.default_properties })) }, null, 2)
}

/* ── netlist_verify ─────────────────────────────────────────────────────── */
function netlistVerify(args: Record<string, unknown>): string {
  const deck = readDeck(args)
  const { errors, warnings, netlist } = parseSpiceDeck(deck)
  const components = netlist.components.length
  const nets = new Set<string>()
  for (const component of netlist.components) for (const node of Object.values(component.nodes ?? {})) if (node) nets.add(String(node))
  const summary = {
    components,
    nets: nets.size,
    devices: netlist.components.length,
    errors,
    warnings,
    verdict: errors.length === 0 ? 'parseable' : 'refused',
  }
  return JSON.stringify(summary, null, 2)
}

/* ── circuit_simulate ───────────────────────────────────────────────────── */
function circuitSimulate(args: Record<string, unknown>): string {
  const deck = readDeck(args)
  const analysis = readAnalysis(args)
  const { errors, warnings, netlist } = parseSpiceDeck(deck)
  if (errors.length > 0) return JSON.stringify({ verdict: 'refused', errors, warnings }, null, 2)
  const built = buildCircuitModel(netlist)
  if (built.errors.length > 0) return JSON.stringify({ verdict: 'refused', errors: built.errors, warnings }, null, 2)
  const parameters: SimulationParameters = {
    type: analysis,
    stopTime: optNum(args.stopTime),
    stepTime: optNum(args.stepTime),
    startFreq: optNum(args.startFrequency),
    stopFreq: optNum(args.stopFrequency),
    sweepSource: typeof args.sweepSource === 'string' ? args.sweepSource : undefined,
    sweepStart: optNum(args.sweepStart),
    sweepStop: optNum(args.sweepStop),
    sweepStep: optNum(args.sweepStep),
    pointsPerDecade: optNum(args.pointsPerDecade),
    temperature: args.temperature !== undefined ? Number(args.temperature) : DEFAULT_TEMPERATURE_CELSIUS,
  }
  const outcome = runCircuitAnalysis(built.model, parameters)
  const summaries = summarizeWaveforms(outcome as unknown as SimulationResult, { maxPoints: 24 })
  return JSON.stringify({ verdict: 'solved', analysis, warnings, waveforms: summaries }, null, 2)
}

const HANDLERS: Record<McpToolName, (args: Record<string, unknown>) => string> = {
  component_search: componentSearch,
  netlist_verify: netlistVerify,
  circuit_simulate: circuitSimulate,
}

export function listMcpTools() {
  return Object.values(MCP_TOOL_SCHEMAS)
}

/** Execute one tool call; throws when the tool is unknown or refused. */
export function callMcpTool(name: string, args: Record<string, unknown>): string {
  // An own-property check, not `HANDLERS[name]`: a plain object inherits from
  // Object.prototype, so `name: "constructor"` would otherwise resolve to the
  // Object constructor, "succeed", and answer with something that is not text.
  if (!Object.hasOwn(HANDLERS, name)) throw new Error(`Unknown tool: ${name}`)
  const handler = HANDLERS[name as McpToolName]
  const text = handler(args ?? {})
  if (typeof text !== 'string') {
    throw new Error(`Tool ${name} returned ${typeof text} instead of text; this is a server defect.`)
  }
  return text
}
