import { parseSpiceValue, pickParameter } from './devices'

export type SpiceModelType = 'NPN' | 'PNP' | 'NMOS' | 'PMOS' | 'NJF' | 'PJF' | 'D'

export interface SpiceModelCard {
  name: string
  type: SpiceModelType
  parameters: Readonly<Record<string, number>>
}

export interface SpiceModelLibrary {
  models: ReadonlyMap<string, SpiceModelCard>
  errors: string[]
  unsupported: string[]
}

const SUPPORTED_TYPES = new Set<SpiceModelType>(['NPN', 'PNP', 'NMOS', 'PMOS', 'NJF', 'PJF', 'D'])
const PARAMETER = /([A-Za-z][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s()]+)/g

function logicalStatements(source: string): string[] {
  const statements: string[] = []
  for (const physicalLine of source.split(/\r?\n/)) {
    const line = physicalLine.replace(/\$.*$/, '').trim()
    if (!line || line.startsWith('*')) continue
    if (line.startsWith('+')) {
      if (statements.length === 0) throw new Error('Model-library continuation has no preceding line')
      statements[statements.length - 1] += ` ${line.slice(1).trim()}`
    } else {
      statements.push(line)
    }
  }
  return statements
}

/** Parse the supported SPICE `.model` subset. Subcircuits are reported, never silently treated as models. */
export function parseSpiceModelLibrary(source: string): SpiceModelLibrary {
  const models = new Map<string, SpiceModelCard>()
  const errors: string[] = []
  const unsupported: string[] = []

  let statements: string[]
  try {
    statements = logicalStatements(source)
  } catch (error) {
    return { models, errors: [error instanceof Error ? error.message : 'Invalid model-library continuation'], unsupported }
  }

  for (const statement of statements) {
    if (/^\.subckt\b/i.test(statement) || /^\.include\b/i.test(statement) || /^\.lib\b/i.test(statement)) {
      unsupported.push(statement.split(/\s+/)[0].toUpperCase())
      continue
    }
    if (!/^\.model\b/i.test(statement)) continue

    const match = /^\.model\s+([^\s]+)\s+([^\s(]+)\s*\((.*)\)\s*$/i.exec(statement)
    if (!match) {
      errors.push(`Malformed SPICE model card: ${statement}`)
      continue
    }

    const [, name, rawType, body] = match
    const type = rawType.toUpperCase() as SpiceModelType
    if (!SUPPORTED_TYPES.has(type)) {
      unsupported.push(`${name}: ${rawType}`)
      continue
    }

    const parameters: Record<string, number> = {}
    let parameterMatch: RegExpExecArray | null
    PARAMETER.lastIndex = 0
    let invalid = false
    while ((parameterMatch = PARAMETER.exec(body)) !== null) {
      const key = parameterMatch[1].toLowerCase()
      if (parameters[key] !== undefined) {
        errors.push(`${name}: duplicate model parameter ${parameterMatch[1]}`)
        invalid = true
        break
      }
      try {
        parameters[key] = parseSpiceValue(parameterMatch[2], `${name} model parameter ${parameterMatch[1]}`)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : `${name}: invalid parameter ${parameterMatch[1]}`)
        invalid = true
        break
      }
    }

    const remainder = body.replace(PARAMETER, '').replace(/[\s,]/g, '')
    if (remainder) {
      errors.push(`${name}: cannot parse model parameter text "${remainder}"`)
      continue
    }
    if (invalid) continue
    if (Object.keys(parameters).length === 0) {
      errors.push(`${name}: model card has no parameters`)
      continue
    }

    const normalizedName = name.toUpperCase()
    if (models.has(normalizedName)) {
      errors.push(`Duplicate SPICE model name: ${name}`)
      continue
    }
    models.set(normalizedName, { name, type, parameters })
  }

  return { models, errors, unsupported: [...new Set(unsupported)] }
}

/** Device family a card's declared type belongs to. */
export type ModelDeviceKind = 'bjt' | 'mosfet' | 'jfet' | 'diode'

export function modelCardDeviceKind(type: SpiceModelType): ModelDeviceKind {
  switch (type) {
    case 'NPN':
    case 'PNP':
      return 'bjt'
    case 'NMOS':
    case 'PMOS':
      return 'mosfet'
    case 'NJF':
    case 'PJF':
      return 'jfet'
    case 'D':
      return 'diode'
  }
}

/** Polarity a card declares; `undefined` for a diode, which has none. */
export function modelCardPolarity(card: SpiceModelCard): 'npn' | 'pnp' | 'n' | 'p' | undefined {
  switch (card.type) {
    case 'NPN':
      return 'npn'
    case 'PNP':
      return 'pnp'
    case 'NMOS':
    case 'NJF':
      return 'n'
    case 'PMOS':
    case 'PJF':
      return 'p'
    case 'D':
      return undefined
  }
}

/** `2N3904A` → `2N3904`: the gain-bin suffix stock cards also ignore. */
const stripPartSuffix = (name: string): string => name.replace(/([0-9])[A-Z]$/, '$1')

/**
 * Index a model-card record by upper-case name so a lookup is
 * case-insensitive (`2n3904` in a deck, `2N3904` on the symbol).
 */
export function normalizeModelCards(
  cards: Readonly<Record<string, SpiceModelCard>> | undefined,
): Map<string, SpiceModelCard> {
  const normalized = new Map<string, SpiceModelCard>()
  if (!cards) return normalized
  for (const [key, card] of Object.entries(cards)) {
    if (!card || typeof card.name !== 'string' || typeof card.type !== 'string') continue
    normalized.set(key.trim().toUpperCase(), card)
    normalized.set(card.name.trim().toUpperCase(), card)
  }
  return normalized
}

/**
 * Find the card a component references.
 *
 * SPICE names the model on the element line; in a drawn schematic that name
 * lives in the symbol's `model`/`part`/`mpn`/`type` property (a transistor's
 * `type` property is its part number). A deck that names the card after the
 * designator (`Q1`) is honoured by the final `component.name` candidate.
 * `modelCard`/`modelName` are explicit escape hatches when a symbol needs both
 * a part number and a custom card.
 */
export function resolveModelCard(
  component: { name: string; parameters: Readonly<Record<string, string | number | boolean>> },
  cards: ReadonlyMap<string, SpiceModelCard>,
): SpiceModelCard | undefined {
  if (cards.size === 0) return undefined
  const candidates: string[] = []
  const add = (value: string | number | boolean | undefined): void => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed) candidates.push(trimmed.toUpperCase())
  }
  add(pickParameter(component.parameters, 'modelCard', 'modelName'))
  add(pickParameter(component.parameters, 'model', 'part', 'mpn', 'type'))
  add(component.name)
  for (const candidate of candidates) {
    const exact = cards.get(candidate)
    if (exact) return exact
    const stripped = cards.get(stripPartSuffix(candidate))
    if (stripped) return stripped
  }
  return undefined
}
