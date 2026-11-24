import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/*
 * Every internal link the site renders must have a route behind it. The check
 * reads the same source tree the build does and maps it to Next's routing
 * rules, so a renamed folder or a deleted page fails here instead of becoming a
 * 404 in production. It deliberately reads literal hrefs only: a link built
 * from data is validated by the data's own parser (legal link schemes, site
 * settings URLs), not guessed at from source.
 */

const ROOT = process.cwd()
const APP = join(ROOT, 'app')
const SRC = join(ROOT, 'src')

const walk = (directory: string): string[] => {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) files.push(...walk(path))
    else files.push(path)
  }
  return files
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Translate one Next route folder into the regex that matches its URLs. */
function routeMatcher(route: string): RegExp {
  const segments = route.split('/').filter(Boolean)
  let pattern = ''
  for (const segment of segments) {
    // Route groups do not appear in the URL.
    if (segment.startsWith('(') && segment.endsWith(')') && !segment.startsWith('[[')) continue
    if (segment.startsWith('[[...') && segment.endsWith(']]')) {
      pattern += '(?:/[^/]+)*'
    } else if (segment.startsWith('[...') && segment.endsWith(']')) {
      pattern += '/.+'
    } else if (segment.startsWith('[') && segment.endsWith(']')) {
      pattern += '/[^/]+'
    } else {
      pattern += `/${escapeRegExp(segment)}`
    }
  }
  return new RegExp(`^${pattern || '/'}$`)
}

function discoveredRoutes(): string[] {
  const routes: string[] = []
  for (const file of walk(APP)) {
    const base = file.split(/[\\/]/).pop() ?? ''
    if (base !== 'page.tsx' && base !== 'route.ts') continue
    const relativeDir = relative(APP, file).split(/[\\/]/).slice(0, -1).join('/')
    routes.push(relativeDir ? `/${relativeDir}` : '/')
  }
  // Metadata routes are files, not folders, and have fixed URLs.
  if (existsSync(join(APP, 'sitemap.ts'))) routes.push('/sitemap.xml')
  if (existsSync(join(APP, 'robots.ts'))) routes.push('/robots.txt')
  if (existsSync(join(APP, 'manifest.ts'))) routes.push('/manifest.webmanifest')
  return routes
}

const LINK_PATTERNS = [
  /href\s*=\s*"([^"]+)"/g,
  /href\s*=\s*'([^']+)'/g,
  /href\s*=\s*\{\s*['"`]([^'"`]+)['"`]\s*\}/g,
  /href\s*:\s*'([^']+)'/g,
  /href\s*:\s*"([^"]+)"/g,
]

interface FoundLink {
  href: string
  where: string
}

function literalLinks(): FoundLink[] {
  const links: FoundLink[] = []
  const files = [...walk(APP), ...walk(SRC)]
    .filter((file) => /\.(tsx?|jsx?)$/.test(file))
    .filter((file) => !/[\\/]__tests__[\\/]|\.test\.(tsx?|jsx?)$|\.spec\.(tsx?|jsx?)$/.test(file))
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const lines = source.split(/\r?\n/)
    for (const pattern of LINK_PATTERNS) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(source)) !== null) {
        const line = source.slice(0, match.index).split(/\r?\n/).length
        links.push({
          href: match[1],
          where: `${relative(ROOT, file).replace(/\\/g, '/')}:${line}:${lines[line - 1]?.trim() ?? ''}`,
        })
      }
    }
  }
  return links
}

const normalise = (href: string): string => {
  const path = href.split('#')[0].split('?')[0]
  if (!path || path === '/') return '/'
  return path.replace(/\/+$/, '')
}

describe('internal links', () => {
  it('have a page or route behind them', () => {
    const routes = discoveredRoutes()
    expect(routes).toContain('/')
    expect(routes).toContain('/admin')
    expect(routes).toContain('/console')

    const missing: string[] = []
    const links = literalLinks()
    // Guard the scanner itself: a broken regex must not pass by finding nothing.
    expect(links.length).toBeGreaterThan(20)
    for (const { href, where } of links) {
      if (!href.startsWith('/') || href.startsWith('//')) continue
      const path = normalise(href)
      if (!routes.some((route) => routeMatcher(route).test(path))) {
        missing.push(`${href} in ${where}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('does not point at the removed marketing pages', () => {
    const stale = literalLinks().filter(({ href }) =>
      href === '/responsible-ai' || href === '/landing.html' || href.startsWith('/landing.html'))
    expect(stale).toEqual([])

    // The generated metadata routes replaced these static files.
    expect(existsSync(join(ROOT, 'public', 'sitemap.xml'))).toBe(false)
    expect(existsSync(join(ROOT, 'public', 'robots.txt'))).toBe(false)
    expect(existsSync(join(ROOT, 'public', 'site.webmanifest'))).toBe(false)
  })

  it('keeps the advertised crawler routes real', async () => {
    const { PUBLIC_ROUTES } = await import('../lib/site/routes')
    const routes = discoveredRoutes()
    for (const route of PUBLIC_ROUTES) {
      expect(routes.some((candidate) => routeMatcher(candidate).test(route.path))).toBe(true)
    }
  })
})
