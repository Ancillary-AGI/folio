/**
 * Folio pricing — one source, two consumers.
 *
 * `pricing.html` shows the storefront; the user console shows what the account
 * is entitled to. Both read from this module so a price, a name or a limit can
 * never quietly diverge between the page that sells the promise and the page
 * that enforces it. Plain data, no I/O, no environment access — it is imported
 * by the vite plugin at build time and by the app at runtime.
 *
 * Honesty rules, because marketing is where trust is made:
 * - Billing has not shipped. Prices are what Team and Pro will be billed at
 *   when it does, at which point charge starts, never retroactively.
 * - "Free" is not a trial. It is the standalone build, which cannot accept
 *   payment because it has no account to bill.
 * - Limits written here are the exact values the enforcement layer applies
 *   (`subjectLimits` in lib/admin/quotaPolicy.ts). If the policy changes, the
 *   numbers change here first, in the same commit, or the page lies.
 */

export type PricingTierId = 'free' | 'pro' | 'team' | 'enterprise'

export interface PricingTier {
  id: PricingTierId
  /** Short uppercase label shown above the price. */
  name: string
  /** One-line promise under the price. */
  tagline: string
  /** Display price for the card ("$0", "$19", "Custom"). */
  price: string
  /** Cadence rendered next to the price ("" for free, " forever", " user / mo"). */
  cadence: string
  /** Bullet list; each bullet may lead with a bolded phrase. */
  bullets: ReadonlyArray<string>
  /** Team is the tier we recommend — the one card with the amber border. */
  recommended?: boolean
  cta: { label: string; href: string; variant: 'primary' | 'ghost' }
}

export const PRICING_TIERS: ReadonlyArray<PricingTier> = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Everything, on your machine. No account, no upload, no telemetry.',
    price: '$0',
    cadence: ' forever',
    bullets: [
      '<b>Unlimited</b> projects, exports and simulations',
      '<b>28 workspaces</b> · <b>40 demos</b>',
      'Encrypted export · AES-256',
      'CC-BY community designs, free to open',
      'Offline sharing as .folio-template.json',
    ],
    cta: { label: 'Start designing', href: '/app', variant: 'primary' },
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Everything Free, plus the cloud doors.',
    price: '$19',
    cadence: ' user / mo',
    bullets: [
      '<b>Cloud sync</b> — projects follow you',
      '<b>Publish</b> your design CC-BY / CC0',
      '<b>Open</b> community designs in one click',
      'Priority simulation queue',
      'Usage ledger mirrored to your account',
    ],
    cta: { label: 'Get notified', href: 'mailto:hello@folio.dev?subject=Folio%20Pro', variant: 'ghost' },
  },
  {
    id: 'team',
    name: 'Team · recommended',
    tagline: 'Engineer quotas, operator controls and shared designs.',
    price: '$49',
    cadence: ' user / mo',
    bullets: [
      '<b>Engineer quotas</b> — 100 projects · 200 exports/d · 1,000 sims/d · 2 GB',
      'Shared team designs &amp; libraries',
      'Admin console — members, policies, audit',
      'Usage reporting &amp; export',
      'Viewer seats at reduced quota',
    ],
    recommended: true,
    cta: { label: 'Get notified', href: 'mailto:hello@folio.dev?subject=Folio%20Team', variant: 'ghost' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Private deployment, SSO, unlimited quotas, SLA.',
    price: 'Custom',
    cadence: '',
    bullets: [
      '<b>SSO / SAML</b> &amp; directory sync',
      'Private deployment — your VPC, your data',
      '<b>Unlimited</b> engineer quotas',
      'Data-residency &amp; retention controls',
      'Priority support, named engineer',
    ],
    cta: { label: 'Talk to us', href: 'mailto:founder@folio.dev?subject=Folio%20Enterprise', variant: 'ghost' },
  },
]

/** Display name used by the console and anywhere a tier must be named. */
export const PRICING_TIER_NAME: Readonly<Record<PricingTierId, string>> = Object.fromEntries(
  PRICING_TIERS.map((tier) => [tier.id, tier.name.split(' ')[0]]),
) as Record<PricingTierId, string>

export const PRICING_NOTE =
  'Pricing is announced, not charged: billing has not shipped, and Free stays free and unlimited. ' +
  'The quotas above are enforced by the app and the database today. No seat minimums on Pro. Team requires a signed agreement.'

function renderTier(tier: PricingTier): string {
  const classes = tier.recommended ? 'plan plan-highlight' : 'plan'
  const ctaClass = tier.cta.variant === 'primary' ? 'btn' : 'btn btn-ghost'
  const nameStyle = tier.recommended ? ' style="color:var(--amber)"' : ''
  const name = tier.recommended ? 'Team' : tier.name
  const items = tier.bullets.map((bullet) => `          <li>${bullet}</li>`).join('\n')
  const small = tier.cadence ? `<small>${tier.cadence}</small>` : ''
  return `      <div class="${classes}">
        <div class="plan-top"><span class="plan-name"${nameStyle}>${name}${tier.recommended ? ' · recommended' : ''}</span></div>
        <p class="plan-price">${tier.price}${small}</p>
        <p class="plan-sub">${tier.tagline}</p>
        <ul>
${items}
        </ul>
        <a class="${ctaClass}" href="${tier.cta.href}">${tier.cta.label}</a>
      </div>`
}

/** The full plans grid, rendered at build time by the vite plugin. */
export function renderPricingPlansHtml(): string {
  return PRICING_TIERS.map(renderTier).join('\n')
}
