import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import SiteNav from './components/SiteNav'
import SiteFooter from './components/SiteFooter'
import FaqList from './components/FaqList'
import NewsletterSubscribe from './components/NewsletterSubscribe'
import TestimonialsFromDb from './components/TestimonialsFromDb'
import { loadSiteSettings } from '../src/lib/site/siteSettings'

export async function generateMetadata(): Promise<Metadata> {
  const settings = await loadSiteSettings()
  return {
    title: settings.tagline || settings.productName || 'Home',
    ...(settings.description ? { description: settings.description } : {}),
    alternates: { canonical: '/' },
  }
}

const DISCIPLINES: Array<{ cls: string; label: string; detail: string }> = [
  { cls: 'strip-c-elec', label: 'Electronics', detail: 'Schematic · solver · PCB' },
  { cls: 'strip-c-ctrl', label: 'Control', detail: 'PID · Bode · Nyquist · Z-N' },
  { cls: 'strip-c-mech', label: 'Mechanical', detail: 'Enclosures · structures · fixtures' },
  { cls: 'strip-c-rf', label: 'RF · Photonics', detail: 'Butterworth · S-parameters · link budget' },
  { cls: 'strip-c-rob', label: 'Robotics', detail: 'DH chains · Jacobians · trajectory' },
  { cls: 'strip-c-life', label: 'Life systems', detail: 'Mass-action · Hodgkin-Huxley · PK' },
]

const TEMPLATES: Array<{ eyebrow: string; title: string; body: string; motif: ReactNode }> = [
  { eyebrow: 'Rectifier', title: 'Half-wave rectifier, start to gerber', body: 'Transient, routing, BOM, fab gate — every stage demonstrated.', motif: (
    <path d="M4 28 C 9 8, 15 8, 20 28 M4 28 C 9 48, 15 48, 20 28 M24 28 H34 M34 20 V36 M34 24 H44 M44 20 V36" />
  ) },
  { eyebrow: 'Mainboard', title: 'Laptop mainboard, 8-layer', body: '56 packages, BGA-256 SoC, LPDDR4x pairs, HDI escape routing.', motif: (
    <g><rect x="20" y="12" width="26" height="26" rx="2" />{[16, 24, 32, 40, 48].map((x) => <line key={'h' + x} x1="14" x2="52" y1={x * 0.55 + 10} y2={x * 0.55 + 10} />)}{[14, 22, 30, 38, 46].map((y) => <line key={'v' + y} x1={y * 0.75 + 12} x2={y * 0.75 + 12} y1="10" y2="44" />)}</g>
  ) },
  { eyebrow: 'Control', title: 'Motor speed loop with PID', body: 'Measured step response; auto-tune with Z-N, relay or model-reference search.', motif: (
    <path d="M6 44 H58 M6 44 H18 C26 44, 26 26, 34 22 L58 20" />
  ) },
  { eyebrow: 'Robotics', title: 'Two-link robotic arm', body: 'Forward/inverse kinematics, Jacobians, damped least-squares IK.', motif: (
    <g><path d="M10 44 H24" /><circle cx="24" cy="44" r="3" /><path d="M24 44 L36 24" /><circle cx="36" cy="24" r="2.5" /><path d="M36 24 L50 12" /><circle cx="50" cy="12" r="2" /></g>
  ) },
  { eyebrow: 'RF', title: 'Butterworth low-pass ladder', body: 'g-valued sections, S-parameter cascades, roll-off by construction.', motif: (
    <path d="M6 24 H14 M6 24 M14 24 V16 M14 16 H22 M22 24 H30 M30 24 V32 M30 32 H38 M38 24 H46 M46 24 V16 M46 16 H54 M54 24 H58" />
  ) },
  { eyebrow: 'Structures', title: 'Pratt & Howe trusses', body: 'Reaction closure, Euler buckling, an A3 drawing from the solver.', motif: (
    <g><path d="M6 42 L18 22 L30 42 L42 22 L54 42" /><path d="M6 42 H54 M18 22 H42" /></g>
  ) },
]

export default async function LandingPage() {
  /* Operator-owned copy, read per request. The migration seeds the shipped
 * words, so the page renders exactly what the repository shows on a fresh
 * deployment, and an operator can clear or replace any element without a
 * redeploy. Nothing here falls back to a compiled-in marketing line: a blank
 * field means the operator omitted that element. The headline is structural,
 * so an empty one borrows the product name rather than leaving the page
 * without an h1. */
  const settings = await loadSiteSettings()
  const eyebrow = settings.heroEyebrow
  const heading = settings.heroHeading ?? settings.productName ?? settings.tagline
  const lede = settings.heroLede
  const ctaLabel = settings.heroCtaLabel
  const ctaHref = settings.heroCtaHref

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <SiteNav />

      <main id="main">
        <header className="hero">
          <div className="wrap">
            <div className="hero-copy">
              {eyebrow && (
                <span className="mono anim anim-1" style={{ color: 'var(--amber-pale)' }}>{eyebrow}</span>
              )}
              {/* The heading carries the author's line breaks; `pre-line` keeps them. */}
              {heading && (
                <h1 className="anim anim-2" style={{ marginTop: '.7rem', whiteSpace: 'pre-line' }}>{heading}</h1>
              )}
              {lede && <p className="lede anim anim-3">{lede}</p>}
              <div className="cta anim anim-4">
                {ctaLabel && ctaHref && <a className="btn btn-lg" href={ctaHref}>{ctaLabel}</a>}
                <a className="btn btn-ghost btn-lg" href="/sign-in?mode=signup">Open a demo</a>
              </div>
            </div>
            <div className="hero-visual anim anim-2">
              <img className="hero-shot" src="/hero-cad.jpg" alt="Folio workbench — Half-wave rectifier schematic with the DRC health panel and the assistant open." />
              <div className="hero-caption">Half-wave rectifier · schematic · the assistant open</div>
            </div>
          </div>
        </header>

        <div className="strip" aria-label="Disciplines">
          <div className="wrap">
            <div className="strip-grid">
              {DISCIPLINES.map((item) => (
                <div key={item.label} className={`strip-item ${item.cls}`}>
                  <b>{item.label}</b>
                  <span>{item.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <section id="product" className="site-section" aria-label="The product">
          <div className="wrap">
            <div className="section-head">
              <h2>One sheet.<br />One board.<br />One artifact.</h2>
              <p>The same component catalogue, solver and geometry serve the schematic, the PCB and the enclosure. Cross-domain edits land coherently — or they refuse and name the reason.</p>
            </div>
            <div className="product">
              <div className="product-bar"><span className="product-dot" /><span className="product-dot" /><span className="product-dot" /><span>Half-wave rectifier — Schematic · Folio</span></div>
              <div className="product-body">
                <div className="product-copy">
                  <h3>Half-wave rectifier with filter</h3>
                  <p>A real design shipped as a Folio demo — 6 Vpk 1 kHz into 10 Ω, a 1N5817 Schottky, a 10 µF filter into a 100 Ω load. Every part is simulatable and stocked, so the same sheet runs the solver, the router and the 2D/3D board.</p>
                  <ul>
                    <li><b>6 parts</b> · real IPC footprints (0805 / 1206 / SMC)</li>
                    <li><b>Transient</b> run — OUT conducts on the positive half-cycle only, peaks near 4.4 V</li>
                    <li><b>DRC-gated</b> Gerber + Excellon + centroid + BOM, CRC-verified</li>
                  </ul>
                </div>
                <div className="product-screen">
                  <svg viewBox="0 0 320 180" role="img" aria-label="Schematic fragment of the half-wave rectifier demo" style={{ width: '100%', maxWidth: '28rem', height: 'auto' }}>
                    <rect width="320" height="180" rx="8" fill="#15141A" stroke="#232430" />
                    <path d="M60 120 H140 M120 120 V60 M120 60 H250" fill="none" stroke="#F5A524" strokeWidth="1.5" />
                    <path d="M250 120 H280" fill="none" stroke="#F5A524" strokeWidth="1.5" />
                    <circle cx="140" cy="120" r="2.5" fill="#F5A524" />
                    <rect x="76" y="42" width="40" height="14" fill="#1B1A20" stroke="#F5A524" />
                    <text x="81" y="53" fill="#FFF" fontFamily="Archivo, sans-serif" fontSize="9">1N5817</text>
                    <rect x="190" y="104" width="44" height="14" fill="#1B1A20" stroke="#F5A524" />
                    <text x="196" y="115" fill="#FFF" fontFamily="Archivo, sans-serif" fontSize="9">C1 10uF</text>
                    <circle cx="280" cy="120" r="2.5" fill="#F5A524" />
                    <text x="20" y="24" fill="#A8A299" fontFamily="Archivo, sans-serif" fontSize="8">half-wave-rectifier / sheet 1</text>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="community" className="site-section" aria-label="Community">
          <div className="wrap">
            <div className="section-head">
              <h2>Proven designs.<br />Yours to make.</h2>
              <p>Community designs, ready to open, inspect, learn from and make yours.</p>
              <p style={{ marginTop: '.9rem' }}><a className="btn btn-ghost" href="/app/community">Explore designs</a></p>
            </div>
            <div className="tpl-grid">
              {TEMPLATES.map((item, index) => (
                <a key={item.title} className="tpl" href="/app/community">
                  <div className="tpl-head">
                    <span className="tpl-eyebrow">{item.eyebrow}</span>
                    <span className="tpl-index">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="tpl-art">
                    <svg viewBox="0 0 60 52" role="img" aria-label="">{item.motif}</svg>
                  </div>
                  <div className="tpl-body">
                    <h3>{item.title}</h3>
                    <p>{item.body}</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        <TestimonialsFromDb />

        <section id="faq" className="site-section" aria-label="Questions">
          <div className="wrap">
            <div className="section-head"><h2>Questions an engineer<br />actually asks.</h2></div>
            <FaqList />
          </div>
        </section>

        <section className="final-cta" aria-label="Get started">
          <div className="wrap">
            <h2>Your board is waiting.</h2>
            <p>Pick a demo, then watch it walk you through it.</p>
            <div className="cta anim anim-4" style={{ justifyContent: 'center' }}>
              <a className="btn btn-lg" href="/sign-in?mode=signup">Sign up to design</a>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <NewsletterSubscribe />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  )
}
