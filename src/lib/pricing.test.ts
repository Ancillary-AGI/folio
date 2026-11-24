import { describe, expect, it } from 'vitest'
import { getPricingTiers, PRICING_NOTE } from './pricing'

/*
 * The storefront used to hold bullet HTML and inject it with
 * dangerouslySetInnerHTML. These tests pin the replacement: bullets are data,
 * and a contact address is the only deployment value that changes a CTA.
 */

describe('getPricingTiers', () => {
  it('returns structured bullets with no markup in their text', () => {
    const tiers = getPricingTiers('mailto:team@example.com')

    expect(tiers.length).toBeGreaterThan(0)
    for (const tier of tiers) {
      for (const bullet of tier.bullets) {
        expect(bullet.parts.length).toBeGreaterThan(0)
        for (const part of bullet.parts) {
          expect(part.text).not.toMatch(/<[^>]+>/)
        }
      }
    }
  })

  it('uses the deployment contact for the paid tier calls to action', () => {
    const tiers = getPricingTiers('mailto:team@example.com')
    const pro = tiers.find((tier) => tier.id === 'pro')
    const enterprise = tiers.find((tier) => tier.id === 'enterprise')

    expect(pro?.cta.href).toBe('mailto:team@example.com?subject=Pro')
    expect(enterprise?.cta.href).toBe('mailto:team@example.com?subject=Enterprise')
  })

  it('sends a deployment without a contact to sign-in instead of inventing one', () => {
    const tiers = getPricingTiers('')
    const pro = tiers.find((tier) => tier.id === 'pro')

    expect(pro?.cta.href).toBe('/sign-in')
    expect(pro?.cta.label).toBe('See the deployment')
  })

  it('says billing has not shipped', () => {
    expect(PRICING_NOTE).toMatch(/billing has not shipped/i)
  })
})
