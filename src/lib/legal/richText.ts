/**
 * A small, safe rich-text document model.
 *
 * Legal and company copy is edited as rich text, but the database never stores
 * an HTML string that a renderer injects. It stores blocks of runs: a paragraph
 * is a list of text spans, each span optionally bold, italic, underlined,
 * struck through, monospaced, or linked. The public renderer builds React
 * elements from that data, and `dangerouslySetInnerHTML` is not used anywhere
 * on the reading path.
 *
 * The only HTML in the system is the initial markup handed to the admin's
 * contentEditable surface, produced here from a document that has already been
 * normalised. Even if a stored row were corrupted, `normalizeRichText` drops
 * unknown shapes and unsafe link schemes before that markup is built.
 */

export interface RichTextRun {
  text: string
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
  /** Only http(s) and mailto links survive normalisation. */
  href?: string
}

export type RichTextBlock =
  | { type: 'paragraph'; runs: RichTextRun[] }
  | { type: 'heading'; level: 2 | 3; runs: RichTextRun[] }
  | { type: 'quote'; runs: RichTextRun[] }
  | { type: 'list'; ordered: boolean; items: RichTextRun[][] }

export interface RichTextLimits {
  maxBlocks: number
  maxRunsPerBlock: number
  maxListItems: number
  maxCharacters: number
}

/** Generous for a legal page; small enough to keep a bad paste bounded. */
export const RICH_TEXT_LIMITS: Readonly<RichTextLimits> = Object.freeze({
  maxBlocks: 400,
  maxRunsPerBlock: 400,
  maxListItems: 200,
  maxCharacters: 60000,
})

const SAFE_HREF = /^(https?:\/\/|mailto:)/i

export function safeRichTextHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const href = value.trim()
  if (!href || !SAFE_HREF.test(href)) return undefined
  return href
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

function optionalTrue(value: unknown): true | undefined {
  return value === true ? true : undefined
}

function normalizeRun(value: unknown): RichTextRun | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.text !== 'string' || value.text.length === 0) return undefined
  const run: RichTextRun = { text: value.text }
  if (optionalTrue(value.bold)) run.bold = true
  if (optionalTrue(value.italic)) run.italic = true
  if (optionalTrue(value.underline)) run.underline = true
  if (optionalTrue(value.strike)) run.strike = true
  if (optionalTrue(value.code)) run.code = true
  const href = safeRichTextHref(value.href)
  if (href) run.href = href
  return run
}

const sameMarks = (a: RichTextRun, b: RichTextRun): boolean =>
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.strike === b.strike &&
  a.code === b.code &&
  a.href === b.href

/** Merge adjacent spans carrying identical formatting; keeps the model small. */
export function mergeRuns(runs: RichTextRun[]): RichTextRun[] {
  const merged: RichTextRun[] = []
  for (const run of runs) {
    if (run.text.length === 0) continue
    const last = merged[merged.length - 1]
    if (last && sameMarks(last, run)) {
      last.text += run.text
    } else {
      merged.push({ ...run })
    }
  }
  return merged
}

function normalizeRuns(value: unknown, maxRuns: number): RichTextRun[] {
  if (!Array.isArray(value)) return []
  const runs: RichTextRun[] = []
  for (const entry of value.slice(0, maxRuns)) {
    if (typeof entry === 'string') {
      if (entry.length > 0) runs.push({ text: entry })
      continue
    }
    const run = normalizeRun(entry)
    if (run) runs.push(run)
  }
  return mergeRuns(runs)
}

const runsHaveText = (runs: RichTextRun[]): boolean =>
  runs.some((run) => run.text.trim().length > 0)

function normalizeBlock(value: unknown): RichTextBlock | undefined {
  if (!isRecord(value)) return undefined
  const type = value.type
  if (type === 'paragraph' || type === 'quote') {
    const runs = normalizeRuns(value.runs, RICH_TEXT_LIMITS.maxRunsPerBlock)
    return runsHaveText(runs) ? { type, runs } : undefined
  }
  if (type === 'heading') {
    const level = value.level === 3 ? 3 : 2
    const runs = normalizeRuns(value.runs, RICH_TEXT_LIMITS.maxRunsPerBlock)
    return runsHaveText(runs) ? { type, level, runs } : undefined
  }
  if (type === 'list') {
    if (!Array.isArray(value.items)) return undefined
    const items: RichTextRun[][] = []
    for (const item of value.items.slice(0, RICH_TEXT_LIMITS.maxListItems)) {
      const runs = normalizeRuns(item, RICH_TEXT_LIMITS.maxRunsPerBlock)
      if (runsHaveText(runs)) items.push(runs)
    }
    return items.length > 0 ? { type, ordered: value.ordered === true, items } : undefined
  }
  return undefined
}

/**
 * Turn anything that claims to be a rich-text document into one that is.
 *
 * Strings are accepted as a single paragraph. Unknown block types, empty
 * blocks, non-object runs and unsafe hrefs are dropped rather than repaired
 * into something the operator did not write. The result is always renderable.
 */
export function normalizeRichText(value: unknown): RichTextBlock[] {
  if (value === undefined || value === null) return []
  const source = typeof value === 'string' ? [{ type: 'paragraph', runs: [{ text: value }] }] : value
  if (!Array.isArray(source)) return []
  const blocks: RichTextBlock[] = []
  let characters = 0
  for (const entry of source.slice(0, RICH_TEXT_LIMITS.maxBlocks)) {
    const block = normalizeBlock(entry)
    if (!block) continue
    const length = richTextBlockLength(block)
    if (characters + length > RICH_TEXT_LIMITS.maxCharacters) break
    characters += length
    blocks.push(block)
  }
  return blocks
}

export function richTextBlockLength(block: RichTextBlock): number {
  if (block.type === 'list') {
    return block.items.reduce((sum, item) => sum + item.reduce((n, run) => n + run.text.length, 0), 0)
  }
  return block.runs.reduce((n, run) => n + run.text.length, 0)
}

export function richTextLength(blocks: readonly RichTextBlock[]): number {
  return blocks.reduce((sum, block) => sum + richTextBlockLength(block), 0)
}

export function richTextHasText(blocks: readonly RichTextBlock[]): boolean {
  return blocks.some((block) => {
    if (block.type === 'list') return block.items.some(runsHaveText)
    return runsHaveText(block.runs)
  })
}

export function richTextToPlainText(blocks: readonly RichTextBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'list') {
      return block.items.map((item, index) => {
        const prefix = block.ordered ? `${index + 1}. ` : '• '
        return prefix + item.map((run) => run.text).join('')
      }).join('\n')
    }
    return block.runs.map((run) => run.text).join('')
  }).join('\n')
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const escapeAttribute = (value: string): string => escapeHtml(value)

function runToHtml(run: RichTextRun): string {
  let html = escapeHtml(run.text).replace(/\n/g, '<br>')
  if (run.code) html = `<code>${html}</code>`
  if (run.bold) html = `<strong>${html}</strong>`
  if (run.italic) html = `<em>${html}</em>`
  if (run.underline) html = `<u>${html}</u>`
  if (run.strike) html = `<s>${html}</s>`
  if (run.href) {
    html = `<a href="${escapeAttribute(run.href)}" rel="noopener noreferrer">${html}</a>`
  }
  return html
}

const runsToHtml = (runs: readonly RichTextRun[]): string => runs.map(runToHtml).join('')

/**
 * Serialise a normalised document to editable markup.
 *
 * This is the only place rich text becomes HTML, and its only consumer is the
 * admin editor's `contentEditable` initial state. It is not a public renderer.
 */
export function richTextToHtml(blocks: readonly RichTextBlock[]): string {
  if (blocks.length === 0) return '<p><br></p>'
  return blocks.map((block) => {
    if (block.type === 'paragraph') return `<p>${runsToHtml(block.runs)}</p>`
    if (block.type === 'heading') return `<h${block.level}>${runsToHtml(block.runs)}</h${block.level}>`
    if (block.type === 'quote') return `<blockquote>${runsToHtml(block.runs)}</blockquote>`
    const tag = block.ordered ? 'ol' : 'ul'
    const items = block.items.map((item) => `<li>${runsToHtml(item)}</li>`).join('')
    return `<${tag}>${items}</${tag}>`
  }).join('')
}

/* ------------------------------------------------------------------------- *
 * DOM -> document                                                           *
 * ------------------------------------------------------------------------- */

interface Marks {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
  href?: string
}

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'blockquote', 'pre'])
const DROP_TAGS = new Set(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'template', 'svg', 'math'])

function pushRun(runs: RichTextRun[], text: string, marks: Marks): void {
  if (!text) return
  const run: RichTextRun = { text }
  if (marks.bold) run.bold = true
  if (marks.italic) run.italic = true
  if (marks.underline) run.underline = true
  if (marks.strike) run.strike = true
  if (marks.code) run.code = true
  if (marks.href) run.href = marks.href
  const last = runs[runs.length - 1]
  if (last && sameMarks(last, run)) {
    last.text += text
  } else {
    runs.push(run)
  }
}

function inlineRuns(node: Node, marks: Marks): RichTextRun[] {
  const runs: RichTextRun[] = []
  const walk = (current: Node, currentMarks: Marks): void => {
    if (current.nodeType === Node.TEXT_NODE) {
      pushRun(runs, current.textContent ?? '', currentMarks)
      return
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return
    const element = current as HTMLElement
    const tag = element.tagName.toLowerCase()
    if (DROP_TAGS.has(tag)) return
    if (tag === 'br') {
      pushRun(runs, '\n', currentMarks)
      return
    }
    const next: Marks = { ...currentMarks }
    if (tag === 'strong' || tag === 'b') next.bold = true
    if (tag === 'em' || tag === 'i') next.italic = true
    if (tag === 'u') next.underline = true
    if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true
    if (tag === 'code' || tag === 'kbd' || tag === 'samp') next.code = true
    if (tag === 'a') {
      const href = safeRichTextHref(element.getAttribute('href'))
      if (href) next.href = href
      else delete next.href
    }
    for (const child of Array.from(element.childNodes)) walk(child, next)
  }
  walk(node, marks)
  return mergeRuns(runs)
}

/**
 * Read the editor's DOM back into the document model.
 *
 * The editor is an uncontrolled contentEditable surface, so this is the
 * authoritative read: the save button serialises what is on screen, not what
 * the last React render remembered.
 */
export function serializeRichTextDom(root: HTMLElement): RichTextBlock[] {
  const raw: RichTextBlock[] = []
  let pending: RichTextRun[] = []

  const flush = (): void => {
    if (runsHaveText(pending)) raw.push({ type: 'paragraph', runs: mergeRuns(pending) })
    pending = []
  }

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushRun(pending, node.textContent ?? '', {})
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()
    if (DROP_TAGS.has(tag)) return
    if (tag === 'br') {
      flush()
      return
    }
    if (tag === 'p' || tag === 'div') {
      flush()
      const runs = inlineRuns(element, {})
      if (runsHaveText(runs)) raw.push({ type: 'paragraph', runs })
      return
    }
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      flush()
      const runs = inlineRuns(element, {})
      if (runsHaveText(runs)) {
        raw.push({ type: 'heading', level: tag === 'h1' || tag === 'h2' ? 2 : 3, runs })
      }
      return
    }
    if (tag === 'blockquote') {
      flush()
      const runs = inlineRuns(element, {})
      if (runsHaveText(runs)) raw.push({ type: 'quote', runs })
      return
    }
    if (tag === 'ul' || tag === 'ol') {
      flush()
      const items: RichTextRun[][] = []
      for (const child of Array.from(element.children)) {
        if (child.tagName.toLowerCase() !== 'li') continue
        const runs = inlineRuns(child, {})
        if (runsHaveText(runs)) items.push(runs)
      }
      if (items.length > 0) raw.push({ type: 'list', ordered: tag === 'ol', items })
      return
    }
    if (tag === 'pre') {
      flush()
      const text = element.textContent ?? ''
      if (text.trim()) raw.push({ type: 'paragraph', runs: [{ text, code: true }] })
      return
    }
    /* Unknown element: keep its text and formatting, not its structure. */
    for (const run of inlineRuns(element, {})) pushRun(pending, run.text, run)
  }

  for (const child of Array.from(root.childNodes)) visit(child)
  flush()
  return normalizeRichText(raw)
}

export function isBlockTag(tagName: string): boolean {
  return BLOCK_TAGS.has(tagName.toLowerCase())
}
