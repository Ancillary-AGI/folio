/**
 * The console's navigation, in one place.
 *
 * The rail is grouped by the job an operator is doing — run the deployment,
 * read what happened, govern the record, edit public content, inspect the
 * installation — so a dozen sections do not read as a dozen unrelated tabs.
 */
import {
  Activity, BookOpen, Building2, Database, FileText, Gauge, LayoutDashboard, Mail,
  MessageSquareQuote, Shield, ShieldCheck, Users, type LucideIcon,
} from 'lucide-react'

export type SectionId =
  | 'overview'
  | 'accounts'
  | 'iam'
  | 'usage'
  | 'quotas'
  | 'audit'
  | 'faq'
  | 'legal'
  | 'site'
  | 'testimonials'
  | 'newsletter'
  | 'deployment'

export type SectionGroup = 'Operations' | 'Insights' | 'Governance' | 'Content' | 'System'

export interface AdminSection {
  id: SectionId
  label: string
  icon: LucideIcon
  group: SectionGroup
  /** A short sentence for the rail's accessible description / tooltip title. */
  hint: string
}

export const ADMIN_SECTIONS: readonly AdminSection[] = Object.freeze([
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Operations', hint: 'The state of the deployment at a glance.' },
  { id: 'accounts', label: 'Accounts', icon: Users, group: 'Operations', hint: 'Everyone who can sign in, and what they may do.' },
  { id: 'iam', label: 'Roles & access', icon: ShieldCheck, group: 'Operations', hint: 'The role matrix, operator access and how authority is enforced.' },
  { id: 'usage', label: 'Usage', icon: Activity, group: 'Insights', hint: 'What accounts actually did in the product.' },
  { id: 'quotas', label: 'Quotas', icon: Gauge, group: 'Insights', hint: 'The limits each role is held to, and who is near them.' },
  { id: 'audit', label: 'Audit trail', icon: Shield, group: 'Governance', hint: 'The append-only record of operator actions.' },
  { id: 'faq', label: 'FAQ', icon: BookOpen, group: 'Content', hint: 'Questions and answers shown on the public site.' },
  { id: 'legal', label: 'Legal pages', icon: FileText, group: 'Content', hint: 'The about, terms, privacy and security copy.' },
  { id: 'site', label: 'Site identity', icon: Building2, group: 'Content', hint: 'The product name, company, contact and source links the shell shows.' },
  { id: 'testimonials', label: 'Testimonials', icon: MessageSquareQuote, group: 'Content', hint: 'Curated quotes shown on the public site.' },
  { id: 'newsletter', label: 'Newsletter', icon: Mail, group: 'Content', hint: 'Subscribers, campaigns and the SMTP drain.' },
  { id: 'deployment', label: 'Deployment', icon: Database, group: 'System', hint: 'What this installation runs and what it can reach.' },
])

export const SECTION_GROUPS: readonly SectionGroup[] = Object.freeze([
  'Operations', 'Insights', 'Governance', 'Content', 'System',
])

export function sectionLabel(id: SectionId): string {
  return ADMIN_SECTIONS.find((section) => section.id === id)?.label ?? id
}
