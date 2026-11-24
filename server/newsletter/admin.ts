/**
 * Operator-only newsletter admin routes.
 *
 * Every handler reads the caller's JWT, verifies the signature, and asks the
 * database whether that user is an admin — the same `public.is_admin()` contract
 * every RLS policy uses. A route that skipped this would let any authenticated
 * account send mail to the whole list.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Database } from '../db'
import { bearerToken, HttpError, readJson, sendJson } from '../http/respond'
import { verifyJwt } from '../auth/jwt'
import type { SmtpConfig } from '../config'
import type { Mailer } from './mailer'
import { countCampaignDrain, drainCampaign, requeueFailed, seedDeliveries } from './index'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UNSUBSCRIBE_TOKEN = /^[0-9a-f-]{36}$/i

export interface NewsletterAdminContext {
  db: Database
  jwtSecret: string
  smtp: SmtpConfig
  siteOrigin: string
  createMailer: () => Mailer | null
  logger?: (message: string, ...rest: unknown[]) => void
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/** Escape a value for interpolation into a `set local` statement. */
const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`

/**
 * Ask `public.is_admin()` inside a transaction with the same claims plumbing the
 * REST layer uses, so the function reads the caller's id from
 * `request.jwt.claims` exactly like hosted Supabase does.
 */
async function isAdmin(db: Database, sub: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated')
    await tx.query(
      `set local "request.jwt.claims" = ${sqlLiteral(
        JSON.stringify({ sub, aud: 'authenticated', role: 'authenticated' }),
      )}`,
    )
    const { rows } = await tx.query('select public.is_admin() as admin')
    return rows[0]?.admin === true
  })
}

/** Resolve the caller and require the operator capability, or throw. */
async function requireOperator(
  ctx: NewsletterAdminContext,
  req: IncomingMessage,
): Promise<string> {
  const payload = verifyJwt(bearerToken(req), ctx.jwtSecret)
  if (!payload?.sub) throw new HttpError(401, 'Invalid JWT.', 'bad_jwt')
  if (!(await isAdmin(ctx.db, payload.sub))) {
    throw new HttpError(403, 'This route is for operators.', 'not_admin')
  }
  return payload.sub
}

export async function handleNewsletterSend(
  ctx: NewsletterAdminContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await requireOperator(ctx, req)

  const body = asRecord(await readJson(req))
  const campaignId = String(body?.campaignId ?? '')
  if (!campaignId) throw new HttpError(400, 'Provide campaignId.', 'campaign_id_required')

  if (!ctx.smtp.configured) {
    throw new HttpError(
      424,
      'No outbound SMTP transport is configured. Set FOLIO_SMTP_HOST and FOLIO_SMTP_FROM to send campaigns; see docs/DEPLOYMENT.md.',
      'smtp_unavailable',
    )
  }

  const found = await ctx.db.query(
    'select * from public.newsletter_campaigns where id = $1',
    [campaignId],
  )
  const campaign = found.rows[0] as { subject: string; body: string; status: string } | undefined
  if (!campaign) throw new HttpError(404, 'No campaign with that id.', 'campaign_not_found')
  if (campaign.status === 'sending') {
    throw new HttpError(409, 'A send is already in flight for this campaign.', 'already_sending')
  }

  await seedDeliveries(ctx.db, campaignId)
  await requeueFailed(ctx.db, campaignId)

  const mailer = ctx.createMailer()
  if (!mailer) {
    throw new HttpError(424, 'No outbound SMTP transport is configured.', 'smtp_unavailable')
  }

  /* The send runs in the background: the operator gets the campaign id back
   * immediately and polls /admin/newsletter/status for live counts. */
  void drainCampaign(ctx.db, mailer, {
    campaignId,
    campaign: { subject: campaign.subject, body: campaign.body },
    baseUrl: ctx.siteOrigin,
    from: ctx.smtp.from,
    chunkDelayMs: 1500,
    logger: (message) => ctx.logger?.(message),
  }).catch((error: unknown) => {
    ctx.logger?.('[backend] newsletter drain failed:', error)
    const message = String(error instanceof Error ? error.message : error).slice(0, 500)
    void ctx.db
      .query(
        "update public.newsletter_campaigns set status='failed', last_error=$1 where id=$2",
        [message, campaignId],
      )
      .catch(() => {})
  })

  sendJson(res, 202, {
    ok: true,
    campaignId,
    message: 'Send started; poll /admin/newsletter/status for progress.',
  })
}

export async function handleNewsletterStatus(
  ctx: NewsletterAdminContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  await requireOperator(ctx, req)

  const campaignId = url.searchParams.get('id') ?? ''
  if (campaignId && !UUID.test(campaignId)) {
    throw new HttpError(400, 'id must be a uuid.', 'bad_id')
  }

  const found = campaignId
    ? await ctx.db.query(
        `select id,name,subject,status,recipients,delivered,failed,last_error,created_at,sent_at
           from public.newsletter_campaigns where id = $1`,
        [campaignId],
      )
    : await ctx.db.query(
        `select id,name,subject,status,recipients,delivered,failed,last_error,created_at,sent_at
           from public.newsletter_campaigns order by created_at desc limit 50`,
      )

  const transport = ctx.smtp.configured ? 'configured' : 'missing'

  if (campaignId) {
    if (found.rows.length === 0) {
      throw new HttpError(404, 'No campaign with that id.', 'campaign_not_found')
    }
    const drain = await countCampaignDrain(ctx.db, campaignId)
    sendJson(res, 200, { campaign: found.rows[0], drain, transport })
    return
  }
  sendJson(res, 200, { campaigns: found.rows, transport })
}

/**
 * One-click unsubscribe, no auth required — the token is the credential, the same
 * shape as the confirmation links every mail client user expects. Marks the row
 * unsubscribed rather than deleting it, so re-subscription is a deliberate act and
 * the list stays consistent.
 */
export async function handleNewsletterUnsubscribe(
  ctx: NewsletterAdminContext,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = asRecord(await readJson(req))
  const token = String(body?.token ?? '')
  if (!UNSUBSCRIBE_TOKEN.test(token)) {
    throw new HttpError(400, 'That unsubscribe link is not valid.', 'bad_token')
  }
  const { rows } = await ctx.db.query(
    `update public.newsletter_subscribers set unsubscribed_at = now()
      where unsubscribe_token = $1::uuid and unsubscribed_at is null returning id`,
    [token],
  )
  sendJson(res, 200, { ok: true, alreadyUnsubscribed: rows.length === 0 })
}