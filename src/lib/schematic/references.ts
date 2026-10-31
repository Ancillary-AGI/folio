import type { CanvasComponent } from '../../stores/useProjectStore'

/**
 * Reference designators — the R1, C4, U2 that name a part on every document.
 *
 * One table for the whole design: the sheet, the board, the agent and the sketch
 * importer all name parts here, so a resistor dropped on the board and one placed
 * by the assistant cannot both claim R7.
 */
const REFERENCE_PREFIXES: Array<[RegExp, string]> = [
  [/^resistor$/i, 'R'],
  [/^capacitor$/i, 'C'],
  [/^inductor$/i, 'L'],
  [/^diode$/i, 'D'],
  [/^led$/i, 'D'],
  [/transistor|mosfet|jfet|finfet|hemt/i, 'Q'],
  [/voltage source|sine|pulse|exp |sffm|pwl|behavioral/i, 'V'],
  [/current source/i, 'I'],
  [/^ground$/i, 'G'],
  [/switch/i, 'SW'],
  [/transformer/i, 'T'],
  [/transmission line/i, 'TL'],
  [/test point/i, 'TP'],
  [/connector|header/i, 'J'],
  [/crystal/i, 'Y'],
  [/relay/i, 'K'],
  [/battery/i, 'BT'],
  [/motor|machine/i, 'M'],
]

export function referencePrefixFor(symbolName: string): string {
  for (const [pattern, prefix] of REFERENCE_PREFIXES) {
    if (pattern.test(symbolName)) return prefix
  }
  return 'X'
}

/**
 * The next free number for `prefix`. Counting parts instead of reading their
 * numbers is what let a deleted R2 hand the next resistor the name R3 while R3
 * was on the sheet — two parts, one designator, and a netlist that cannot say
 * which is which.
 */
export function nextReference(components: readonly CanvasComponent[], prefix: string): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(`^${escaped}(\\d+)$`, 'i')
  let highest = 0
  for (const component of components) {
    const match = matcher.exec(component.reference)
    if (match) highest = Math.max(highest, Number(match[1]))
  }
  return `${prefix}${highest + 1}`
}
