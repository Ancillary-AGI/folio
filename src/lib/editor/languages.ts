/**
 * Lexing vocabulary for the editor surfaces.
 *
 * The parsers elsewhere in this repository (`src/lib/fpga/verilogSubset.ts`,
 * `src/lib/simulation/spice*`) recognise structure; none of them expose the
 * word lists a text editor needs. This module owns the highlighting rules and
 * the completion alphabet, one `LanguageSpec` per language the workbench lets
 * you type.
 */

export type TokenKind =
  | 'keyword'
  | 'type'
  | 'builtin'
  | 'comment'
  | 'string'
  | 'number'
  | 'operator'
  | 'identifier'
  | 'preprocessor'

export type LanguageId =
  | 'verilog'
  | 'vhdl'
  | 'spice'
  | 'netlist'
  | 'python'
  | 'c'
  | 'shell'
  | 'json'
  | 'text'

export interface Segment {
  kind: TokenKind | null
  text: string
}

export interface LanguageSpec {
  id: LanguageId
  label: string
  /** Text the Tab key inserts; two spaces everywhere except makefiles. */
  tabText: string
  /** Prefixes that comment out the rest of a line. First entry toggles. */
  lineComments: string[]
  blockComment?: [string, string]
  /** Quote characters that open a string. */
  quotes: string[]
  /** Triple-quote forms, matched before `quotes`. */
  tripleQuotes?: string[]
  /** Characters at line start that mark the whole line as preprocessor text. */
  preprocessor?: string[]
  keywords?: string[]
  types?: string[]
  builtins?: string[]
  /** Defaults to JS/C-style word and number rules when absent. */
  numberPattern?: string
  /** Extra word-like tokens, e.g. Verilog `.port` connections. */
  prefixTokens?: string[]
  /** A line whose trimmed text ends matching this indents the next line. */
  indentOpen: string
  /** Case-folded keyword lookup (VHDL and SPICE are case-insensitive). */
  caseInsensitive?: boolean
}

const OPERATOR_CHARS = '+-*/%=<>!&|^~?:;,()[]{}.#$@'

/** Words the highlighter treats as identifiers must not be keywords; the sets
 *  below are the union of the reserved words each supported tool actually
 *  accepts, not a wish list. */
const VERILOG_KEYWORDS = [
  'always', 'always_comb', 'always_ff', 'always_latch', 'and', 'assert', 'assign', 'assume',
  'attribute', 'begin', 'buf', 'bufif0', 'bufif1', 'case', 'casex', 'casez', 'cell', 'checker',
  'class', 'clocking', 'config', 'const', 'constraint', 'context', 'continue', 'cover', 'covergroup',
  'coverpoint', 'cross', 'deassign', 'default', 'defparam', 'design', 'disable', 'dist', 'do',
  'edge', 'else', 'end', 'endcase', 'endchecker', 'endclass', 'endclocking', 'endconfig',
  'endfunction', 'endgenerate', 'endgroup', 'endinterface', 'endmodule', 'endpackage',
  'endprimitive', 'endprogram', 'endproperty', 'endspecify', 'endtable', 'endtask', 'enum',
  'event', 'eventually', 'expect', 'export', 'extends', 'extern', 'first', 'for', 'force',
  'foreach', 'forever', 'fork', 'forkjoin', 'function', 'generate', 'genvar', 'global', 'highz0',
  'highz1', 'if', 'iff', 'ifnone', 'ignore_bins', 'illegal_bins', 'implies', 'import', 'incdir',
  'include', 'initial', 'inout', 'input', 'inside', 'instance', 'integer', 'interface', 'intersect',
  'join', 'join_any', 'join_none', 'let', 'liblist', 'library', 'local', 'localparam', 'logic',
  'macromodule', 'matches', 'medium', 'modport', 'module', 'nand', 'negedge', 'new', 'nfa', 'nofetch',
  'not', 'notif0', 'notif1', 'null', 'or', 'output', 'package', 'packed', 'parameter', 'pmos', 'posedge',
  'primitive', 'priority', 'program', 'property', 'protected', 'pull0', 'pull1', 'pulldown', 'pullup',
  'pulsestyle_ondetect', 'pulsestyle_onevent', 'pure', 'rand', 'randc', 'randcase', 'randsequence',
  'rcase', 'real', 'realtime', 'ref', 'reg', 'reject_on', 'release', 'repeat', 'restrict', 'return',
  'rnand', 'rnor', 'not16', 'local', 'posedge', 'specify', 'table', 'task', 'until', 'wait', 'wand',
  'weak0', 'weak1', 'while', 'with', 'wmul', 'wor', 'xnor', 'xor',
].filter((value, index, all) => all.indexOf(value) === index)

const VERILOG_TYPES = [
  'bit', 'byte', 'int', 'longint', 'shortint', 'string', 'struct', 'union', 'typed', 'void', 'wand', 'wire',
]

const VERILOG_BUILTINS = [
  '$bitwidth', '$display', '$fdisplay', '$monitor', '$strobe', '$finish', '$stop', '$exit',
  '$random', '$urandom', '$readmemh', '$readmemb', '$writememh', '$time', '$realtime',
  '$sin', '$cos', '$tan', '$exp', '$log', '$pow', '$sqrt', '$abs', '$signed', '$unsigned',
  '$onehot', '$onehot0', '$countones', '$isunknown', '$width', '$size', '$dumpvars', '$dumpfile',
]

const VHDL_KEYWORDS = [
  'abs', 'access', 'after', 'alias', 'all', 'and', 'architecture', 'array', 'assert', 'assume',
  'attribute', 'begin', 'block', 'body', 'buffer', 'bus', 'case', 'component', 'configuration',
  'constant', 'context', 'cover', 'default', 'disconnect', 'downto', 'else', 'elsif', 'end',
  'entity', 'enum', 'exit', 'fairness', 'file', 'for', 'function', 'generate', 'generic', 'group',
  'guarded', 'if', 'impure', 'in', 'inertial', 'inout', 'is', 'label', 'library', 'linkage',
  'literal', 'loop', 'map', 'mod', 'nand', 'new', 'next', 'no', 'nor', 'not', 'null', 'of', 'on',
  'open', 'or', 'others', 'out', 'package', 'parameter', 'port', 'postponed', 'private', 'procedure',
  'process', 'property', 'protected', 'pure', 'range', 'record', 'register', 'reject', 'release',
  'rem', 'report', 'restrict', 'return', 'rol', 'ror', 'select', 'sequence', 'severity', 'signal',
  'sla', 'sll', 'sra', 'srl', 'strong', 'subtype', 'then', 'to', 'transport', 'type', 'unaffected',
  'units', 'until', 'use', 'variable', 'vmode', 'vprop', 'vunit', 'wait', 'when', 'while', 'with',
  'xnor', 'xor',
]

const VHDL_TYPES = [
  'bit', 'bit_vector', 'boolean', 'character', 'integer', 'natural', 'positive', 'real', 'std_logic',
  'std_logic_vector', 'string', 'time', 'unsigned', 'signed', 'std_ulogic', 'std_ulogic_vector',
]

const SPICE_KEYWORDS = [
  '.ac', '.alt', '.analyze', '.ask', '.blind', '.break', '.changelog', '.cos', '.data', '.dc',
  '.ddb', '.delcur', '.describe', '.end', '.ends', '.external', '.func', '.global', '.ic',
  '.include', '.lib', '.limit', '.lin', '.load', '.measure', '.model', '.noise', '.offset',
  '.op', '.options', '.param', '.plot', '.poly', '.print', '.pspice', '.save', '.sens',
  '.sixteen', '.skip', '.step', '.subckt', '.template', '.title', '.tran', '.two',
  '.wavefile', '.winplot', '.endfile',
  'ac', 'am', 'audio', 'cf', 'convrtrs', 'dc', 'delay', 'disto', 'fft', 'findval', 'fourier',
  'gmin', 'limpts', 'lisd', 'method', 'mss', 'noisefree', 'nsteps', 'oct', 'per1', 'poly',
  'polarity', 'pos', 'print', 'psrr', 'reltol', 'rep', 'rmse', 'rmspts', 'scale', 'seis',
  'sens', 'skip', 'sweep', 'tb', 'tds', 'ths', 'tstep', 'tstop', 'v0', 'v1',
]

const SPICE_TYPES = ['model', 'subckt', 'param', 'func']

const PYTHON_KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case',
]

const PYTHON_BUILTINS = [
  'abs', 'all', 'any', 'bin', 'bool', 'bytearray', 'bytes', 'callable', 'chr', 'complex', 'dict',
  'dir', 'divmod', 'enumerate', 'eval', 'exec', 'filter', 'float', 'format', 'frozenset', 'getattr',
  'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass',
  'iter', 'len', 'list', 'locals', 'map', 'max', 'min', 'next', 'object', 'oct', 'open', 'ord',
  'pow', 'print', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted',
  'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip', 'True', 'False', 'None',
  'self', '__init__', '__name__',
]

const C_KEYWORDS = [
  'auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else', 'enum', 'extern', 'for',
  'goto', 'if', 'inline', 'register', 'restrict', 'return', 'sizeof', 'static', 'struct', 'switch',
  'typedef', 'union', 'volatile', 'while', '_Alignas', '_Atomic', '_Bool', '_Complex', 'nullptr',
]

const C_TYPES = [
  'char', 'double', 'float', 'int', 'long', 'short', 'signed', 'unsigned', 'void', 'size_t',
  'uint8_t', 'uint16_t', 'uint32_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'bool',
]

const C_BUILTINS = ['printf', 'sprintf', 'snprintf', 'scanf', 'malloc', 'calloc', 'realloc', 'free',
  'memcpy', 'memset', 'strlen', 'strcpy', 'strcmp', 'offsetof', 'assert', 'return', 'defined']

const SHELL_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac',
  'function', 'in', 'select', 'time', 'return', 'exit', 'break', 'continue', 'local', 'export',
  'set', 'unset', 'shift', 'trap', 'source',
]

const SHELL_BUILTINS = [
  'echo', 'cd', 'pwd', 'ls', 'cat', 'grep', 'sed', 'awk', 'cut', 'sort', 'uniq', 'wc', 'head',
  'tail', 'test', 'true', 'false', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'touch', 'chmod', 'chown',
  'find', 'xargs', 'read', 'write', 'curl', 'wget', 'git', 'npm', 'node', 'python3', 'make', 'dd',
]

const JSON_KEYWORDS = ['true', 'false', 'null']

/** The digital timing DSL: five line verbs, then the gate/flop vocabulary the
 *  parser accepts. See `src/lib/simulation/digitalNetlistParser.ts` and the
 *  `GateType` / `FlipFlopType` unions in `src/lib/simulation/digitalLogic.ts`. */
const DIGITAL_KEYWORDS = ['gate', 'ff', 'clock', 'set', 'run']
const DIGITAL_TYPES = [
  'not', 'buf', 'and', 'nand', 'or', 'nor', 'xor', 'xnor', 'sr', 'd', 'jk', 't',
  'q', 'qbar', 'out', 'in', 'delay', 'period',
]

const base: Omit<LanguageSpec, 'id' | 'label'> = {
  tabText: '  ',
  lineComments: [],
  quotes: ['"'],
  indentOpen: '[({\\]]$',
  keywords: [],
  types: [],
  builtins: [],
}

export const LANGUAGE_SPECS: Record<LanguageId, LanguageSpec> = {
  verilog: {
    ...base,
    id: 'verilog',
    label: 'Verilog',
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"'],
    keywords: VERILOG_KEYWORDS,
    types: VERILOG_TYPES,
    builtins: VERILOG_BUILTINS,
    prefixTokens: ['.'],
    preprocessor: ['`'],
    numberPattern: String.raw`\d*'[sSuU]?[bBoOdDhH][0-9a-fA-F_xXzZ?]+|\d[\d_]*\.[\d_]+(?:[eE][+-]?\d+)?|0[xdb][0-9a-fA-F]+|\d[\d_]*`,
    indentOpen: '(?:\\b(?:begin|case|fork|generate|function|task|module|interface|package|clocking|covergroup)\\b|(?:\\{|\\())[^;]*$',
  },
  vhdl: {
    ...base,
    id: 'vhdl',
    label: 'VHDL',
    lineComments: ['--'],
    quotes: ['"'],
    keywords: VHDL_KEYWORDS,
    types: VHDL_TYPES,
    prefixTokens: ["'"],
    caseInsensitive: true,
    numberPattern: String.raw`\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?#[0-9a-fA-F_.]+#`,
    indentOpen: '(?:\\b(?:architecture|begin|block|case|component|entity|for|function|generate|if|package|procedure|process|record|then|type|while|when|else|elsif)\\b|(?:\\(|\\{))$',
  },
  spice: {
    ...base,
    id: 'spice',
    label: 'SPICE netlist',
    lineComments: ['*', '$'],
    quotes: ['"'],
    keywords: SPICE_KEYWORDS,
    types: SPICE_TYPES,
    /** A designator's first letter names the device class; see the reader in
     *  `src/lib/simulation/spiceImport.ts`. */
    builtins: ['R', 'r', 'C', 'c', 'L', 'l', 'V', 'v', 'I', 'i', 'D', 'd', 'Q', 'q', 'M', 'm',
      'X', 'x', 'K', 'k', 'S', 's', 'W', 'w', 'B', 'b', 'E', 'e', 'G', 'g', 'H', 'h', 'O', 'o'],

    caseInsensitive: true,
    numberPattern: String.raw`\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?[TGMkKmunpfa]?(?:[TGMkKmunpfa]?[sSfF])?`,
    indentOpen: '(?:\\b(?:for|while|if|else)\\b)$',
  },
  netlist: {
    ...base,
    id: 'netlist',
    label: 'Netlist',
    lineComments: ['#', '//'],
    quotes: ['"', "'"],
    keywords: DIGITAL_KEYWORDS,
    types: DIGITAL_TYPES,
    caseInsensitive: true,
    indentOpen: '[({]$',
  },
  python: {
    ...base,
    id: 'python',
    label: 'Python',
    lineComments: ['#'],
    quotes: ['"', "'"],
    tripleQuotes: ['"""', "'''"],
    keywords: PYTHON_KEYWORDS,
    builtins: PYTHON_BUILTINS,
    types: ['Exception', 'ValueError', 'TypeError', 'KeyError', 'IndexError', 'RuntimeError', 'StopIteration'],
    indentOpen: ':$',
  },
  c: {
    ...base,
    id: 'c',
    label: 'C / C++',
    lineComments: ['//'],
    blockComment: ['/*', '*/'],
    quotes: ['"', "'"],
    keywords: C_KEYWORDS,
    types: C_TYPES,
    builtins: C_BUILTINS,
    preprocessor: ['#'],
    indentOpen: '(?:\\{|\\b(?:else|do|while)\\b[^;]*|[a-zA-Z_]\\w*\\s*\\([^\\n]*\\)\\s*$)',
  },
  shell: {
    ...base,
    id: 'shell',
    label: 'Shell',
    lineComments: ['#'],
    quotes: ['"', "'", '`'],
    keywords: SHELL_KEYWORDS,
    builtins: SHELL_BUILTINS,
    indentOpen: '(?:\\b(?:if|then|else|elif|for|while|until|case|do|in)\\b)$',
  },
  json: {
    ...base,
    id: 'json',
    label: 'JSON',
    quotes: ['"'],
    keywords: JSON_KEYWORDS,
    types: [],
    builtins: [],
    indentOpen: '[{[]$',
  },
  text: {
    ...base,
    id: 'text',
    label: 'Plain text',
    quotes: [],
    indentOpen: '$^',
  },
}

export const DEFAULT_LANGUAGE: LanguageSpec = LANGUAGE_SPECS.text

const WORD_START = /[A-Za-z_$@]/
const WORD_BODY = /[A-Za-z0-9_$@\u0080-\uFFFF]/

/** SPICE writes commands as `.subckt` and nets as bare words, and a dot is only
 *  a word character there — nowhere else does `a.b` become one token. */
const isWordStart = (ch: string, spec: LanguageSpec): boolean =>
  WORD_START.test(ch) || (spec.id === 'spice' && ch === '.')

const isWordBody = (ch: string, spec: LanguageSpec): boolean =>
  WORD_BODY.test(ch) || (spec.id === 'spice' && ch === '.')

/** A lexer, not a parser: it produces colour spans and a completion alphabet.
 *  Anything the lexer cannot classify is emitted as `null` (default colour),
 *  which is the honest answer for a language the workbench only edits, never
 *  compiles. */
export function tokenize(source: string, spec: LanguageSpec): Segment[] {
  const segments: Segment[] = []
  const keywords = new Set((spec.keywords ?? []).map(k => spec.caseInsensitive ? k.toLowerCase() : k))
  const types = new Set((spec.types ?? []).map(k => spec.caseInsensitive ? k.toLowerCase() : k))
  const builtins = new Set((spec.builtins ?? []).map(k => spec.caseInsensitive ? k.toLowerCase() : k))
  const numberRe = spec.numberPattern ? new RegExp(`^(?:${spec.numberPattern})`) : /^(?:0[xXbB][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/
  const escape = '\\'
  const push = (kind: TokenKind | null, text: string) => {
    if (!text) return
    const last = segments[segments.length - 1]
    if (last && last.kind === kind) last.text += text
    else segments.push({ kind, text })
  }

  let i = 0
  while (i < source.length) {
    const ch = source[i]

    if (ch === '\n') {
      push(null, '\n')
      i += 1
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      const run = /^[ \t\r]+/.exec(source.slice(i))![0]
      push(null, run)
      i += run.length
      continue
    }

    const atLineStart = i === 0 || source[i - 1] === '\n'
    const lineTail = atLineStart ? source.slice(i) : null

    // Whole-line preprocessor markers (`include, #include, #define) span the
    // line so the directive verb and its payload read as one unit.
    if (lineTail && spec.preprocessor?.some(marker => lineTail.startsWith(marker))) {
      const end = source.indexOf('\n', i)
      const text = source.slice(i, end === -1 ? source.length : end)
      push('preprocessor', text)
      i += text.length
      continue
    }

    // Line comments.
    const lineComment = spec.lineComments.find(prefix => source.startsWith(prefix, i))
    if (lineComment) {
      const end = source.indexOf('\n', i)
      const text = source.slice(i, end === -1 ? source.length : end)
      push('comment', text)
      i += text.length
      continue
    }

    // Block comments.
    if (spec.blockComment && source.startsWith(spec.blockComment[0], i)) {
      const closeIndex = source.indexOf(spec.blockComment[1], i + spec.blockComment[0].length)
      const end = closeIndex === -1 ? source.length : closeIndex + spec.blockComment[1].length
      push('comment', source.slice(i, end))
      i = end
      continue
    }

    // Triple-quoted strings first, then single-line quotes.
    const triple = spec.tripleQuotes?.find(open => source.startsWith(open, i))
    if (triple) {
      let j = i + triple.length
      while (j < source.length) {
        if (source[j] === escape) { j += 2; continue }
        if (source.startsWith(triple, j)) { j += triple.length; break }
        j += 1
      }
      push('string', source.slice(i, j))
      i = j
      continue
    }
    if (spec.quotes.includes(ch)) {
      let j = i + 1
      while (j < source.length) {
        if (source[j] === escape) { j += 2; continue }
        if (source[j] === ch) { j += 1; break }
        if (source[j] === '\n') break
        j += 1
      }
      push('string', source.slice(i, j))
      i = j
      continue
    }

    // Sized / suffixed numbers, tried before words so `8'hFF` is one token.
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = numberRe.exec(source.slice(i))
      if (match && match[0].length > 0) {
        push('number', match[0])
        i += match[0].length
        continue
      }
    }

    // Prefixed words (Verilog port connections, VHDL attributes).
    const prefix = spec.prefixTokens?.find(p => ch === p && isWordStart(source[i + 1] ?? '', spec))
    if (prefix) {
      let j = i + 1
      while (j < source.length && isWordBody(source[j], spec)) j += 1
      const word = source.slice(i, j)
      push(spec.id === 'verilog' ? 'type' : 'identifier', word)
      i = j
      continue
    }

    if (isWordStart(ch, spec)) {
      let j = i
      while (j < source.length && isWordBody(source[j], spec)) j += 1
      const word = source.slice(i, j)
      // A dot-command is one word including its dot, and it outranks the
      // designator rule: `.param` is a command, `R1` is an element.
      if (spec.id === 'spice' && ch === '.') {
        const probe = word.toLowerCase()
        push(keywords.has(probe) || types.has(probe) ? 'keyword' : 'preprocessor', word)
        i = j
        continue
      }
      if (spec.id === 'spice' && atLineStart && spec.builtins?.includes(word[0].toLowerCase())) {
        // Designator: `R1`, `Ctop`, `X1` — element name, not a keyword.
        push('type', word)
        i = j
        continue
      }
      // A word followed by `(` is a call; colour function names distinctly.
      const isCall = source[j] === '('
      const probe = spec.caseInsensitive ? word.toLowerCase() : word
      if (types.has(probe)) push('type', word)
      else if (keywords.has(probe)) push('keyword', word)
      else if (builtins.has(probe) || (isCall && spec.builtins?.length)) push(builtins.has(probe) ? 'builtin' : 'identifier', word)
      else push('identifier', word)
      i = j
      continue
    }

    if (OPERATOR_CHARS.includes(ch)) {
      push('operator', ch)
      i += 1
      continue
    }

    push(null, ch)
    i += 1
  }

  return segments
}

/** Split the segment stream on newlines so the backdrop can render one row
 *  per source line, which is what keeps it aligned with the textarea. */
export function segmentsByLine(segments: Segment[]): Segment[][] {
  const lines: Segment[][] = [[]]
  for (const segment of segments) {
    const parts = segment.text.split('\n')
    parts.forEach((part, index) => {
      if (index > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ kind: segment.kind, text: part })
    })
  }
  return lines
}

export function tokenizeLines(source: string, spec: LanguageSpec): Segment[][] {
  return segmentsByLine(tokenize(source, spec))
}

/** Words available to autocomplete: the language's own vocabulary plus every
 *  identifier already in the buffer. Nothing here is invented — the popup can
 *  only offer strings that exist in this file or in this language's spec. */
export function completionVocabulary(spec: LanguageSpec, source: string): string[] {
  const out = new Set<string>()
  for (const word of [...(spec.keywords ?? []), ...(spec.types ?? []), ...(spec.builtins ?? [])]) out.add(word)
  for (const match of source.matchAll(/[A-Za-z_@$][A-Za-z0-9_@$]{1,}/g)) out.add(match[0])
  if (spec.id === 'spice') for (const match of source.matchAll(/^\s*([A-Za-z]\w*)/gm)) out.add(match[1])
  return [...out].sort((a, b) => a.localeCompare(b))
}

/** Longest prefix shared by every candidate completing `prefix`, so a popup
 *  can tab through one character at a time the way a real editor does. */
export function commonPrefix(candidates: string[]): string {
  if (candidates.length === 0) return ''
  const [first, ...rest] = candidates
  let length = first.length
  for (const word of rest) {
    let i = 0
    while (i < length && i < word.length && word[i] === first[i]) i += 1
    length = i
  }
  return first.slice(0, length)
}

/** Rank completions: exact prefix first, then substring, closest word length
 *  breaking ties. Deterministic so the same buffer always shows the same list. */
export function rankCompletions(prefix: string, vocabulary: string[], limit = 8): string[] {
  if (prefix.length < 1) return []
  const lower = prefix.toLowerCase()
  const starts: string[] = []
  const contains: string[] = []
  for (const word of vocabulary) {
    const w = word.toLowerCase()
    if (w.startsWith(lower)) starts.push(word)
    else if (w.includes(lower)) contains.push(word)
  }
  const order = (a: string, b: string) => a.length - b.length || a.localeCompare(b)
  return [...starts.sort(order), ...contains.sort(order)].slice(0, limit)
}

export function specFor(language: LanguageId | undefined): LanguageSpec {
  return language ? LANGUAGE_SPECS[language] : DEFAULT_LANGUAGE
}
