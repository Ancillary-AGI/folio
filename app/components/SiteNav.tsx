import type { CSSProperties } from 'react'
import { loadSiteSettings } from '../../src/lib/site/siteSettings'

const MARK =
  'M10 0H58L96 38V86L86 96H10L0 86V10ZM26 20H64L70 26V40H46V46H56L62 52V64H46V82H26Z'
const WORDMARK_PATHS = [
  'M0 0H57L66 9V22H22V39H49L58 48V61H22V100H0Z',
  'M102 0H162L174 12V88L162 100H102L90 88V12ZM115 22H149L152 25V75L149 78H115L112 75V25Z',
  'M198 0H220V78H262V90L252 100H198Z',
  'M284 0H294L300 6V94L294 100H284L278 94V6Z',
  'M336 0H396L408 12V88L396 100H336L324 88V12ZM349 22H383L386 25V75L383 78H349L346 75V25Z',
] as const

/**
 * The outlined lockup is an asset, not a data field. It keeps the mark's
 * geometry; `label` comes from site settings so the accessible name matches
 * the deployment the operator configured.
 */
export function FolioLockup({ style, label }: { style?: CSSProperties; label?: string }) {
  return (
    <svg viewBox="0 0 408 100" style={style} role="img" aria-label={label || 'FOLIO'}>
      {WORDMARK_PATHS.map((d, index) => (
        <path
          key={index}
          fill="#F2ECDF"
          fillRule={index === 1 || index === 4 ? 'evenodd' : undefined}
          d={d}
        />
      ))}
    </svg>
  )
}

export function FolioMark({ style }: { style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 96 96" style={style} aria-hidden="true">
      <path fill="#F5A524" fillRule="evenodd" d={MARK} />
    </svg>
  )
}

export default async function SiteNav({ current }: { current?: string }) {
  const settings = await loadSiteSettings()
  const productName = settings.productName
  const is = (id: string) => (current === id ? ('page' as const) : undefined)
  return (
    <nav className="site-nav" aria-label={productName ? `${productName} site` : 'Site'}>
      <div className="wrap">
        <a className="brand" href="/" aria-label={productName ? `${productName} — home` : 'Home'}>
          <FolioMark style={{ height: 24, width: 'auto' }} />
          <FolioLockup style={{ height: 15, width: 'auto' }} label={productName} />
        </a>
        <ul className="nav-links">
          <li><a href="/#product">Product</a></li>
          <li><a href="/pricing" aria-current={is('pricing')}>Pricing</a></li>
          <li><a href="/app/community">Community</a></li>
          <li><a href="/console">Console</a></li>
        </ul>
        <div className="nav-actions">
          <a className="btn btn-ghost" href="/sign-in">Sign in</a>
          <a className="btn" href="/sign-in?mode=signup">Sign up</a>
        </div>
      </div>
    </nav>
  )
}
