/**
 * Operator console — newsletter campaigns.
 *
 * Compose (name, subject, body), see the audience size, send, watch the
 * counters tick. Sending is a backend job on a chunked drain; the button
 * starts it and this panel polls the status route until the campaign is
 * `sent` or `failed`. Nothing here pretends the SMTP server exists when it
 * does not: with `transport: missing`, the send control is replaced by the
 * exact environment variables that unlock it.
 */
import HoverHelp from '../components/ui/HoverHelp'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Mail, Send, Trash2, Inbox } from 'lucide-react'
import { Button } from '../components/ui/button'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useConfirm } from '../components/ui/useConfirm'
import type { AdminApi, NewsletterCampaign, NewsletterSubscriber } from '../lib/admin/adminService'

interface NewsletterPanelProps {
  api: AdminApi
}

const STATUS_STYLE: Record<NewsletterCampaign['status'], string> = {
  draft: 'border-warning/40 bg-warning/10 text-warning',
  sending: 'border-info/40 bg-info/10 text-info',
  sent: 'border-success/40 bg-success/10 text-success',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
}

export default function NewsletterPanel({ api }: NewsletterPanelProps) {
  const [campaigns, setCampaigns] = useState<NewsletterCampaign[]>([])
  const [subscribers, setSubscribers] = useState<NewsletterSubscriber[]>([])
  const [loading, setLoading] = useState(true)
  const [transport, setTransport] = useState<'configured' | 'missing'>('missing')
  const [error, setError] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftSubject, setDraftSubject] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [composing, setComposing] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)
  const { spec: confirmSpec, confirm, resolve: resolveConfirm } = useConfirm()

  const refresh = useCallback(async () => {
    setLoading(true)
    const [campaignResult, subscriberResult] = await Promise.all([api.listNewsletterCampaigns(), api.listNewsletterSubscribers()])
    setCampaigns(campaignResult.campaigns)
    setSubscribers(subscriberResult.subscribers)
    setTransport(campaignResult.transport)
    setError(campaignResult.error ?? subscriberResult.error ?? null)
    setLoading(false)
  }, [api])

  useEffect(() => { void refresh() }, [refresh])

  /* Poll the in-flight campaign until it leaves `sending`. */
  useEffect(() => {
    if (!sendingId) return
    let cancelled = false
    const tick = async () => {
      const status = await api.listNewsletterCampaigns()
      const found = status.campaigns.find((campaign) => campaign.id === sendingId)
      if (!found || found.status !== 'sending') {
        await refresh()
        if (!cancelled) setSendingId(null)
        return
      }
      setCampaigns((current) => current.map((campaign) => (campaign.id === sendingId ? found : campaign)))
    }
    const timer = window.setInterval(() => { void tick() }, 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [sendingId, api, refresh])

  const create = async () => {
    if (!draftName.trim() || !draftSubject.trim() || !draftBody.trim()) return
    setComposing(true)
    setFeedback(null)
    const result = await api.createNewsletterCampaign({ name: draftName, subject: draftSubject, body: draftBody })
    setComposing(false)
    if (!result.ok) { setFeedback({ kind: 'error', message: result.error ?? 'The campaign could not be created.' }); return }
    setDraftName(''); setDraftSubject(''); setDraftBody('')
    setFeedback({ kind: 'ok', message: 'Draft created. Review it below, then send it.' })
    await refresh()
  }

  const send = async (campaign: NewsletterCampaign) => {
    if (campaign.status === 'sending') return
    const accepted = await confirm({
      title: `Send "${campaign.name}"?`,
      detail: `This sends the campaign to every address on the subscriber list. A send cannot be undone.`,
      confirmLabel: 'Send campaign',
      destructive: true,
    })
    if (!accepted) return
    setSendingId(campaign.id)
    setFeedback(null)
    const result = await api.sendNewsletterCampaign(campaign.id)
    if (!result.ok) { setSendingId(null); setFeedback({ kind: 'error', message: result.error ?? 'The server refused the send.' }) }
    else { setFeedback({ kind: 'ok', message: campaign.recipients > 0 ? `Sending to ${campaign.recipients} subscribers.` : 'Sending the campaign.' }) }
  }

  const remove = async (campaign: NewsletterCampaign) => {
    const accepted = await confirm({
      title: `Delete "${campaign.name}"?`,
      detail: 'The campaign and its delivery log are removed permanently.',
      confirmLabel: 'Delete campaign',
      destructive: true,
    })
    if (!accepted) return
    const result = await api.deleteNewsletterCampaign(campaign.id)
    setFeedback(result.ok ? { kind: 'ok', message: 'Campaign deleted.' } : { kind: 'error', message: result.error ?? 'The campaign could not be deleted.' })
    await refresh()
  }

  const removeSubscriber = async (subscriber: NewsletterSubscriber) => {
    const accepted = await confirm({
      title: `Remove ${subscriber.email}?`,
      detail: 'The address and its unsubscribe token are deleted permanently.',
      confirmLabel: 'Remove subscriber',
      destructive: true,
    })
    if (!accepted) return
    const result = await api.removeNewsletterSubscriber(subscriber.id)
    if (!result.ok) setFeedback({ kind: 'error', message: result.error ?? 'The subscriber could not be removed.' })
    await refresh()
  }

  if (loading) return <p className="text-xs text-muted-foreground">Reading the campaign list…</p>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Newsletter</h2>
          <p className="text-xs text-muted-foreground">One-way broadcast list. The backend sends through your SMTP server — no campaign ever leaves this deployment.</p>
        </div>
        <HoverHelp title="Refresh" description="Re-read the campaign list and subscriber list.">
          <button type="button" className="cad-ctl cad-ctl--icon" onClick={() => void refresh()} aria-label="Refresh campaigns">
            <RefreshIcon />
          </button>
        </HoverHelp>
      </div>

      {/* Transport: when the server can send, there is nothing to say — the
          campaigns behave like every other operator action. When it cannot,
          name exactly what is missing and what unlocks it. */}
      {transport === 'missing' && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            Outbound mail is not configured. Set <code>FOLIO_SMTP_HOST</code>, <code>FOLIO_SMTP_PORT</code>, <code>FOLIO_SMTP_USER</code>, <code>FOLIO_SMTP_PASS</code>, <code>FOLIO_SMTP_FROM</code> and <code>FOLIO_SITE_ORIGIN</code> on the backend, then reload. Sends fail until then.
          </span>
        </p>
      )}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {feedback && (
        <p role="status" className={feedback.kind === 'ok' ? 'text-xs text-success' : 'text-xs text-destructive'}>
          {feedback.message}
        </p>
      )}

      {/* Compose */}
      <section aria-label="Compose campaign" className="rounded-lg border border-border/70 bg-card/40 p-4">
        <h3 className="text-sm font-semibold text-foreground">New campaign</h3>
        <div className="mt-3 grid gap-2">
          <input id="nlc-name" value={draftName} onChange={(e) => setDraftName(e.target.value)} maxLength={160} placeholder="Campaign name — internal reference only" aria-label="Campaign name" className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground" />
          <input id="nlc-subject" value={draftSubject} onChange={(e) => setDraftSubject(e.target.value)} maxLength={200} placeholder="Subject line — this is what subscribers see" aria-label="Subject line" className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground" />
          <textarea id="nlc-body" value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={6} placeholder="Body — plain text. Add one link if you want one…" aria-label="Campaign body" className="w-full rounded-md border border-input bg-background p-2 text-xs text-foreground" style={{ minHeight: '7rem' }} />
          <div className="flex justify-end">
            <Button size="sm" type="button" disabled={composing || !draftName.trim() || !draftSubject.trim() || !draftBody.trim()} onClick={() => void create()}>
              {composing ? 'Creating…' : 'Create draft'}
            </Button>
          </div>
        </div>
      </section>

      {/* Subscribers */}
      <section aria-label="Subscribers">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Inbox className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Subscribers <span className="font-normal text-muted-foreground">({subscribers.length})</span></h3>
        {subscribers.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Nobody has subscribed yet. The subscribe strip on the homepage is live for any visitor who gives an address — each is stored with a unique unsubscribe token.</p>
        ) : (
          <ul className="mt-2 max-h-56 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/70 bg-card/60">
            {subscribers.map((subscriber) => (
              <li key={subscriber.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-foreground">{subscriber.email}</p>
                  <p className="text-[10px] text-muted-foreground">
                    subscribed {new Date(subscriber.subscribedAt).toLocaleDateString()}
                    {subscriber.lastSentAt ? ` · last mail ${new Date(subscriber.lastSentAt).toLocaleDateString()}` : ''}
                    {subscriber.unsubscribedAt ? ' · unsubscribed' : ''}
                  </p>
                </div>
                <HoverHelp title="Remove subscriber" description="Permanently delete this address and its unsubscribe token. Cannot be undone.">
                  <button type="button" className="cad-ctl cad-ctl--icon" aria-label="Remove subscriber" onClick={() => void removeSubscriber(subscriber)}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </HoverHelp>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Campaigns */}
      <section aria-label="Campaigns">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Campaigns <span className="font-normal text-muted-foreground">({campaigns.length})</span></h3>
        {campaigns.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No campaigns yet. The list is real the moment someone subscribes on the homepage — the compose box above is where you write the first notice.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {campaigns.map((campaign) => (
              <li key={campaign.id} className="rounded-lg border border-border/70 bg-card/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">{campaign.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{campaign.subject}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLE[campaign.status]}`}>{campaign.status}</span>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {campaign.recipients > 0 ? `${campaign.recipients.toLocaleString()} recipients · ` : ''}
                  {campaign.delivered.toLocaleString()} delivered · {campaign.failed.toLocaleString()} failed
                </p>
                {campaign.lastError && <p className="mt-1 text-[10px] text-destructive">{campaign.lastError}</p>}
                <div className="mt-2 flex items-center gap-2">
                  <HoverHelp title="Send campaign" description="Sends this campaign to every unsubscribed address. An in-flight send cannot be replayed.">
                    <button type="button" className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50" disabled={sendingId !== null || campaign.status === 'sending' || campaign.status === 'sent'} onClick={() => void send(campaign)}>
                      <Send className="h-3.5 w-3.5" aria-hidden="true" /> {campaign.status === 'sent' ? 'Sent' : sendingId === campaign.id ? 'Sending…' : 'Send'}
                    </button>
                  </HoverHelp>
                  <HoverHelp title="Delete campaign" description="Removes the campaign and its delivery log. Cannot be undone.">
                    <button type="button" className="cad-ctl cad-ctl--icon" onClick={() => void remove(campaign)} aria-label="Delete campaign"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                  </HoverHelp>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog spec={confirmSpec} onResolve={resolveConfirm} />
    </div>
  )
}

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M16 8h5V3" />
  </svg>
)
