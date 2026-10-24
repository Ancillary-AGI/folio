/**
 * KiCad netlist interchange (s-expression `export` format).
 *
 * KiCad's documented interchange is the s-expression netlist (`eeschema`
 * export: `components` + `nets` with `node` ref/pin). This module reads
 * and writes that subset — no binary `.kicad_pcb`, no GUI layout — so a
 * Folio design round-trips through KiCad for layout, and a KiCad netlist
 * imports for simulation. Fail-loud: malformed s-expressions and
 * pin-less components are errors, never guesses.
 */
import type { CircuitNetlist } from '../simulation/spiceEngine'

export interface KicadNetlist {
  components: Array<{ ref: string; value: string; footprint: string }>
  nets: Array<{ code: string; name: string; nodes: Array<{ ref: string; pin: string }> }>
}

/** Tokenize an s-expression: parens, quoted strings, atoms. */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted: string | null = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted !== null) {
      if (char === '"') {
        tokens.push(`"${current}"`)
        current = ''
        quoted = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"') {
      quoted = ''
      current = ''
    } else if (char === '(' || char === ')') {
      if (current.trim()) tokens.push(current.trim())
      current = ''
      tokens.push(char)
    } else if (/\s/.test(char)) {
      if (current.trim()) tokens.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) tokens.push(current.trim())
  return tokens
}

type SExpr = string | SExpr[]

function parseTokens(tokens: string[]): SExpr {
  const token = tokens.shift()
  if (token === '(') {
    const list: SExpr[] = []
    while (tokens[0] !== ')') {
      if (tokens.length === 0) throw new Error('KiCad: unterminated list.')
      list.push(parseTokens(tokens))
    }
    tokens.shift()
    return list
  }
  if (token === undefined || token === ')') throw new Error('KiCad: unexpected end of input.')
  return token
}

const unquote = (value: string): string =>
  value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value

const field = (list: SExpr[], name: string): string | undefined => {
  for (const entry of list.slice(1)) {
    if (Array.isArray(entry) && entry[0] === name && typeof entry[1] === 'string') return unquote(entry[1])
  }
  return undefined
}

/** Parse a KiCad s-expression netlist into components + nets. */
export function parseKicadNetlist(text: string): KicadNetlist {
  const root = parseTokens(tokenize(text))
  if (!Array.isArray(root) || root[0] !== 'export') throw new Error('KiCad: root must be an (export …) list.')
  const components: KicadNetlist['components'] = []
  const nets: KicadNetlist['nets'] = []
  for (const section of root.slice(1)) {
    if (!Array.isArray(section)) continue
    if (section[0] === 'components') {
      for (const entry of section.slice(1)) {
        if (!Array.isArray(entry) || entry[0] !== 'comp') continue
        const ref = field(entry, 'ref')
        if (!ref) throw new Error('KiCad: comp without ref.')
        components.push({ ref, value: field(entry, 'value') ?? '', footprint: field(entry, 'footprint') ?? '' })
      }
    } else if (section[0] === 'nets') {
      for (const entry of section.slice(1)) {
        if (!Array.isArray(entry) || entry[0] !== 'net') continue
        const code = typeof entry[1] === 'string' ? entry[1] : ''
        const name = typeof entry[2] === 'string' ? unquote(entry[2]) : ''
        const nodes: Array<{ ref: string; pin: string }> = []
        for (const node of entry.slice(3)) {
          if (!Array.isArray(node) || node[0] !== 'node') continue
          const ref = field(node, 'ref')
          const pin = field(node, 'pin')
          if (!ref || !pin) throw new Error(`KiCad: net ${name} has a node without ref/pin.`)
          nodes.push({ ref, pin })
        }
        nets.push({ code, name, nodes })
      }
    }
  }
  return { components, nets }
}

/** Emit a KiCad s-expression netlist from a Folio circuit netlist. */
export function emitKicadNetlist(netlist: CircuitNetlist): string {
  const lines = ['(export (version D)']
  lines.push('  (components')
  for (const component of netlist.components) {
    const value = String(component.parameters.value ?? '')
    lines.push(`    (comp (ref ${component.name}) (value "${value}") (footprint ""))`)
  }
  lines.push('  )')
  // Group pins by node name into numbered nets. Unconnected terminals have no
  // net in KiCad (the pad exists, the net does not); ground aliases are
  // emitted under the conventional GND name rather than SPICE's node 0.
  const nets = new Map<string, Array<{ ref: string; pin: string }>>()
  for (const component of netlist.components) {
    component.nodes.forEach((node, pinIndex) => {
      if (!node.trim() || node.startsWith('NC_')) return
      const name = /^(?:0|gnd|ground)$/i.test(node.trim()) ? 'GND' : node
      const list = nets.get(name) ?? []
      list.push({ ref: component.name, pin: String(pinIndex + 1) })
      nets.set(name, list)
    })
  }
  lines.push('  (nets')
  let code = 1
  for (const [name, nodes] of nets) {
    lines.push(`    (net ${code} "${name}"`)
    for (const node of nodes) {
      lines.push(`      (node (ref ${node.ref}) (pin ${node.pin}))`)
    }
    lines.push('    )')
    code += 1
  }
  lines.push('  )', ')')
  return `${lines.join('\n')}\n`
}
