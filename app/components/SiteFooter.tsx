/**
 * The public site footer.
 *
 * Product name, parent company, tagline, contact address and source links come
 * from `public.site_settings`, so a self-hosted deployment shows its own
 * identity rather than the shipped one. Anything unset is omitted, not guessed.
 *
 * This is a server component: the footer is links and text with no
 * interactivity, so it renders with the page and needs no JavaScript.
 */
import { FolioLockup } from './SiteNav'
import { loadSiteSettings } from '../../src/lib/site/siteSettings'

export default async function SiteFooter() {
  const settings = await loadSiteSettings()
  const year = new Date().getFullYear()

  const social = [
    settings.githubUrl ? { label: 'GitHub', href: settings.githubUrl } : undefined,
    settings.codebergUrl ? { label: 'Codeberg', href: settings.codebergUrl } : undefined,
  ].filter((link): link is { label: string; href: string } => link !== undefined)

  return (
    <footer className="site-footer" aria-label="Site footer">
      <div className="wrap foot-wrap">
        <div>
          <a className="foot-brand" href="/" aria-label={settings.productName ? `${settings.productName} — home` : 'Home'}>
            <FolioLockup style={{ height: 14, width: 'auto', display: 'block' }} label={settings.productName} />
          </a>
          {settings.tagline && <p className="foot-tagline">{settings.tagline}</p>}
        </div>
        <div>
          <p className="foot-col-head">Product</p>
          <ul className="foot-col">
            <li><a href="/app">Workbench</a></li>
            <li><a href="/app/community">Community</a></li>
            <li><a href="/pricing">Pricing</a></li>
            <li><a href="/console">Console</a></li>
          </ul>
        </div>
        <div>
          <p className="foot-col-head">Company</p>
          <ul className="foot-col">
            <li><a href="/about">About</a></li>
            <li><a href="/security">Security</a></li>
            <li><a href="/terms">Terms</a></li>
            <li><a href="/privacy">Privacy</a></li>
          </ul>
        </div>
        {social.length > 0 && (
          <div>
            <p className="foot-col-head">Source</p>
            <ul className="foot-col">
              {social.map((link) => (
                <li key={link.href}><a href={link.href} rel="noopener noreferrer">{link.label}</a></li>
              ))}
            </ul>
          </div>
        )}
        {settings.contactEmail && (
          <div>
            <p className="foot-col-head">Contact</p>
            <ul className="foot-col">
              <li>
                <a href={`mailto:${settings.contactEmail}`}>{settings.contactEmail}</a>
              </li>
            </ul>
          </div>
        )}
      </div>
      <div className="wrap foot-bottom">
        <span>
          {settings.productName
            ? `© ${year} ${settings.productName}. All rights reserved.`
            : `© ${year}. All rights reserved.`}
        </span>
        <nav className="foot-legal" aria-label="Legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
        {settings.parentCompany && (
          <span className="foot-parent">
            {settings.productName ?? 'This product'} is a product of{' '}
            <span style={{ fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase' }}>{settings.parentCompany}.</span>
          </span>
        )}
      </div>
    </footer>
  )
}
