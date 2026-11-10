/**
 * Accessibility guard: fails (exit 1) when an icon-only <Button> in src/
 * is not named, or is named but not explained.
 *
 * Two separate promises, both measured on the source:
 *   1. an accessible name — aria-label/aria-labelledby/title, or text content;
 *   2. a hover description — what the control does, shown by resting the
 *      pointer on it. That is either a native `title` or a <HoverHelp> wrapper
 *      whose topic actually resolves: HoverHelp renders bare children when the
 *      heading or body is missing, so a typo'd topicId looks wired and is silent.
 *
 * Run via: npm run a11y:buttons  (also enforced in CI)
 */
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')

const files = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) files.push(p)
  }
}
walk(srcDir)

// The topic ids HoverHelp can resolve, read from the registry itself.
const topicsSource = fs.readFileSync(path.join(root, 'src/lib/help/helpTopics.ts'), 'utf8')
const topicIds = new Set([...topicsSource.matchAll(/\bid:\s*'([^']+)'/g)].map((m) => m[1]))

const attrName = (attr) => (ts.isJsxAttribute(attr) ? attr.name.getText() : null)

/**
 * The literal text behind a JSX attribute, written either as `prop="x"` or as
 * `prop={'x'}`. A quoted JSX attribute is a JsxString, which in the TypeScript
 * AST the project ships reports as a string literal, so both spellings land on
 * the same branch.
 */
const literalText = (node) => {
  if (!node) return null
  if (ts.isStringLiteral(node) || node.kind === ts.SyntaxKind.JsxString) return node.text
  if (ts.isJsxExpression(node)) return literalText(node.expression)
  return null
}

const attrLiteral = (attributes, name) => {
  for (const attr of attributes) {
    if (!ts.isJsxAttribute(attr) || attr.name.getText() !== name) continue
    return literalText(attr.initializer)
  }
  return null
}

// True when an expression renders textual content (not just icon elements).
const exprIsText = (expr) => {
  if (ts.isJsxElement(expr) || ts.isJsxFragment(expr)) return elementHasText(expr)
  if (ts.isJsxSelfClosingElement(expr)) return false
  if (ts.isParenthesizedExpression(expr)) return exprIsText(expr.expression)
  if (ts.isConditionalExpression(expr)) return exprIsText(expr.whenTrue) || exprIsText(expr.whenFalse)
  return true // identifiers, literals, calls, property access, etc. render text
}

const elementHasText = (jsxElement) => {
  for (const child of jsxElement.children) {
    if (ts.isJsxText(child) && child.text.trim().length > 0) return true
    if (ts.isJsxExpression(child) && child.expression && exprIsText(child.expression)) return true
    if (ts.isJsxElement(child) && elementHasText(child)) return true
    if (ts.isJsxFragment(child) && elementHasText(child)) return true
  }
  return false
}

/** A HoverHelp only explains a control if it can render a heading and a body. */
const hoverHelpExplains = (node) => {
  const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
  const names = attributes.map(attrName).filter(Boolean)
  if (names.includes('description')) return true
  const topicId = attrLiteral(attributes, 'topicId')
  return topicId !== null && topicIds.has(topicId)
}

const unlabeled = []
const unexplained = []
const doubleTooltipped = []

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  const tagOf = (node) => node.tagName.getText(sf);

  const checkButton = (node, hoverHelpAncestors) => {
    if (tagOf(node) !== 'Button') return;
    const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
    const names = attributes.map(attrName).filter(Boolean);
    const hasTitle = names.includes('title');
    const labeled = hasTitle || names.includes('aria-label') || names.includes('aria-labelledby');
    const element = ts.isJsxOpeningElement(node) ? node.parent : node;
    const hasText = ts.isJsxElement(element) && elementHasText(element);
    if (hasText) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const where = `${path.relative(root, file).split(path.sep).join('/')}:${line}`;
    if (!labeled) unlabeled.push(where);
    const describedByHover = hoverHelpAncestors.some(hoverHelpExplains);
    if (!hasTitle && !describedByHover) unexplained.push(where);
    // Two mechanisms, two cards on the same hover — the OS tooltip arrives
    // roughly a second after ours and both say the same thing.
    if (hasTitle && describedByHover) doubleTooltipped.push(where);
  };

  /*
   * Walking the JSX tree by element rather than with a flat `forEachChild`
   * descent is the only way to know whether a Button sits *inside* a HoverHelp:
   * the opening tag and the children are siblings, so a generic traversal never
   * puts the wrapper in the button's ancestor chain.
   */
  const scan = (node, helpAncestors) => {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      const inside = tagOf(opening) === 'HoverHelp' ? [...helpAncestors, opening] : helpAncestors;
      checkButton(opening, helpAncestors);
      for (const child of node.children) scan(child, inside);
      return;
    }
    if (ts.isJsxFragment(node)) {
      for (const child of node.children) scan(child, helpAncestors);
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      checkButton(node, helpAncestors);
      return;
    }
    ts.forEachChild(node, (child) => scan(child, helpAncestors));
  };
  scan(sf, []);
}

let failed = false
if (unlabeled.length > 0) {
  failed = true
  console.error('Icon-only <Button> elements without an accessible name:')
  unlabeled.forEach((o) => console.error(`  ${o}`))
  console.error(`\n${unlabeled.length} button(s) need an aria-label.`)
}
if (unexplained.length > 0) {
  failed = true
  console.error('Icon-only <Button> elements with no hover description:')
  unexplained.forEach((o) => console.error(`  ${o}`))
  console.error(
    `\n${unexplained.length} button(s) need a title, or a <HoverHelp> whose topicId resolves in src/lib/help/helpTopics.ts.`,
  )
}
if (doubleTooltipped.length > 0) {
  failed = true
  console.error('Buttons inside a HoverHelp that also carry a native title (two tooltips, one control):')
  doubleTooltipped.forEach((o) => console.error(`  ${o}`))
  console.error(`\n${doubleTooltipped.length} button(s) should keep only the HoverHelp card.`)
}
if (failed) process.exit(1)
console.log(
  `OK: every icon-only button in src/ is named and explained (${files.length} files scanned).`,
)
