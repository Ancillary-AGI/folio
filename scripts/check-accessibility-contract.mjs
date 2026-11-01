/**
 * Accessibility contract guard: fails (exit 1) when the shell stops providing
 * the reach features the help centre claims for it.
 *
 * These are the invariants that a screen reader, a keyboard or a pointer depends
 * on and that a type checker cannot see, because they live in a stylesheet, in
 * one anchor tag, or in the choice of element. Each check is a fact about the
 * source, not a rendering claim.
 *
 * Run via: npm run a11y:contract  (also enforced in `npm run verify`)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')

const failures = []
const check = (ok, description) => {
  if (!ok) failures.push(description)
}

/** Every component source file, tests excluded — they quote markup, they do not ship it. */
const sources = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(p) && !/\.(test|spec)\.(ts|tsx)$/.test(p) && !p.includes(`${path.sep}__tests__${path.sep}`)) {
      sources.push(p)
    }
  }
}
walk(srcDir)

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const rel = (p) => path.relative(root, p).split(path.sep).join('/')

// 1. The stylesheet carries the control skins that the panels rely on.
const css = read('src/index.css')
check(css.includes('.skip-link'), 'src/index.css must define .skip-link (the WCAG 2.4.1 bypass link).')
check(
  /\.skip-link:focus-visible\s*\{[^}]*translateY\(0\)/.test(css),
  'src/index.css must reveal .skip-link on focus; a hidden link nobody can tab to is not a skip link.',
)
check(/@media\s*\(forced-colors:\s*active\)/.test(css), 'src/index.css must carry a forced-colors sheet for Windows High Contrast.')
check(/\.cad-slider\s*\{/.test(css), 'src/index.css must define .cad-slider, the skin for the shared range control.')
check(/^\s*select\s*\{/m.test(css), 'src/index.css must style bare <select> elements so the CAD dropdowns read as one control.')

// 2. The shell ships exactly one bypass link, and it targets a real landmark.
const app = read('src/App.tsx')
const skipLinks = app.match(/className="skip-link"/g) ?? []
check(skipLinks.length === 1, `src/App.tsx should render one skip link, found ${skipLinks.length}.`)
check(/href="#workspace"/.test(app), 'src/App.tsx skip link must target #workspace.')
check(/<main\s+id="workspace"/.test(app), 'The #workspace target must be the <main> landmark in src/App.tsx.')

// 3. Custom sliders are one component, so one skin and one keyboard contract covers them all.
const rangeControl = 'src/components/ui/range-control.tsx'
const strayRanges = sources
  .filter((p) => rel(p) !== rangeControl && /type=(["'])range\1/.test(fs.readFileSync(p, 'utf8')))
  .map((p) => rel(p))
check(strayRanges.length === 0, `Native range inputs outside the shared control have no skin or aria-valuetext: ${strayRanges.join(', ')}`)
check(/aria-valuetext/.test(read(rangeControl)), 'The shared range control must announce a written value via aria-valuetext.')

// 4. A switch is only a switch if it reports its state.
const bareSwitches = []
for (const p of sources) {
  const text = fs.readFileSync(p, 'utf8')
  for (const match of text.matchAll(/role=(["'])switch\1/g)) {
    const at = match.index ?? 0
    const window = text.slice(Math.max(0, at - 600), at + 900)
    if (!/aria-checked/.test(window)) bareSwitches.push(`${rel(p)}:${text.slice(0, at).split('\n').length}`)
  }
}
check(bareSwitches.length === 0, `role="switch" without aria-checked reads as a dead button: ${bareSwitches.join(', ')}`)

// 5. A document with no language is read in the wrong one.
check(/<html[^>]*\blang=/.test(read('index.html')), 'index.html must declare a language on <html>.')

// 6. Pointer targets are big enough to hit, and the tool rail scrolls instead
//    of squashing. Both were measured defects (21px chart buttons; a rail that
//    rendered every 32px tool at 16px on a short window), so they are pinned.
const targetFloor = css.match(/button,\s*\[role='button'\][^{]*\{[^}]*\}/)
check(
  targetFloor && /min-height:\s*1\.5rem/.test(targetFloor[0]) && /min-width:\s*1\.5rem/.test(targetFloor[0]),
  'src/index.css must floor every pointer target at 24px (WCAG 2.5.8 target size minimum).'
)
const railBox = css.match(/\.cad-rail\s*\{[^}]*\}/)
check(
  railBox && /overflow-y-auto/.test(railBox[0]),
  'The tool rail must scroll when it is shorter than its buttons, never compress them.'
)
const railButton = css.match(/\.cad-rail-btn\s*\{[^}]*\}/)
check(
  railButton && /flex-shrink-0/.test(railButton[0]),
  '.cad-rail-btn must refuse to shrink; a squeezed tool button puts its keycap across the icon.'
)

// 7. The board palette and the board itself. Both failed in the same direction
//    on a short or narrow window and both were measured: the palette's 11px
//    scrollbar took width off the content box until every tool hit the 24px
//    floor 5px off the rail's centre line, and the rows above the drawing left
//    the board SVG exactly 0px tall.
const pcbPanel = read('src/components/pcb/PCBDesignPanel.tsx')
const boardPalette = pcbPanel.match(/aria-label="Board tools"\s*\n\s*className="([^"]+)"/)
check(
  boardPalette && /overflow-y-auto/.test(boardPalette[1]) && /scrollbar-none/.test(boardPalette[1]),
  'The board palette must scroll without a visible bar; a scrollbar squeezes every tool and shifts its icon off the rail centre.'
)
check(
  boardPalette && /w-12/.test(boardPalette[1]) && /lg:w-36/.test(boardPalette[1]),
  'The board palette must collapse to a 48px icon rail below lg rather than take width off the board.'
)
check(
  /min-h-\[180px\]\s+flex-1/.test(pcbPanel),
  'The board drawing must keep a 180px floor; a short window used to squeeze it to zero height.'
)

if (failures.length > 0) {
  console.error('Accessibility contract violated:')
  failures.forEach((f) => console.error(`  - ${f}`))
  console.error(`\n${failures.length} contract check(s) failed.`)
  process.exit(1)
}
console.log(`OK: accessibility contract holds (${sources.length} source files scanned).`)
