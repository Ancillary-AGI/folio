/**
 * Why a code row can or cannot land in a given editor.
 *
 * Every source surface in the app holds one family of languages and parses it
 * with one engine, so a row from elsewhere is not merely untidy — it would be
 * poured into a buffer that cannot elaborate it and left there as a broken
 * design. The refusal therefore names the row, the language it is written in and
 * the surface that does take it, so the user can move it rather than delete it.
 *
 * Three surfaces ask the same question (the HDL editor, the FPGA source box and
 * the firmware sketch), so the sentence is written once here and the tests for
 * each panel assert the words the user actually reads.
 */
import type { LibraryItem } from './types'

type SnippetLanguage = Extract<LibraryItem, { kind: 'snippet' }>['payload']['language']

const LANGUAGE_WORDS: Record<SnippetLanguage, { label: string; family: 'hdl' | 'firmware' }> = {
  verilog: { label: 'VERILOG', family: 'hdl' },
  systemverilog: { label: 'SYSTEMVERILOG', family: 'hdl' },
  vhdl: { label: 'VHDL', family: 'hdl' },
  c: { label: 'C', family: 'firmware' },
  cpp: { label: 'C++', family: 'firmware' },
}

const FAMILY_WORDS = { hdl: 'HDL', firmware: 'firmware' } as const

const FAMILY_HOME = {
  hdl: 'the HDL editor',
  firmware: 'the embedded editor',
} as const

/**
 * A drop-zone predicate for a source surface.
 *
 * `held` is what the buffer parses today and `surface` is how the panel calls
 * itself in the refusal, so one helper serves an editor frozen on Verilog and a
 * sketch that takes both C and C++.
 */
export function snippetVerdict(
  held: readonly SnippetLanguage[],
  surface: string,
): (item: LibraryItem) => true | string {
  const heldFamily = LANGUAGE_WORDS[held[0]].family
  return (item) => {
    if (item.kind !== 'snippet') return `${item.name} is not a code snippet.`
    const source = item.payload.language
    const words = LANGUAGE_WORDS[source]
    if (words.family === heldFamily) {
      // No editor in the app elaborates SystemVerilog; the HDL engine implements
      // the Verilog subset, and saying so beats accepting a row it would reject.
      if (source === 'systemverilog') {
        return `${item.name} is SystemVerilog; this editor parses the Verilog subset, which does not include it.`
      }
      if (held.includes(source)) return true
      return `${item.name} is ${words.label} and this buffer is ${LANGUAGE_WORDS[held[0]].label} — switch the language first, then drop it.`
    }
    return `${item.name} is ${words.label} ${FAMILY_WORDS[words.family]} — ${FAMILY_HOME[words.family]} takes it, not ${surface}.`
  }
}
