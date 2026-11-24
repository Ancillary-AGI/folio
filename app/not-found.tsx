import type { Metadata } from 'next'
import SiteNav from './components/SiteNav'
import SiteFooter from './components/SiteFooter'

export const metadata: Metadata = {
  title: 'This page was not found',
  description: 'The page you opened is not part of this site. Pick a destination from here.',
  robots: { index: false, follow: false },
}

const EXITS = [
  { href: '/app', label: 'The workbench', detail: 'Where boards are born — every workspace, every project.' },
  { href: '/app/demos/rectifier-pcb', label: 'Rectifier demo', detail: 'Schematic to fab package, verified end to end.' },
  { href: '/app/community', label: 'Community designs', detail: 'Proven designs, open to inspect and make yours.' },
]

export default function NotFound() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <SiteNav />

      <main id="main" className="nf">
        <div className="nf-grid wrap">
          <div className="nf-code" aria-hidden="true">404</div>
          <div className="nf-copy">
            <h1>This path is <em>nowhere.</em></h1>
            <p className="lede">The workbench, the demos and the archive all live somewhere else — over there.</p>
            <div className="cta">
              <a className="btn btn-lg" href="/app">Open the workbench</a>
              <a className="btn btn-ghost btn-lg" href="/">Back to home</a>
            </div>
            <div className="nf-exits" aria-label="Or pick a destination">
              {EXITS.map((item) => (
                <a key={item.href} href={item.href} className="nf-exit">
                  <b>{item.label}</b>
                  <span>{item.detail}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  )
}
