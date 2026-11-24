/**
 * Renders one operator-owned page (about, terms, privacy, security).
 *
 * The copy is read from `legal_pages` on the server, so the page arrives with
 * its content already in the HTML — no loading flash, and it reads correctly
 * with JavaScript disabled. When the deployment has no row for this route, or no
 * database at all, the page says so rather than showing copy nobody wrote.
 */
import {
  loadLegalPage,
  type LegalPageContent,
} from '../../src/lib/legal/legalPages'
import RichText from '../../src/components/legal/RichText'

function NotFound() {
  return (
    <div className="legal-page" data-source="unconfigured">
      <div className="hero" style={{ paddingBottom: '1rem' }}>
        <p className="eyebrow">Not configured</p>
        <h1>This page has not been published yet.</h1>
        <p className="lede">
          This deployment has no copy for this page. An operator can add it from the
          admin console under Legal pages.
        </p>
      </div>
    </div>
  )
}

function Published({ page }: { page: LegalPageContent }) {
  return (
    <div className="legal-page" data-source="deployment">
      <div className="hero" style={{ paddingBottom: '1rem' }}>
        <p className="eyebrow anim anim-1">{page.eyebrow}</p>
        {/* The heading carries the author's line breaks; `pre-line` keeps them
            without trusting markup. */}
        <h1 className="anim anim-2" style={{ whiteSpace: 'pre-line' }}>{page.heading}</h1>
        {page.lede && <p className="lede anim anim-3">{page.lede}</p>}
      </div>

      {page.sections.map((section, index) => (
        <section
          className="block"
          key={`${index}-${section.heading}`}
          aria-label={section.heading}
        >
          <h2>{section.heading}</h2>
          <RichText blocks={section.body} />
        </section>
      ))}
    </div>
  )
}

export default async function LegalPage({ slug }: { slug: Parameters<typeof loadLegalPage>[0] }) {
  const page = await loadLegalPage(slug)
  return page ? <Published page={page} /> : <NotFound />
}