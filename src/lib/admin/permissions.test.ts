import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES, CAPABILITY_DEFINITIONS, ROLE_CAPABILITIES, capabilityLabel,
  capabilitiesFor, grantsFromRows, hasCapability, isConsoleRole, isOwnerOnly, orderedGrants,
} from './permissions'

/*
 * The matrix is product policy. These tests pin the two properties the console
 * and the database both rely on: every capability has exactly one definition,
 * and the owner-only boundary actually excludes administrators.
 */

describe('capability matrix', () => {
  it('describes every capability exactly once', () => {
    const ids = CAPABILITY_DEFINITIONS.map((definition) => definition.id)
    expect(ids).toEqual([...CAPABILITIES])
    expect(new Set(ids).size).toBe(ids.length)
    for (const definition of CAPABILITY_DEFINITIONS) {
      expect(definition.label.length).toBeGreaterThan(0)
      expect(definition.description.length).toBeGreaterThan(0)
    }
  })

  it('gives the owner every capability and the administrator every one except owner management', () => {
    expect([...ROLE_CAPABILITIES.owner]).toEqual([...CAPABILITIES])
    expect(ROLE_CAPABILITIES.admin).not.toContain('operators.manage_owner')
    expect(ROLE_CAPABILITIES.admin).toHaveLength(CAPABILITIES.length - 1)
    expect(ROLE_CAPABILITIES.engineer).toEqual([])
    expect(ROLE_CAPABILITIES.viewer).toEqual([])
  })

  it('answers for a role and returns nothing for an unknown subject', () => {
    expect(hasCapability('owner', 'operators.manage_owner')).toBe(true)
    expect(hasCapability('admin', 'operators.manage_owner')).toBe(false)
    expect(hasCapability('admin', 'accounts.manage')).toBe(true)
    expect(hasCapability('engineer', 'accounts.read')).toBe(false)
    expect(hasCapability('user', 'accounts.read')).toBe(false)
    expect(hasCapability(undefined, 'accounts.read')).toBe(false)
    expect(capabilitiesFor('wizard')).toEqual([])
    expect(isConsoleRole('admin')).toBe(true)
    expect(isConsoleRole('engineer')).toBe(false)
  })

  it('marks only the owner-reserved rows', () => {
    const ownerOnly = CAPABILITY_DEFINITIONS.filter((definition) => definition.ownerOnly).map((entry) => entry.id)
    expect(ownerOnly).toEqual(['operators.manage_owner'])
    expect(isOwnerOnly('operators.manage_owner')).toBe(true)
    expect(isOwnerOnly('accounts.manage')).toBe(false)
  })

  it('has a readable label for every capability', () => {
    for (const capability of CAPABILITIES) {
      expect(capabilityLabel(capability)).not.toBe(capability)
    }
  })
})

describe('server rows', () => {
  it('keeps every role column, drops unknown rows and de-duplicates', () => {
    const grants = grantsFromRows([
      { role: 'admin', capability: 'accounts.read' },
      { role: 'admin', capability: 'accounts.read' },
      { role: 'admin', capability: 'invented.capability' },
      { role: 'viewer', capability: 'usage.read' },
      { role: 'wizard', capability: 'accounts.manage' },
    ])
    expect(grants.owner).toEqual([])
    expect(grants.admin).toEqual(['accounts.read'])
    expect(grants.engineer).toEqual([])
    expect(grants.viewer).toEqual(['usage.read'])
  })

  it('orders grants by the canonical capability list, not arrival order', () => {
    expect(orderedGrants(['deployment.read', 'accounts.read', 'console.access'])).toEqual([
      'console.access', 'accounts.read', 'deployment.read',
    ])
  })
})
