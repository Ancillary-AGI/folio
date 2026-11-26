/**
 * Admin console — public identity.
 *
 * The product name, the company behind it, the contact address and the source
 * links are deployment data. A self-hosted installation is not the company in
 * the defaults, and a fork is not the product in the defaults, so these values
 * live in `public.site_settings` and are edited here rather than compiled into
 * the bundle.
 *
 * An empty field is not a placeholder: the shell omits that element. The form
 * says so, because an operator who clears the contact address should know the
 * footer will not invent one.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, Save } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import type { AdminApi, SiteSettingsEntry } from '../lib/admin/adminService'
import type { SiteSettings } from '../lib/site/siteSettings'

interface SiteSettingsPanelProps {
  api: AdminApi
  onReload: () => void
}

interface Draft {
  productName: string
  parentCompany: string
  tagline: string
  description: string
  contactEmail: string
  siteUrl: string
  githubUrl: string
  codebergUrl: string
  securityPolicyUrl: string
  heroEyebrow: string
  heroHeading: string
  heroLede: string
  heroCtaLabel: string
  heroCtaHref: string
}

const EMPTY: Draft = {
  productName: '',
  parentCompany: '',
  tagline: '',
  description: '',
  contactEmail: '',
  siteUrl: '',
  githubUrl: '',
  codebergUrl: '',
  securityPolicyUrl: '',
  heroEyebrow: '',
  heroHeading: '',
  heroLede: '',
  heroCtaLabel: '',
  heroCtaHref: '',
}

const toDraft = (settings: SiteSettingsEntry | null): Draft => ({
  ...EMPTY,
  productName: settings?.productName ?? '',
  parentCompany: settings?.parentCompany ?? '',
  tagline: settings?.tagline ?? '',
  description: settings?.description ?? '',
  contactEmail: settings?.contactEmail ?? '',
  siteUrl: settings?.siteUrl ?? '',
  githubUrl: settings?.githubUrl ?? '',
  codebergUrl: settings?.codebergUrl ?? '',
  securityPolicyUrl: settings?.securityPolicyUrl ?? '',
  heroEyebrow: settings?.heroEyebrow ?? '',
  heroHeading: settings?.heroHeading ?? '',
  heroLede: settings?.heroLede ?? '',
  heroCtaLabel: settings?.heroCtaLabel ?? '',
  heroCtaHref: settings?.heroCtaHref ?? '',
})

const toSettings = (draft: Draft): SiteSettings => ({
  productName: draft.productName.trim() || undefined,
  parentCompany: draft.parentCompany.trim() || undefined,
  tagline: draft.tagline.trim() || undefined,
  description: draft.description.trim() || undefined,
  contactEmail: draft.contactEmail.trim() || undefined,
  siteUrl: draft.siteUrl.trim() || undefined,
  githubUrl: draft.githubUrl.trim() || undefined,
  codebergUrl: draft.codebergUrl.trim() || undefined,
  securityPolicyUrl: draft.securityPolicyUrl.trim() || undefined,
  heroEyebrow: draft.heroEyebrow.trim() || undefined,
  heroHeading: draft.heroHeading.trim() || undefined,
  heroLede: draft.heroLede.trim() || undefined,
  heroCtaLabel: draft.heroCtaLabel.trim() || undefined,
  heroCtaHref: draft.heroCtaHref.trim() || undefined,
})

const FIELDS: Array<{
  key: keyof Draft
  label: string
  placeholder: string
  hint: string
  type?: string
  maxLength: number
  wide?: boolean
}> = [
  {
    key: 'productName',
    label: 'Product name',
    placeholder: 'The name on the lockup and in page titles',
    hint: 'Required. Used in page titles, accessible names and the footer copyright.',
    maxLength: 120,
  },
  {
    key: 'parentCompany',
    label: 'Company',
    placeholder: 'The company behind the product',
    hint: 'Shown in the footer. Leave empty when the product stands alone.',
    maxLength: 160,
  },
  {
    key: 'tagline',
    label: 'Tagline',
    placeholder: 'A short line under the footer lockup',
    hint: 'A few words, not a paragraph.',
    maxLength: 200,
  },
  {
    key: 'contactEmail',
    label: 'Contact address',
    placeholder: 'founder@example.com',
    hint: 'Used for the footer contact link and the enterprise call-to-action.',
    type: 'email',
    maxLength: 254,
  },
  {
    key: 'siteUrl',
    label: 'Site address',
    placeholder: 'https://example.com',
    hint: 'Canonical origin for metadata, the sitemap and robots. No trailing slash needed.',
    type: 'url',
    maxLength: 300,
  },
  {
    key: 'description',
    label: 'Default description',
    placeholder: 'One sentence for search results and social cards',
    hint: 'Used when a page does not supply its own description.',
    maxLength: 1000,
    wide: true,
  },
  {
    key: 'heroEyebrow',
    label: 'Landing eyebrow',
    placeholder: 'The small line above the headline',
    hint: 'Shown on the landing page above the headline.',
    maxLength: 120,
  },
  {
    key: 'heroHeading',
    label: 'Landing headline',
    placeholder: 'One brief.\nOne verified board.',
    hint: 'A line break here is kept on the page.',
    maxLength: 200,
    wide: true,
  },
  {
    key: 'heroLede',
    label: 'Landing introduction',
    placeholder: 'One paragraph under the headline',
    hint: 'The sentence that explains the product.',
    maxLength: 600,
    wide: true,
  },
  {
    key: 'heroCtaLabel',
    label: 'Landing button',
    placeholder: 'Sign up to design',
    hint: 'The label on the primary call to action.',
    maxLength: 60,
  },
  {
    key: 'heroCtaHref',
    label: 'Landing button target',
    placeholder: '/sign-in?mode=signup',
    hint: 'Where the primary button goes. A path on this site, or an https URL.',
    maxLength: 300,
  },
  {
    key: 'githubUrl',
    label: 'GitHub',
    placeholder: 'https://github.com/owner/repo',
    hint: 'Shown in the footer source column when set.',
    type: 'url',
    maxLength: 300,
  },
  {
    key: 'codebergUrl',
    label: 'Codeberg',
    placeholder: 'https://codeberg.org/owner',
    hint: 'Shown in the footer source column when set.',
    type: 'url',
    maxLength: 300,
  },
  {
    key: 'securityPolicyUrl',
    label: 'Security policy',
    placeholder: 'https://example.com/SECURITY.md',
    hint: 'The published vulnerability-handling policy linked from /security.',
    type: 'url',
    maxLength: 300,
    wide: true,
  },
]

export default function SiteSettingsPanel({ api, onReload }: SiteSettingsPanelProps) {
  const [settings, setSettings] = useState<SiteSettingsEntry | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const result = await api.loadSiteSettings()
    setSettings(result.settings)
    setDraft(toDraft(result.settings))
    if (result.error) setError(result.error)
    setLoading(false)
  }, [api])

  useEffect(() => { void load() }, [load])

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    const result = await api.saveSiteSettings(toSettings(draft))
    setSaving(false)
    if (!result.ok) { setMessage(result.error ?? 'Could not save.'); return }
    if (result.warning) setMessage(result.warning)
    else setMessage('Saved. The public site uses these values on its next request.')
    await load()
    onReload()
  }, [api, draft, load, onReload])

  if (loading) {
    return <p className="text-sm text-muted-foreground">Reading the site identity…</p>
  }

  if (error && !settings) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
        <p className="text-sm text-foreground">The site identity could not be read: {error}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Apply the site-settings migration before editing this section.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Site identity</h2>
        <p className="text-xs text-muted-foreground">
          The public shell reads these values from the deployment. Empty fields are omitted,
          never replaced with a default that is not yours.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <div key={field.key} className={field.wide ? 'sm:col-span-2' : undefined}>
            <Label htmlFor={`site-${field.key}`}>{field.label}</Label>
            <Input
              id={`site-${field.key}`}
              type={field.type ?? 'text'}
              value={draft[field.key]}
              onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
              placeholder={field.placeholder}
              maxLength={field.maxLength}
              required={field.key === 'productName'}
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{field.hint}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
          Footer preview
        </p>
        <p className="text-sm font-semibold text-foreground">
          {draft.productName.trim() || 'Unnamed product'}
          {draft.parentCompany.trim() && (
            <span className="font-normal text-muted-foreground">{` · a product of ${draft.parentCompany.trim()}`}</span>
          )}
        </p>
        {draft.tagline.trim() && <p className="text-xs text-muted-foreground">{draft.tagline.trim()}</p>}
        {draft.contactEmail.trim() && (
          <p className="mt-1 text-xs text-muted-foreground">{draft.contactEmail.trim()}</p>
        )}
        {!draft.contactEmail.trim() && (
          <p className="mt-1 text-xs text-muted-foreground">
            The contact column is omitted until an address is set.
          </p>
        )}
      </div>

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          <Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Saving…' : 'Save identity'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(toDraft(settings))} disabled={saving}>
          Reset
        </Button>
        {settings?.updatedAt ? (
          <span className="text-[11px] text-muted-foreground">
            {`Last saved ${new Date(settings.updatedAt).toLocaleString()}`}
          </span>
        ) : null}
      </div>
    </form>
  )
}
