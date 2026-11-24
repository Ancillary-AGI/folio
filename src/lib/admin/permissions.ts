/**
 * Console capabilities and the role matrix that grants them.
 *
 * This is the console's half of the permission model. The other half is in the
 * database: `public.role_capabilities` stores the same grants, and
 * `public.has_capability()` is what the profile guard calls before it lets an
 * end-user session change a role or status. Keeping the matrix here lets the
 * UI explain itself without a round trip and lets the service refuse a call it
 * already knows cannot succeed; the database remains the boundary, so a stale
 * browser cannot grant itself anything.
 *
 * Roles are product-defined, not customer-defined: an owner cannot edit the
 * matrix from the console, because a role that can revoke its own ability to
 * administer is a way to lock a deployment out. The editable axis is who holds
 * which role (`profiles.role`), and that change is audited.
 */
import { ADMIN_ROLES, type AdminRole } from './quotaPolicy'

export const CAPABILITIES = [
  'console.access',
  'accounts.read',
  'accounts.manage',
  'operators.manage_owner',
  'usage.read',
  'quotas.read',
  'quotas.manage',
  'audit.read',
  'audit.write',
  'content.manage',
  'newsletter.read',
  'newsletter.manage',
  'newsletter.send',
  'deployment.read',
  'data.export',
] as const

export type Capability = (typeof CAPABILITIES)[number]

export interface CapabilityDefinition {
  id: Capability
  label: string
  description: string
  /** The capability is reserved to the owner role by design. */
  ownerOnly?: boolean
}

/** One ordered source for the IAM table, the service guard and the docs. */
export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = Object.freeze([
  {
    id: 'console.access',
    label: 'Open the console',
    description: 'Sign in to the operator console and read its sections.',
  },
  {
    id: 'accounts.read',
    label: 'Read the directory',
    description: 'See accounts, their role, status and last recorded activity.',
  },
  {
    id: 'accounts.manage',
    label: 'Manage accounts',
    description: 'Change a non-owner role or suspend and restore an account.',
  },
  {
    id: 'operators.manage_owner',
    label: 'Manage owners',
    description: 'Grant the owner role, and change or remove an existing owner.',
    ownerOnly: true,
  },
  {
    id: 'usage.read',
    label: 'Read usage',
    description: 'Read the deployment usage ledger and its per-account rollups.',
  },
  {
    id: 'quotas.read',
    label: 'Read quotas',
    description: 'See the quota policy each role is held to.',
  },
  {
    id: 'quotas.manage',
    label: 'Edit quotas',
    description: 'Change the engineer and viewer limits stored in quota_policies.',
  },
  {
    id: 'audit.read',
    label: 'Read the audit trail',
    description: 'Read the append-only record of operator actions.',
  },
  {
    id: 'audit.write',
    label: 'Write the audit trail',
    description: 'Append the operator actions this console performs.',
  },
  {
    id: 'content.manage',
    label: 'Manage site content',
    description: 'Edit the FAQ, legal pages, site identity and testimonials shown on the public site.',
  },
  {
    id: 'newsletter.read',
    label: 'Read the newsletter',
    description: 'See subscribers, campaigns and their delivery counters.',
  },
  {
    id: 'newsletter.manage',
    label: 'Manage the newsletter',
    description: 'Create and delete campaigns, and remove subscribers.',
  },
  {
    id: 'newsletter.send',
    label: 'Send the newsletter',
    description: 'Start a campaign drain through the deployment SMTP transport.',
  },
  {
    id: 'deployment.read',
    label: 'Read deployment totals',
    description: 'Read deployment-wide aggregates through admin_deployment_stats.',
  },
  {
    id: 'data.export',
    label: 'Export data',
    description: 'Download the visible usage, account and audit rows as CSV.',
  },
])

const ALL: readonly Capability[] = CAPABILITIES

/**
 * The built-in roles. Owner and administrator are the only operator roles; the
 * workbench roles are listed with no console capability so the matrix is
 * explicit instead of implying that an engineer can open the console.
 */
export const ROLE_CAPABILITIES: Readonly<Record<AdminRole, readonly Capability[]>> = Object.freeze({
  owner: ALL,
  admin: ALL.filter((capability) => capability !== 'operators.manage_owner'),
  engineer: Object.freeze([]),
  viewer: Object.freeze([]),
})

const CAPABILITY_SET = new Set<string>(CAPABILITIES)
const ROLE_SET = new Set<string>(ADMIN_ROLES)

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && CAPABILITY_SET.has(value)
}

export function isConsoleRole(value: unknown): value is 'owner' | 'admin' {
  return value === 'owner' || value === 'admin'
}

/** The grants for a role, or none for an unknown/unassigned subject. */
export function capabilitiesFor(role: string | null | undefined): readonly Capability[] {
  if (typeof role !== 'string' || !ROLE_SET.has(role)) return []
  return ROLE_CAPABILITIES[role as AdminRole]
}

export function hasCapability(role: string | null | undefined, capability: Capability): boolean {
  return capabilitiesFor(role).includes(capability)
}

export function capabilityLabel(capability: Capability): string {
  return CAPABILITY_DEFINITIONS.find((entry) => entry.id === capability)?.label ?? capability
}

/** Owner-only rows are marked in the matrix and checked by the service guard. */
export function isOwnerOnly(capability: Capability): boolean {
  return CAPABILITY_DEFINITIONS.find((entry) => entry.id === capability)?.ownerOnly === true
}

export interface RoleGrantSummary {
  role: AdminRole
  grants: readonly Capability[]
  /** True when the server's role_capabilities table answered the question. */
  fromServer: boolean
}

/**
 * Merge the server's rows into a complete role model. A role with no rows is
 * kept empty — a role is allowed to hold nothing — but a missing role in the
 * response is filled from the built-in matrix so the UI still has every column.
 */
export function grantsFromRows(
  rows: ReadonlyArray<{ role: unknown; capability: unknown }>,
): Record<AdminRole, Capability[]> {
  const result = {} as Record<AdminRole, Capability[]>
  for (const role of ADMIN_ROLES) result[role] = []
  for (const row of rows) {
    if (typeof row.role !== 'string' || !ROLE_SET.has(row.role)) continue
    if (!isCapability(row.capability)) continue
    const role = row.role as AdminRole
    if (!result[role].includes(row.capability)) result[role].push(row.capability)
  }
  return result
}

/** Stable display order: the capability list, not the order rows arrived in. */
export function orderedGrants(grants: readonly Capability[]): Capability[] {
  return CAPABILITIES.filter((capability) => grants.includes(capability))
}
