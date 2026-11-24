/**
 * Folio pricing — one source, two consumers.
 *
 * The `/pricing` route shows the storefront; the user console shows what the
 * account is entitled to. Both read from this module so a price, a name or a
 * limit can never quietly diverge between the page that sells the promise and
 * the page that enforces it. Plain data, no I/O, no environment access — it is
 * imported by a server component at build time and by the app at runtime.
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

/**
 * A bullet is structured text, not markup. The storefront renders `<strong>`
 * around a flagged span; nothing on the public path injects HTML.
 */
export interface PricingBulletPart {
  text: string
  strong?: true
}

export interface PricingBullet {
  parts: ReadonlyArray<PricingBulletPart>
}

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
  /** Bullet list; a span may be bolded without storing markup. */
  bullets: ReadonlyArray<PricingBullet>
  /** Team is the tier we recommend — the one card with the amber border. */
  recommended?: boolean
  cta: { label: string; href: string; variant: 'primary' | 'ghost' }
}

/**
 * The plans.
 *
 * The contact address in the enterprise call-to-action is deployment data, so
 * it is passed in rather than baked here; pass `''` and the button is omitted.
 */
export function getPricingTiers(contactHref: string): ReadonlyArray<PricingTier> {
  return [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Everything, on your machine. No account, no upload, no telemetry.',
    price: '$0',
    cadence: ' forever',
    bullets: [
      { parts: [{ text: 'Unlimited', strong: true }, { text: ' projects, exports and simulations' }] },
      { parts: [{ text: '28 workspaces', strong: true }, { text: ' · ' }, { text: '40 demos', strong: true }] },
      { parts: [{ text: 'Encrypted export · AES-256' }] },
      { parts: [{ text: 'Community designs, free to open' }] },
      { parts: [{ text: 'Offline sharing as .folio-template.json' }] },
    ],
    cta: { label: 'Sign up to design', href: '/sign-in?mode=signup', variant: 'primary' },
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Everything Free, plus the cloud doors.',
    price: '$19',
    cadence: ' user / mo',
    bullets: [
      { parts: [{ text: 'Cloud sync', strong: true }, { text: ' — projects follow you' }] },
      { parts: [{ text: 'Publish', strong: true }, { text: ' your design to the community' }] },
      { parts: [{ text: 'Open', strong: true }, { text: ' community designs in one click' }] },
      { parts: [{ text: 'Priority simulation queue' }] },
      { parts: [{ text: 'Usage ledger mirrored to your account' }] },
    ],
    cta: contactHref
      ? { label: 'Get notified', href: `${contactHref}?subject=Pro`, variant: 'ghost' }
      : { label: 'See the deployment', href: '/sign-in', variant: 'ghost' },
  },
  {
    id: 'team',
    name: 'Team · recommended',
    tagline: 'Engineer quotas, operator controls and shared designs.',
    price: '$49',
    cadence: ' user / mo',
    bullets: [
      { parts: [{ text: 'Engineer quotas', strong: true }, { text: ' — 100 projects · 200 exports/d · 1,000 sims/d · 2 GB' }] },
      { parts: [{ text: 'Shared team designs & libraries' }] },
      { parts: [{ text: 'Admin console — members, policies, audit' }] },
      { parts: [{ text: 'Usage reporting & export' }] },
      { parts: [{ text: 'Viewer seats at reduced quota' }] },
    ],
    recommended: true,
    cta: contactHref
      ? { label: 'Get notified', href: `${contactHref}?subject=Folio%20Pro`, variant: 'ghost' }
      : { label: 'See the deployment', href: '/sign-in', variant: 'ghost' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    tagline: 'Private deployment, SSO, unlimited quotas, SLA.',
    price: 'Custom',
    cadence: '',
    bullets: [
      { parts: [{ text: 'SSO / SAML', strong: true }, { text: ' & directory sync' }] },
      { parts: [{ text: 'Private deployment — your VPC, your data' }] },
      { parts: [{ text: 'Unlimited', strong: true }, { text: ' engineer quotas' }] },
      { parts: [{ text: 'Data-residency & retention controls' }] },
      { parts: [{ text: 'Priority support, named engineer' }] },
    ],
    cta: contactHref
      ? { label: 'Talk to us', href: `${contactHref}?subject=Enterprise`, variant: 'ghost' }
      : { label: 'See the deployment', href: '/sign-in', variant: 'ghost' },
  },
  ]
}

/** Display name used by the console and anywhere a tier must be named. */
export const PRICING_TIER_NAME: Readonly<Record<PricingTierId, string>> = Object.fromEntries(
  getPricingTiers('').map((tier) => [tier.id, tier.name.split(' ')[0]]),
) as Record<PricingTierId, string>

export const PRICING_NOTE =
  'Pricing is announced, not charged: billing has not shipped, and Free stays free and unlimited. ' +
  'The quotas above are enforced by the app and the database today. No seat minimums on Pro. Team requires a signed agreement.'
