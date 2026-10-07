/**
 * Accessibility guard: fails (exit 1) when an icon-only <Button> in src/
 * has no accessible name — i.e. no aria-label/aria-labelledby, no title,
 * and no text content (including text rendered through JSX expressions).
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

const attrName = (attr) => (ts.isJsxAttribute(attr) ? attr.name.getText() : null)

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

const offenders = []

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  const visit = (node) => {
    const isButton =
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sf) === 'Button'
    if (isButton) {
      const names = node.attributes.properties
        .filter(ts.isJsxAttribute)
        .map(attrName)
        .filter(Boolean)
      const labeled =
        names.includes('aria-label') || names.includes('aria-labelledby') || names.includes('title')
      const element = ts.isJsxOpeningElement(node) ? node.parent : node
      const hasText = ts.isJsxElement(element) && elementHasText(element)
      if (!labeled && !hasText) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        offenders.push(`${path.relative(root, file)}:${line}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

if (offenders.length > 0) {
  console.error('Icon-only <Button> elements without an accessible name:')
  offenders.forEach((o) => console.error(`  ${o}`))
  console.error(`\n${offenders.length} button(s) need an aria-label.`)
  process.exit(1)
}
console.log(`OK: all icon-only buttons in src/ have accessible names (${files.length} files scanned).`)
