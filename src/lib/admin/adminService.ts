/**
 * Deployment data for the operator console.
 *
 * Every read here goes to the managed deployment through the console's own
 * client, and every table is restricted to operators by row-level security —
 * so a refused client is refused by the database, not just by this screen.
 * There is no local mode: a browser with no deployment behind it has no
 * accounts to manage, and inventing a directory for it would be a lie.
 *
 * Writes are audited in `admin_audit` as part of the same call. If the audit
 * append fails after a mutation succeeded, the result says so rather than
 * reporting a clean change that left no record.
 */
import { cloudConfig } from '../cloudConfig'
import {
  ADMIN_ROLES, DEFAULT_QUOTA_POLICIES, ROLE_LABELS, isAdminRole, validateQuotaLimits,
  type AdminRole, type QuotaLimits,
} from './quotaPolicy'
import {
  ROLE_CAPABILITIES, capabilityLabel, grantsFromRows, hasCapability, orderedGrants,
  type Capability,
} from './permissions'
import type { Operator } from './operatorSession'
import { USAGE_KINDS, type UsageEvent, type UsageKind } from './usageLedger'
import type { Store } from '../db/store'
import {
  LEGAL_PAGE_SLUGS, parseLegalPageSections, type LegalPageSection, type LegalPageSlug,
} from '../legal/legalPages'
import { normalizeRichText, richTextHasText, richTextLength } from '../legal/richText'
import { isFaqSurface, type FaqSurface } from '../content/faq'
import { parseSiteSettings, siteTarget, type SiteSettings } from '../site/siteSettings'

export type AccountStatus = 'active' | 'suspended'

export interface Account {
  id: string
  name: string
  email: string
  role: AdminRole | 'user'
  status: AccountStatus
  lastSeenAt?: number
  createdAt?: number
}

export interface AuditEntry {
  id: string
  at: number
  actor: string
  action: string
  resource: string
  details: Record<string, unknown>
}

export interface DeploymentStats {
  projects: number
  projectsByRole: Record<string, number>
  accounts: number
  activeAccounts: number
  suspendedAccounts: number
  operatorAccounts: number
  usageEvents: number
  auditEvents: number
  exportsToday: number
  simulationsToday: number
}

export interface DeploymentInfo {
  host: string
  agentRunnerConfigured: boolean
  stats: DeploymentStats | null
  /** Why the aggregate read failed, when it did. */
  statsError?: string
}

/**
 * The capability grants the console is working from. `server` means the rows
 * came from `role_capabilities`; `built-in` means that read failed and the
 * shipped matrix is being shown with the error attached, never as if it were
 * the deployment's answer.
 */
export interface AccessModel {
  grants: Record<AdminRole, Capability[]>
  source: 'server' | 'built-in'
  error?: string
}

export interface MutationResult {
  ok: boolean
  error?: string
  /** The change landed but its audit row did not. */
  warning?: string
}

/** The deployment keeps the newest rows; a window larger than this is stated, not implied. */
export const USAGE_ROW_LIMIT = 10000

const ROLE_SET = new Set<string>(ADMIN_ROLES)
const KIND_SET = new Set<string>(USAGE_KINDS)

function builtInAccess(): Record<AdminRole, Capability[]> {
  const grants = {} as Record<AdminRole, Capability[]>
  for (const role of ADMIN_ROLES) grants[role] = orderedGrants(ROLE_CAPABILITIES[role])
  return grants
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeRole(value: unknown): AdminRole | 'user' {
  return typeof value === 'string' && ROLE_SET.has(value) ? (value as AdminRole) : 'user'
}

function normalizeStatus(value: unknown): AccountStatus {
  return value === 'suspended' ? 'suspended' : 'active'
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export interface FaqEntry {
  id: string
  /** Which public page shows the entry. */
  surface: FaqSurface
  question: string
  answer: string
  position: number
  published: boolean
  updatedAt: number
}

/**
 * One operator-editable page from `public.legal_pages`.
 *
 * `slug` is the primary key and the public route segment — `about` is served at
 * `/about` — so it is fixed once a page exists. `sections` is the same shape the
 * public renderer reads, which is what keeps the console and the site agreeing
 * about what a page contains.
 */
export interface LegalPageEntry {
  slug: LegalPageSlug
  title: string
  eyebrow: string
  heading: string
  lede: string
  sections: LegalPageSection[]
  updatedAt: number
}

/** The one row of public-shell identity, plus the row's last edit time. */
export interface SiteSettingsEntry extends SiteSettings {
  updatedAt: number
}

export interface NewsletterCampaign {
  id: string
  name: string
  subject: string
  status: 'draft' | 'sending' | 'sent' | 'failed'
  recipients: number
  delivered: number
  failed: number
  createdAt: number
  sentAt: number | null
  lastError: string | null
}

export interface TestimonialEntry {
  id: string
  quote: string
  author: string
  role: string
  company: string
  position: number
  published: boolean
  updatedAt: number
}

export interface NewsletterSubscriber {
  id: string
  email: string
  displayName: string
  subscribedAt: number
  lastSentAt: number | null
  unsubscribedAt: number | null
}

export interface NewsletterStatus {
  campaigns: NewsletterCampaign[]
  /** Zero-or-one row, present only when a campaign id was requested. */
  campaign?: NewsletterCampaign | null
  drain: { pending: number; delivered: number; failed: number; total: number } | null
  /** What the server actually knows about SMTP: configured or missing. */
  transport: 'configured' | 'missing'
  error?: string
}

export interface AdminApi {
  listAccounts(): Promise<{ accounts: Account[]; error?: string }>
  loadAccessModel(): Promise<AccessModel>
  setRole(accountId: string, role: AdminRole): Promise<MutationResult>
  setStatus(accountId: string, status: AccountStatus): Promise<MutationResult>
  loadUsage(days: number): Promise<{ events: UsageEvent[]; truncated: boolean; error?: string }>
  loadPolicies(): Promise<{ policies: Record<AdminRole, QuotaLimits>; error?: string }>
  savePolicy(role: AdminRole, limits: QuotaLimits): Promise<MutationResult>
  loadAudit(limit?: number): Promise<{ entries: AuditEntry[]; error?: string }>
  loadDeployment(): Promise<DeploymentInfo>
  recordOpen(): Promise<void>
  listFaq(): Promise<{ entries: FaqEntry[]; error?: string }>
  saveFaq(entry: Omit<FaqEntry, 'id' | 'updatedAt'> & { id?: string }): Promise<MutationResult>
  deleteFaq(id: string): Promise<MutationResult>
  listLegalPages(): Promise<{ entries: LegalPageEntry[]; error?: string }>
  saveLegalPage(entry: Omit<LegalPageEntry, 'updatedAt'>): Promise<MutationResult>
  loadSiteSettings(): Promise<{ settings: SiteSettingsEntry | null; error?: string }>
  saveSiteSettings(settings: SiteSettings): Promise<MutationResult>
  listNewsletterCampaigns(): Promise<NewsletterStatus>
  listTestimonials(): Promise<{ entries: TestimonialEntry[]; error?: string }>
  saveTestimonial(entry: Omit<TestimonialEntry, 'id' | 'updatedAt'> & { id?: string }): Promise<MutationResult>
  deleteTestimonial(id: string): Promise<MutationResult>
  listNewsletterSubscribers(): Promise<{ subscribers: NewsletterSubscriber[]; error?: string }>
  removeNewsletterSubscriber(id: string): Promise<MutationResult>
  createNewsletterCampaign(draft: { name: string; subject: string; body: string }): Promise<{ ok: boolean; campaign?: NewsletterCampaign; warning?: string; error?: string }>
  sendNewsletterCampaign(id: string): Promise<{ ok: boolean; warning?: string; error?: string }>
  deleteNewsletterCampaign(id: string): Promise<MutationResult>
}

export function createAdminApi(db: Store, operator: Operator): AdminApi {
  /**
   * The console's pre-flight. It does not replace row-level security or the
   * profile guard; it stops a call that this console already knows it cannot
   * make, with a sentence an operator can act on instead of a database error.
   */
  const allowed = (capability: Capability): boolean => hasCapability(operator.role, capability)
  const denial = (capability: Capability): string =>
    `This account (${ROLE_LABELS[operator.role]}) does not hold the "${capabilityLabel(capability)}" capability, so the deployment was not asked to make the change.`
  const denied = (capability: Capability): MutationResult => ({ ok: false, error: denial(capability) })

  /** Append one operator action. Returns the failure text, or null when recorded. */
  const audit = async (
    action: string,
    resource: string,
    details: Record<string, unknown> = {},
  ): Promise<string | null> => {
    try {
      const { error } = await db.from('admin_audit').insert({
        actor_id: operator.id,
        action,
        resource,
        details,
      })
      return error ? error.message : null
    } catch (error) {
      return describe(error)
    }
  }

  const audited = (warning: string | null, action: string): MutationResult =>
    warning === null
      ? { ok: true }
      : { ok: true, warning: `The ${action} was saved, but the audit trail did not accept the row: ${warning}` }

  const newsletterToken = async (): Promise<string | null> => {
    /* The operator client stores the legacy access token directly in
     * localStorage['folio.operator.session']; ask supabase-js first, but
     * fall back to parsing the raw storage entry because deployments
     * differ in which shape they wrote. */
    try {
      const { data } = await db.auth.getSession()
      const viaClient = data.session?.access_token
      if (viaClient) return viaClient
    } catch {
      /* fall through to the raw read below */
    }
    try {
      const raw = window.localStorage.getItem('folio.operator.session')
      if (!raw) return null
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const token = typeof parsed.access_token === 'string' ? parsed.access_token : null
      return token
    } catch {
      return null
    }
  }

  const newsletterTransport = async (): Promise<'configured' | 'missing'> => {
    try {
      const base = cloudConfig.url
      if (!base) return 'missing'
      const token = await newsletterToken()
      const res = await fetch(`${base.replace(/\/+$/, '')}/admin/newsletter/status`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      })
      const body = (await res.json().catch(() => null)) as { transport?: unknown } | null
      return res.ok && body?.transport === 'configured' ? 'configured' : 'missing'
    } catch {
      return 'missing'
    }
  }

  return {
    async loadAccessModel() {
      const fallback = builtInAccess()
      try {
        const { data, error } = await db
          .from('role_capabilities')
          .select('role,capability')
        if (error) return { grants: fallback, source: 'built-in' as const, error: error.message }
        const rows = (data ?? []).map((raw) => {
          const row = raw as Record<string, unknown>
          return { role: row.role, capability: row.capability }
        })
        return { grants: grantsFromRows(rows), source: 'server' as const }
      } catch (error) {
        return { grants: fallback, source: 'built-in' as const, error: describe(error) }
      }
    },

    async listAccounts() {
      if (!allowed('accounts.read')) return { accounts: [], error: denial('accounts.read') }
      try {
        const { data, error } = await db
          .from('profiles')
          .select('id,email,display_name,role,status,last_seen_at,created_at')
          .order('created_at', { ascending: true })
          .limit(500)
        if (error) return { accounts: [], error: error.message }
        const accounts = (data ?? []).map((raw) => {
          const row = raw as Record<string, unknown>
          const lastSeenAt = timestamp(row.last_seen_at)
          const createdAt = timestamp(row.created_at)
          return {
            id: String(row.id ?? ''),
            name: String(row.display_name || row.email || 'Unnamed account'),
            email: String(row.email ?? ''),
            role: normalizeRole(row.role),
            status: normalizeStatus(row.status),
            ...(lastSeenAt === undefined ? {} : { lastSeenAt }),
            ...(createdAt === undefined ? {} : { createdAt }),
          }
        }).filter((account) => account.id.length > 0)
        return { accounts }
      } catch (error) {
        return { accounts: [], error: describe(error) }
      }
    },

    async setRole(accountId, role) {
      if (!allowed('accounts.manage')) return denied('accounts.manage')
      if (!ROLE_SET.has(role)) return { ok: false, error: 'Unknown role.' }
      if (role === 'owner' && !allowed('operators.manage_owner')) return denied('operators.manage_owner')
      if (accountId === operator.id && !isAdminRole(role)) {
        return { ok: false, error: 'You cannot remove your own operator access. Ask another owner to change it.' }
      }
      try {
        const { error } = await db.from('profiles').update({ role }).eq('id', accountId)
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:role_change', accountId, { role }), 'role change')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async setStatus(accountId, status) {
      if (!allowed('accounts.manage')) return denied('accounts.manage')
      if (accountId === operator.id && status === 'suspended') {
        return { ok: false, error: 'You cannot suspend the account you are operating with.' }
      }
      try {
        const { error } = await db.from('profiles').update({ status }).eq('id', accountId)
        if (error) return { ok: false, error: error.message }
        return audited(
          await audit(status === 'suspended' ? 'admin:account_suspended' : 'admin:account_restored', accountId, {}),
          'status change',
        )
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async loadUsage(days) {
      if (!allowed('usage.read')) return { events: [], truncated: false, error: denial('usage.read') }
      const window = Math.max(1, Math.floor(days))
      const since = new Date(Date.now() - window * 24 * 3600 * 1000).toISOString()
      try {
        const { data, error } = await db
          .from('usage_events')
          .select('id,user_id,kind,detail,created_at')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(USAGE_ROW_LIMIT)
        if (error) return { events: [], truncated: false, error: error.message }
        const rows = data ?? []
        const events: UsageEvent[] = []
        for (const raw of rows) {
          const row = raw as Record<string, unknown>
          const at = timestamp(row.created_at)
          const kind = String(row.kind ?? '')
          if (at === undefined || !KIND_SET.has(kind)) continue
          const detail = row.detail
          events.push({
            id: String(row.id ?? `${row.user_id}-${at}`),
            at,
            user: String(row.user_id ?? ''),
            kind: kind as UsageKind,
            ...(detail && typeof detail === 'object' && !Array.isArray(detail)
              ? { detail: detail as UsageEvent['detail'] }
              : {}),
          })
        }
        return { events, truncated: rows.length >= USAGE_ROW_LIMIT }
      } catch (error) {
        return { events: [], truncated: false, error: describe(error) }
      }
    },

    async loadPolicies() {
      const policies = {} as Record<AdminRole, QuotaLimits>
      for (const role of ADMIN_ROLES) policies[role] = { ...DEFAULT_QUOTA_POLICIES[role] }
      if (!allowed('quotas.read')) return { policies, error: denial('quotas.read') }
      try {
        const { data, error } = await db
          .from('quota_policies')
          .select('role,max_projects,max_exports_per_day,max_simulations_per_day,max_storage_mb')
        if (error) return { policies, error: error.message }
        for (const raw of data ?? []) {
          const row = raw as Record<string, unknown>
          if (typeof row.role !== 'string' || !ROLE_SET.has(row.role)) continue
          const role = row.role as AdminRole
          const fallback = policies[role]
          // `max_storage_mb` is a numeric column, so it can arrive as a string.
          const pick = (value: unknown, replacement: number | null): number | null => {
            if (value === null) return null
            const numeric = typeof value === 'number' ? value : Number(value)
            return Number.isFinite(numeric) && numeric >= 0 ? numeric : replacement
          }
          policies[role] = {
            maxProjects: pick(row.max_projects, fallback.maxProjects),
            maxExportsPerDay: pick(row.max_exports_per_day, fallback.maxExportsPerDay),
            maxSimulationsPerDay: pick(row.max_simulations_per_day, fallback.maxSimulationsPerDay),
            maxStorageMb: pick(row.max_storage_mb, fallback.maxStorageMb),
          }
        }
        return { policies }
      } catch (error) {
        return { policies, error: describe(error) }
      }
    },

    async savePolicy(role, limits) {
      if (!allowed('quotas.manage')) return denied('quotas.manage')
      if (role === 'owner' || role === 'admin') {
        return { ok: false, error: 'Owner and administrator limits are fixed at unlimited.' }
      }
      const invalid = validateQuotaLimits(limits)
      if (invalid) return { ok: false, error: invalid }
      try {
        const { error } = await db.from('quota_policies').upsert({
          role,
          max_projects: limits.maxProjects,
          max_exports_per_day: limits.maxExportsPerDay,
          max_simulations_per_day: limits.maxSimulationsPerDay,
          max_storage_mb: limits.maxStorageMb,
          updated_by: operator.id,
          updated_at: new Date().toISOString(),
        })
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:quota_policy', role, { ...limits }), 'policy')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async loadAudit(limit = 200) {
      if (!allowed('audit.read')) return { entries: [], error: denial('audit.read') }
      try {
        const { data, error } = await db
          .from('admin_audit')
          .select('id,actor_id,action,resource,details,created_at')
          .order('created_at', { ascending: false })
          .limit(Math.max(1, Math.floor(limit)))
        if (error) return { entries: [], error: error.message }
        const entries = (data ?? []).map((raw) => {
          const row = raw as Record<string, unknown>
          const details = row.details
          return {
            id: String(row.id ?? ''),
            at: timestamp(row.created_at) ?? 0,
            actor: String(row.actor_id ?? ''),
            action: String(row.action ?? ''),
            resource: String(row.resource ?? ''),
            details: details && typeof details === 'object' && !Array.isArray(details)
              ? details as Record<string, unknown>
              : {},
          }
        }).filter((entry) => entry.id.length > 0)
        return { entries }
      } catch (error) {
        return { entries: [], error: describe(error) }
      }
    },

    async loadDeployment() {
      const info: DeploymentInfo = {
        host: cloudConfig.host,
        agentRunnerConfigured: cloudConfig.agentRunnerConfigured,
        stats: null,
      }
      if (!allowed('deployment.read')) return { ...info, statsError: denial('deployment.read') }
      try {
        const { data, error } = await db.rpc('admin_deployment_stats')
        if (error) return { ...info, statsError: error.message }
        if (!data || typeof data !== 'object') {
          return { ...info, statsError: 'The deployment returned no statistics. Apply the operator console migration.' }
        }
        const row = data as Record<string, unknown>
        const byRole = row.projectsByRole
        info.stats = {
          projects: count(row.projects),
          projectsByRole: byRole && typeof byRole === 'object' && !Array.isArray(byRole)
            ? Object.fromEntries(Object.entries(byRole as Record<string, unknown>).map(([role, total]) => [role, count(total)]))
            : {},
          accounts: count(row.accounts),
          activeAccounts: count(row.activeAccounts),
          suspendedAccounts: count(row.suspendedAccounts),
          operatorAccounts: count(row.operatorAccounts),
          usageEvents: count(row.usageEvents),
          auditEvents: count(row.auditEvents),
          exportsToday: count(row.exportsToday),
          simulationsToday: count(row.simulationsToday),
        }
        return info
      } catch (error) {
        return { ...info, statsError: describe(error) }
      }
    },

    async recordOpen() {
      if (!allowed('console.access') || !allowed('audit.write')) return
      await audit('admin:open', 'admin-console', { role: operator.role })
    },

    async listFaq() {
      if (!allowed('content.manage')) return { entries: [], error: denial('content.manage') }
      try {
        const { data, error } = await db
          .from('faq_entries')
          .select('id,surface,question,answer,position,published,updated_at')
          .order('surface', { ascending: true })
          .order('position', { ascending: true })
          .order('id', { ascending: true })
        if (error) return { entries: [], error: error.message }
        const entries = (data ?? []).map((raw) => {
          const row = raw as Record<string, unknown>
          const at = timestamp(row.updated_at)
          return {
            id: String(row.id ?? ''),
            surface: isFaqSurface(row.surface) ? row.surface : 'home' as const,
            question: String(row.question ?? ''),
            answer: String(row.answer ?? ''),
            position: Number(row.position ?? 0) || 0,
            published: row.published !== false,
            updatedAt: at ?? Date.now(),
          }
        }).filter((entry) => entry.id.length > 0)
        return { entries }
      } catch (error) {
        return { entries: [], error: describe(error) }
      }
    },

    async saveFaq({ id, surface, question, answer, position, published }) {
      if (!allowed('content.manage')) return denied('content.manage')
      if (!isFaqSurface(surface)) {
        return { ok: false, error: 'FAQ entries belong to the home page or the pricing page.' }
      }
      if (!question.trim() || !answer.trim()) {
        return { ok: false, error: 'FAQ entries need a question and an answer.' }
      }
      try {
        if (id) {
          const { error } = await db.from('faq_entries')
            .update({ surface, question: question.trim(), answer: answer.trim(), position, published })
            .eq('id', id)
          if (error) return { ok: false, error: error.message }
          return audited(await audit('admin:faq_update', id, { surface, position, published }), 'FAQ entry')
        }
        const { error } = await db.from('faq_entries')
          .insert({ surface, question: question.trim(), answer: answer.trim(), position, published })
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:faq_create', question.trim().slice(0, 80), { surface, position, published }), 'FAQ entry')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async deleteFaq(id) {
      if (!allowed('content.manage')) return denied('content.manage')
      if (!id) return { ok: false, error: 'Pick an entry first.' }
      try {
        const { error } = await db.from('faq_entries').delete().eq('id', id)
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:faq_delete', id, {}), 'FAQ entry')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async listLegalPages() {
      if (!allowed('content.manage')) return { entries: [], error: denial('content.manage') }
      try {
        const { data, error } = await db
          .from('legal_pages')
          .select('slug,title,eyebrow,heading,lede,sections,updated_at')
          .order('slug', { ascending: true })
        if (error) return { entries: [], error: error.message }
        const entries: LegalPageEntry[] = []
        for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
          const slug = typeof raw.slug === 'string' ? raw.slug : ''
          if (!(LEGAL_PAGE_SLUGS as readonly string[]).includes(slug)) continue
          entries.push({
            slug: slug as LegalPageSlug,
            title: typeof raw.title === 'string' ? raw.title : '',
            eyebrow: typeof raw.eyebrow === 'string' ? raw.eyebrow : '',
            heading: typeof raw.heading === 'string' ? raw.heading : '',
            lede: typeof raw.lede === 'string' ? raw.lede : '',
            sections: parseLegalPageSections(raw.sections),
            updatedAt: timestamp(raw.updated_at) ?? 0,
          })
        }
        return { entries }
      } catch (error) {
        return { entries: [], error: describe(error) }
      }
    },

    async saveLegalPage({ slug, title, eyebrow, heading, lede, sections }) {
      if (!allowed('content.manage')) return denied('content.manage')
      if (!(LEGAL_PAGE_SLUGS as readonly string[]).includes(slug)) {
        return { ok: false, error: `Unknown page "${slug}".` }
      }
      if (!title.trim() || !heading.trim()) {
        return { ok: false, error: 'A page needs a title and a heading.' }
      }
      if (lede.length > 2000) {
        return { ok: false, error: 'The introduction is too long (2000 characters maximum).' }
      }
      const normalized: LegalPageSection[] = sections
        .map((section) => ({
          heading: section.heading.trim(),
          body: normalizeRichText(section.body),
        }))
        .filter((section) => section.heading.length > 0 && richTextHasText(section.body))
      if (normalized.length === 0) {
        return { ok: false, error: 'A page needs at least one section with a heading and some text.' }
      }
      const total = normalized.reduce((sum, section) => sum + richTextLength(section.body), 0)
      if (total > 120000) {
        return { ok: false, error: 'The page is too long (120,000 characters across its sections maximum).' }
      }
      try {
        const { error } = await db
          .from('legal_pages')
          .upsert({
            slug,
            title: title.trim(),
            eyebrow: eyebrow.trim() || title.trim(),
            heading: heading.trim(),
            lede: lede.trim(),
            sections: normalized,
            // The column defaults to now() on insert, but an upsert that updates
            // would otherwise keep the original timestamp and the console would
            // report the page as older than it is.
            updated_at: new Date().toISOString(),
          })
        if (error) return { ok: false, error: error.message }
        return audited(
          await audit('admin:legal_page_save', slug, { sections: normalized.length, characters: total }),
          'legal page',
        )
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async loadSiteSettings() {
      if (!allowed('content.manage')) return { settings: null, error: denial('content.manage') }
      try {
        const { data, error } = await db
          .from('site_settings')
          .select('product_name,parent_company,tagline,description,contact_email,site_url,github_url,codeberg_url,security_policy_url,hero_eyebrow,hero_heading,hero_lede,hero_cta_label,hero_cta_href,updated_at')
          .limit(1)
        if (error) return { settings: null, error: error.message }
        const rows = data ?? []
        if (rows.length === 0) return { settings: null }
        const raw = rows[0] as Record<string, unknown>
        const parsed = parseSiteSettings(raw)
        if (!parsed) return { settings: null, error: 'The site-identity row is not readable.' }
        return { settings: { ...parsed, updatedAt: timestamp(raw.updated_at) ?? 0 } }
      } catch (error) {
        return { settings: null, error: describe(error) }
      }
    },

    async saveSiteSettings(settings) {
      if (!allowed('content.manage')) return denied('content.manage')
      const productName = settings.productName?.trim() ?? ''
      const parentCompany = settings.parentCompany?.trim() ?? ''
      const tagline = settings.tagline?.trim() ?? ''
      const description = settings.description?.trim() ?? ''
      const contactEmail = settings.contactEmail?.trim() ?? ''
      const siteUrl = settings.siteUrl?.trim() ?? ''
      const githubUrl = settings.githubUrl?.trim() ?? ''
      const codebergUrl = settings.codebergUrl?.trim() ?? ''
      const securityPolicyUrl = settings.securityPolicyUrl?.trim() ?? ''
      const heroEyebrow = settings.heroEyebrow?.trim() ?? ''
      const heroHeading = settings.heroHeading?.trim() ?? ''
      const heroLede = settings.heroLede?.trim() ?? ''
      const heroCtaLabel = settings.heroCtaLabel?.trim() ?? ''
      const heroCtaHref = settings.heroCtaHref?.trim() ?? ''
      if (!productName) return { ok: false, error: 'The product needs a name; the footer and page titles use it.' }
      if (productName.length > 120) return { ok: false, error: 'The product name is too long (120 characters maximum).' }
      if (parentCompany.length > 160) return { ok: false, error: 'The company name is too long (160 characters maximum).' }
      if (tagline.length > 200) return { ok: false, error: 'The tagline is too long (200 characters maximum).' }
      if (description.length > 1000) return { ok: false, error: 'The description is too long (1,000 characters maximum).' }
      if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return { ok: false, error: 'The contact address is not an email address.' }
      }
      const httpFields: Array<[string, string]> = [
        ['Site address', siteUrl],
        ['GitHub link', githubUrl],
        ['Codeberg link', codebergUrl],
        ['Security policy link', securityPolicyUrl],
      ]
      for (const [label, value] of httpFields) {
        if (value && !/^https?:\/\//i.test(value)) {
          return { ok: false, error: `${label} must start with http:// or https://.` }
        }
      }
      if (heroEyebrow.length > 120) return { ok: false, error: 'The landing eyebrow is too long (120 characters maximum).' }
      if (heroHeading.length > 200) return { ok: false, error: 'The landing headline is too long (200 characters maximum).' }
      if (heroLede.length > 600) return { ok: false, error: 'The landing introduction is too long (600 characters maximum).' }
      if (heroCtaLabel.length > 60) return { ok: false, error: 'The landing button label is too long (60 characters maximum).' }
      if (heroCtaHref && !siteTarget(heroCtaHref)) {
        return { ok: false, error: 'The landing button target must be a path on this site or an http(s) link.' }
      }
      try {
        const { error } = await db
          .from('site_settings')
          .upsert({
            id: true,
            product_name: productName,
            parent_company: parentCompany,
            tagline,
            description,
            contact_email: contactEmail,
            site_url: siteUrl.replace(/\/+$/, ''),
            github_url: githubUrl,
            codeberg_url: codebergUrl,
            security_policy_url: securityPolicyUrl,
            hero_eyebrow: heroEyebrow,
            hero_heading: heroHeading,
            hero_lede: heroLede,
            hero_cta_label: heroCtaLabel,
            hero_cta_href: heroCtaHref,
            updated_at: new Date().toISOString(),
          })
        if (error) return { ok: false, error: error.message }
        return audited(
          await audit('admin:site_settings_save', 'site-settings', {
            productName,
            parentCompany,
            contactEmail,
            siteUrl,
          }),
          'site identity',
        )
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async listNewsletterCampaigns() {
      if (!allowed('newsletter.read')) {
        return { campaigns: [], drain: null, transport: 'missing' as const, error: denial('newsletter.read') }
      }
      try {
        const { data, error } = await db
          .from('newsletter_campaigns')
          .select('id,name,subject,status,recipients,delivered,failed,created_at,sent_at,last_error')
          .order('created_at', { ascending: false })
        if (error) return { campaigns: [], drain: null, transport: 'missing' as const, error: error.message }
        const campaigns: NewsletterCampaign[] = (data ?? []).map((raw) => ({
          id: String(raw.id ?? ''),
          name: String(raw.name ?? ''),
          subject: String(raw.subject ?? ''),
          status: (raw.status === 'sending' || raw.status === 'sent' || raw.status === 'failed' ? raw.status : 'draft') as NewsletterCampaign['status'],
          recipients: Number(raw.recipients ?? 0) || 0,
          delivered: Number(raw.delivered ?? 0) || 0,
          failed: Number(raw.failed ?? 0) || 0,
          createdAt: timestamp(raw.created_at) ?? Date.now(),
          sentAt: timestamp(raw.sent_at) ?? null,
          lastError: typeof raw.last_error === 'string' ? raw.last_error : null,
        }))
        /* Probe the transport honestly instead of guessing: one cheap status call. */
        return { campaigns, drain: null, transport: await newsletterTransport() }
      } catch (error) {
        return { campaigns: [], drain: null, transport: 'missing' as const, error: describe(error) }
      }
    },

    async listTestimonials() {
      if (!allowed('content.manage')) return { entries: [], error: denial('content.manage') }
      try {
        const { data, error } = await db
          .from('testimonials')
          .select('id,quote,author,role,company,position,published,updated_at')
          .order('position', { ascending: true })
          .order('id', { ascending: true })
        if (error) return { entries: [], error: error.message }
        const entries: TestimonialEntry[] = (data ?? []).map((raw) => {
          const row = raw as Record<string, unknown>
          return {
            id: String(row.id ?? ''),
            quote: String(row.quote ?? ''),
            author: String(row.author ?? ''),
            role: String(row.role ?? ''),
            company: String(row.company ?? ''),
            position: Number(row.position ?? 0) || 0,
            published: row.published !== false,
            updatedAt: timestamp(row.updated_at) ?? Date.now(),
          }
        })
        return { entries }
      } catch (error) {
        return { entries: [], error: describe(error) }
      }
    },

    async saveTestimonial({ id, quote, author, role, company, position, published }) {
      if (!allowed('content.manage')) return denied('content.manage')
      if (!quote.trim() || !author.trim()) {
        return { ok: false, error: 'A testimonial needs a quote and the person who said it.' }
      }
      try {
        const row = { quote: quote.trim(), author: author.trim(), role: role.trim(), company: company.trim(), position, published }
        if (id) {
          const { error } = await db.from('testimonials').update(row).eq('id', id)
          if (error) return { ok: false, error: error.message }
          return audited(await audit('admin:testimonial_update', id, {}), 'Testimonial')
        }
        const { error } = await db.from('testimonials').insert(row)
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:testimonial_create', author.trim().slice(0, 80), {}), 'Testimonial')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async deleteTestimonial(id) {
      if (!allowed('content.manage')) return denied('content.manage')
      if (!id) return { ok: false, error: 'Pick a testimonial first.' }
      try {
        const { error } = await db.from('testimonials').delete().eq('id', id)
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:testimonial_delete', id, {}), 'Testimonial')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async listNewsletterSubscribers() {
      if (!allowed('newsletter.read')) return { subscribers: [], error: denial('newsletter.read') }
      try {
        const { data, error } = await db
          .from('newsletter_subscribers')
          .select('id,email,display_name,subscribed_at,last_sent_at,unsubscribed_at')
          .order('subscribed_at', { ascending: false })
          .limit(200)
        if (error) return { subscribers: [], error: error.message }
        const subscribers: NewsletterSubscriber[] = (data ?? []).map((row) => ({
          id: String(row.id ?? ''),
          email: String(row.email ?? ''),
          displayName: String(row.display_name ?? ''),
          subscribedAt: timestamp(row.subscribed_at) ?? Date.now(),
          lastSentAt: timestamp(row.last_sent_at) ?? null,
          unsubscribedAt: timestamp(row.unsubscribed_at) ?? null,
        }))
        return { subscribers }
      } catch (error) {
        return { subscribers: [], error: describe(error) }
      }
    },

    async removeNewsletterSubscriber(id) {
      if (!allowed('newsletter.manage')) return denied('newsletter.manage')
      if (!id) return { ok: false, error: 'Pick a subscriber first.' }
      try {
        const { error } = await db.from('newsletter_subscribers').delete().eq('id', id)
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:newsletter_subscriber_remove', id, {}), 'subscriber removal')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async createNewsletterCampaign({ name, subject, body }) {
      if (!allowed('newsletter.manage')) return denied('newsletter.manage')
      if (!name.trim() || !subject.trim() || !body.trim()) {
        return { ok: false, error: 'A campaign needs a name, a subject and a body.' }
      }
      try {
        const { data, error } = await db
          .from('newsletter_campaigns')
          .insert({ name: name.trim(), subject: subject.trim(), body: body.trim(), created_by: operator.id })
          .select('id,name,subject,status,recipients,delivered,failed,created_at,sent_at,last_error')
          .single()
        if (error) return { ok: false, error: error.message }
        const campaign: NewsletterCampaign = {
          id: String(data.id ?? ''),
          name: String(data.name ?? ''),
          subject: String(data.subject ?? ''),
          status: 'draft',
          recipients: 0,
          delivered: 0,
          failed: 0,
          createdAt: timestamp(data.created_at) ?? Date.now(),
          sentAt: null,
          lastError: null,
        }
        const warning = await audit('admin:newsletter_campaign_create', campaign.id, {
          name: campaign.name,
          subject: campaign.subject,
        })
        return {
          ok: true,
          campaign,
          ...(warning
            ? { warning: `The draft was created, but the audit trail did not accept the row: ${warning}` }
            : {}),
        }
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },

    async sendNewsletterCampaign(id) {
      if (!allowed('newsletter.send')) return denied('newsletter.send')
      if (!id) return { ok: false, error: 'Pick a campaign first.' }
      try {
        const base = cloudConfig.url
        const token = await newsletterToken()
        if (!base || !token) return { ok: false, error: 'This deployment is not configured for the loopback backend.' }
        const res = await fetch(`${base.replace(/\/+$/, '')}/admin/newsletter/send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({ campaignId: id }),
        })
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        if (!res.ok) {
          const message = body?.message ?? 'The server refused the send.'
          // A refused send is still an operator action worth recording.
          await audit('admin:newsletter_send_failed', id, { error: message })
          return { ok: false, error: message }
        }
        const warning = await audit('admin:newsletter_send', id, {})
        return {
          ok: true,
          ...(warning
            ? { warning: `The send started, but the audit trail did not accept the row: ${warning}` }
            : {}),
        }
      } catch (error) {
        const message = describe(error)
        await audit('admin:newsletter_send_failed', id, { error: message })
        return { ok: false, error: message }
      }
    },

    async deleteNewsletterCampaign(id) {
      if (!allowed('newsletter.manage')) return denied('newsletter.manage')
      if (!id) return { ok: false, error: 'Pick a campaign first.' }
      try {
        const { error } = await db.from('newsletter_campaigns').delete().eq('id', id)
        if (error) return { ok: false, error: error.message }
        return audited(await audit('admin:newsletter_campaign_delete', id, {}), 'campaign deletion')
      } catch (error) {
        return { ok: false, error: describe(error) }
      }
    },
  }
}