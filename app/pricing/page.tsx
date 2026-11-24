import type { Metadata } from 'next'
import SiteNav from '../components/SiteNav'
import SiteFooter from '../components/SiteFooter'
import FaqList from '../components/FaqList'
import { getPricingTiers, PRICING_NOTE } from '../../src/lib/pricing'
import { contactHref, loadSiteSettings } from '../../src/lib/site/siteSettings'

export async function generateMetadata(): Promise<Metadata> {
  const settings = await loadSiteSettings()
  const name = settings.productName
  return {
    title: 'Pricing',
    description: name
      ? `${name}, stated plainly. Free is forever and unlimited on your machine. Pro and Team add the cloud doors: hosted storage, publishing, the admin console. Billing has not shipped; prices are what it will charge.`
      : 'Free is forever and unlimited on your machine. Pro and Team add the cloud doors: hosted storage, publishing, the admin console. Billing has not shipped; prices are what it will charge.',
    alternates: { canonical: '/pricing' },
  }
}

export default async function PricingPage() {
  // The enterprise call-to-action needs the deployment's own contact address,
  // which is data, not code.
  const settings = await loadSiteSettings()
  const tiers = getPricingTiers(contactHref(settings) ?? '')

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <SiteNav current="pricing" />

      <main id="main">
        <section className="hero" style={{ padding: '4.5rem 0 2rem' }}>
          <div className="wrap">
            <p className="eyebrow anim anim-1">Pricing</p>
            <h1 className="anim anim-2" style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', lineHeight: 1.08, letterSpacing: '-0.03em' }}>Free forever on your machine.<br />Fair when you scale.</h1>
            <p className="lede anim anim-3">
              Free is real and unlimited today — no account, no upload, no telemetry.
              Pro and Team add the cloud doors: hosted storage, community publishing, engineer quotas, the admin console.
              Billing has not shipped yet; when it does, this page is the storefront and charge starts, never retroactively.
            </p>
          </div>
        </section>

        <section aria-label="Plans" style={{ padding: '0 0 3rem' }}>
          <div className="wrap">
            <div className="plans">
              {tiers.map((tier) => {
                const name = tier.recommended ? 'Team' : tier.name
                return (
                  <div key={tier.id} className={tier.recommended ? 'plan plan-highlight' : 'plan'}>
                    <div className="plan-top">
                      <span className="plan-name" style={tier.recommended ? { color: 'var(--amber)' } : undefined}>
                        {name}{tier.recommended ? ' · recommended' : ''}
                      </span>
                    </div>
                    <div className="plan-price">
                      {tier.price}
                      {tier.cadence && <small>{tier.cadence}</small>}
                    </div>
                    <p className="plan-sub">{tier.tagline}</p>
                    <ul>
                      {tier.bullets.map((bullet, index) => (
                        <li key={index}>
                          {bullet.parts.map((part, partIndex) => (
                            part.strong
                              ? <strong key={partIndex}>{part.text}</strong>
                              : part.text
                          ))}
                        </li>
                      ))}
                    </ul>
                    <a className={tier.cta.variant === 'primary' ? 'btn' : 'btn btn-ghost'} href={tier.cta.href}>
                      {tier.cta.label}
                    </a>
                  </div>
                )
              })}
            </div>
            <p className="pricing-note">{PRICING_NOTE}</p>
          </div>
        </section>

        <section id="faq" className="faq-block" aria-label="Questions">
          <div className="wrap">
            <h2>Questions an engineer asks first</h2>
            <FaqList surface="pricing" />
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  )
}
