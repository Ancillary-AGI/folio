/**
 * Static accessibility guarantees.
 *
 * These were standalone scripts under `scripts/`, run only by `npm run verify`.
 * They are assertions about the source, so they belong in the suite: one command
 * runs them, and a regression fails the build like any other test.
 *
 * Two groups:
 *   - `icon-only buttons`: every icon-only control is named and explained.
 *   - `the accessibility contract`: the reach features a screen reader, keyboard
 *     or pointer depends on, which a type checker cannot see because they live in
 *     a stylesheet, in one anchor, or in the choice of element.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const root = process.cwd()
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8')

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

import fs from 'node:fs'

const sourceFiles = (): string[] =>
  walk(path.join(root, 'src')).filter(
    (file) => /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\.(ts|tsx)$/.test(file),
  )

const EXEMPT_BUTTON_FILES = new Set(['src/components/ui/button.tsx'])

const helpTopicIds = (): Set<string> =>
  new Set(
    [...read('src/lib/help/helpTopics.ts').matchAll(/\bid:\s*'([^']+)'/g)].map(
      (match) => match[1] as string,
    ),
  )

const attrName = (attr: ts.JsxAttributeLike): string | null =>
  ts.isJsxAttribute(attr) ? attr.name.getText() : null

const literalText = (node: ts.Node | undefined): string | null => {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isJsxExpression(node)) return literalText(node.expression)
  return null
}

const attrLiteral = (attributes: readonly ts.JsxAttributeLike[], name: string): string | null => {
  for (const attr of attributes) {
    if (ts.isJsxAttribute(attr) && attr.name.getText() === name) return literalText(attr.initializer)
  }
  return null
}

const exprIsText = (expr: ts.Expression): boolean => {
  if (ts.isJsxElement(expr) || ts.isJsxFragment(expr)) return elementHasText(expr)
  if (ts.isJsxSelfClosingElement(expr)) return false
  if (ts.isParenthesizedExpression(expr)) return exprIsText(expr.expression)
  if (ts.isConditionalExpression(expr)) {
    return exprIsText(expr.whenTrue) || exprIsText(expr.whenFalse)
  }
  return true
}

const elementHasText = (element: ts.JsxElement | ts.JsxFragment): boolean => {
  for (const child of element.children) {
    if (ts.isJsxText(child) && child.text.trim().length > 0) return true
    if (ts.isJsxExpression(child) && child.expression && exprIsText(child.expression)) return true
    if (ts.isJsxElement(child) && elementHasText(child)) return true
    if (ts.isJsxFragment(child) && elementHasText(child)) return true
  }
  return false
}

const hoverHelpExplains = (node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean => {
  const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
  const names = attributes.map(attrName).filter((name): name is string => Boolean(name))
  if (names.includes('description')) return true
  const topicId = attrLiteral(attributes, 'topicId')
  return topicId !== null && helpTopicIds().has(topicId)
}

type JsxTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement

describe('icon-only buttons are named and explained', () => {
  it('every icon-only control has an accessible name and a hover explanation', () => {
    const topics = helpTopicIds()
    const unlabeled: string[] = []
    const unexplained: string[] = []

    for (const file of sourceFiles()) {
      const relative = path.relative(root, file).replace(/\\/g, '/')
      if (EXEMPT_BUTTON_FILES.has(relative)) continue
      const text = read(relative)
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      const tagOf = (node: JsxTag): string => node.tagName.getText(source)

      const check = (node: JsxTag, ancestors: readonly JsxTag[]): void => {
        const tag = tagOf(node)
        if (tag !== 'Button' && tag !== 'button') return
        const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
        const names = attributes.map(attrName).filter((name): name is string => Boolean(name))
        const named = names.includes('title') || names.includes('aria-label') || names.includes('aria-labelledby')
        const element: ts.Node = ts.isJsxOpeningElement(node) ? node.parent : node
        if (ts.isJsxElement(element) && elementHasText(element)) return

        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        const where = `${relative}:${line}`
        if (!named) unlabeled.push(where)
        const described = ancestors.some(hoverHelpExplains)
        if (!described) unexplained.push(where)
      }

      const scan = (node: ts.Node, ancestors: readonly JsxTag[]): void => {
        if (ts.isJsxElement(node)) {
          const opening = node.openingElement
          const inside: readonly JsxTag[] =
            tagOf(opening) === 'HoverHelp' ? [...ancestors, opening] : ancestors
          check(opening, ancestors)
          for (const child of node.children) scan(child, inside)
          return
        }
        if (ts.isJsxFragment(node)) {
          for (const child of node.children) scan(child, ancestors)
          return
        }
        if (ts.isJsxSelfClosingElement(node)) {
          check(node, ancestors)
          return
        }
        ts.forEachChild(node, (child: ts.Node): void => {
          scan(child, ancestors)
        })
      }
      scan(source, [])
    }

    expect(unlabeled, `icon-only buttons without an accessible name: ${unlabeled.join(', ')}`).toEqual([])
    expect(
      unexplained,
      `icon-only buttons with no HoverHelp: ${unexplained.join(', ')}`,
    ).toEqual([])
    // The scan has to actually see something, or it passes vacuously.
    expect(topics.size).toBeGreaterThan(0)
  })
})

describe('the accessibility contract', () => {
  const css = read('app/globals.css')
  const app = read('src/App.tsx')
  const panel = read('src/components/pcb/PCBDesignPanel.tsx')

  it('ships the reach features in the stylesheet', () => {
    expect(css).toContain('.skip-link')
    expect(css).toMatch(/\.skip-link:focus-visible\s*\{[^}]*translateY\(0\)/)
    expect(css).toMatch(/@media\s*\(forced-colors:\s*active\)/)
    expect(css).toMatch(/\.cad-slider\s*\{/)
    expect(css).toMatch(/^\s*select\s*\{/m)
  })

  it('has exactly one bypass link, targeting the main landmark', () => {
    expect(app.match(/className="skip-link"/g) ?? []).toHaveLength(1)
    expect(app).toMatch(/href="#workspace"/)
    expect(app).toMatch(/<main\s+id="workspace"/)
  })

  it('keeps one slider control, so one skin and one keyboard contract covers them', () => {
    const rangeControl = 'src/components/ui/range-control.tsx'
    const strays = sourceFiles()
      .filter((file) => path.relative(root, file).replace(/\\/g, '/') !== rangeControl)
      .filter((file) => /type=(["'])range\1/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file).replace(/\\/g, '/'))
    expect(strays).toEqual([])
    expect(read(rangeControl)).toContain('aria-valuetext')
  })

  it('gives every switch a state', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/role=(["'])switch\1/g)) {
        const at = match.index ?? 0
        const window = text.slice(Math.max(0, at - 600), at + 900)
        if (!/aria-checked/.test(window)) {
          offenders.push(`${path.relative(root, file).replace(/\\/g, '/')}:${text.slice(0, at).split('\n').length}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('declares a document language', () => {
    expect(read('app/layout.tsx')).toMatch(/<html[^>]*\blang=/)
  })

  it('floors pointer targets and lets the tool rail scroll', () => {
    const floor = css.match(/button,\s*\[role='button'\][^{]*\{[^}]*\}/)
    expect(floor?.[0]).toMatch(/min-height:\s*1\.5rem/)
    expect(floor?.[0]).toMatch(/min-width:\s*1\.5rem/)

    const rail = css.match(/^\s*\.cad-rail\s*\{[^}]*\}/m)
    expect(rail?.[0]).toMatch(/overflow-y-auto/)
    const railButton = css.match(/^\s*\.cad-rail-btn\s*\{[^}]*\}/m)
    expect(railButton?.[0]).toMatch(/flex-shrink-0/)
  })

  it('keeps the board palette from squeezing its tools and the board visible', () => {
    const palette = panel.match(/aria-label="Board tools"\s*\n\s*className="([^"]+)"/)
    const className = palette?.[1] ?? ''
    expect(className).toMatch(/overflow-y-auto/)
    expect(className).toMatch(/scrollbar-none/)
    expect(className).toMatch(/w-12/)
    expect(className).toMatch(/lg:w-36/)
    expect(panel).toMatch(/min-h-\[180px\]\s+flex-1/)
  })

  it('never scrolls a navigation rail sideways', () => {
    const RAIL_SCROLL =
      /<[a-zA-Z][a-zA-Z0-9.]*\b[^>]{0,900}?(?:\brole=["'](tablist|group)["'][^>]{0,900}?\bclass(?:Name)?=["'][^"']*overflow-x-auto|class(?:Name)?=["'][^"']*overflow-x-auto[^>]{0,900}?\brole=["'](tablist|group)["'])[^>]*>/gs
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(RAIL_SCROLL)) {
        offenders.push(
          `${path.relative(root, file).replace(/\\/g, '/')}: ${match[0].slice(0, 60).replace(/\s+/g, ' ')}`,
        )
      }
    }
    expect(offenders).toEqual([])
  })

  it('never asks a question in the browser chrome', () => {
    const NATIVE_BOX = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(\s*['"`]/
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (NATIVE_BOX.test(line)) {
          offenders.push(
            `${path.relative(root, file).replace(/\\/g, '/')}:${index + 1} ${line.trim().slice(0, 60)}`,
          )
        }
      })
    }
    expect(offenders).toEqual([])
  })
})