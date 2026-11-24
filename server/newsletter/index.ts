/**
 * Newsletter campaigns — the send pipeline.
 *
 * Pure logic, no I/O trapped inside a closure a test cannot drive: everything
 * negotiable is passed in (`db`, `mailer`, `baseUrl`, timing). The backend wires
 * in nodemailer; tests wire in a fake.
 *
 * Design contract, because this is the part that has to work on a list of
 * thousands without blowing up:
 *
 *   1. Deliveries are created from the snapshot at send time — set-based
 *      INSERT … SELECT, once per campaign, never row-by-row.
 *   2. The drain fetches a batch of pending deliveries, sends them sequentially,
 *      then asks again. The list never lives in memory; a crash mid-drain leaves
 *      exactly the pending rows to resume from.
 *   3. One bad address never stops the campaign — each failure is recorded with
 *      the recipient id and the error text, and the rest of the batch proceeds.
 *   4. Counters on the campaign row reflect the truth of the table at all times,
 *      so reopening the admin panel mid-send shows the real state.
 *   5. Re-sending from a failed campaign resets its failures to pending and
 *      retries them. Rows already delivered stay delivered.
 */
import type { Database } from '../db'
import type { Mailer } from './mailer'

/** Deliveries attempted per batch. */
export const NEWSLETTER_BATCH_SIZE = 20

/** Delay between batches, so a large send does not open thousands of sockets. */
export const NEWSLETTER_CHUNK_DELAY_MS = 1500

export interface CampaignSnapshot {
  subject: string
  body: string
}

export interface DrainCounts {
  pending: number
  delivered: number
  failed: number
  total: number
}

export interface DrainOptions {
  campaignId: string
  campaign: CampaignSnapshot
  baseUrl: string
  /** RFC 5322 From header; deployment data supplied by FOLIO_SMTP_FROM. */
  from: string
  batchSize?: number
  chunkDelayMs?: number
  logger?: (message: string) => void
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const errorText = (error: unknown): string =>
  String(error instanceof Error ? error.message : error).slice(0, 500)

export async function countActiveSubscribers(db: Database): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from public.newsletter_subscribers where unsubscribed_at is null`,
  )
  return Number(rows[0]?.n ?? 0)
}

export async function countCampaignDrain(db: Database, campaignId: string): Promise<DrainCounts> {
  const { rows } = await db.query(
    `select (count(*) filter (where status = 'pending'))::int as pending,
            (count(*) filter (where status = 'sent'))::int as delivered,
            (count(*) filter (where status = 'failed'))::int as failed,
            (count(*))::int as total
       from public.newsletter_deliveries
      where campaign_id = $1`,
    [campaignId],
  )
  const row = rows[0] ?? {}
  return {
    pending: Number(row.pending ?? 0),
    delivered: Number(row.delivered ?? 0),
    failed: Number(row.failed ?? 0),
    total: Number(row.total ?? 0),
  }
}

/** Create one delivery row per active subscriber, set-based. */
export async function seedDeliveries(db: Database, campaignId: string): Promise<boolean> {
  await db.query(
    `insert into public.newsletter_deliveries (campaign_id, subscriber_id, status)
     select $1, id, 'pending' from public.newsletter_subscribers
      where unsubscribed_at is null
     on conflict do nothing`,
    [campaignId],
  )
  return (await countActiveSubscribers(db)) > 0
}

/** Reset one campaign's failed deliveries to pending so a retry works. */
export async function requeueFailed(db: Database, campaignId: string): Promise<void> {
  await db.query(
    `update public.newsletter_deliveries set status = 'pending', error = null
      where campaign_id = $1 and status = 'failed'`,
    [campaignId],
  )
}

export interface BatchResult {
  delivered: number
  failed: number
  lastError: string | null
  attempted: number
}

/** Send one batch of pending deliveries. Each row is its own commit, on purpose. */
export async function sendCampaignBatch(
  db: Database,
  mailer: Mailer,
  { campaignId, campaign, baseUrl, from, batchSize = NEWSLETTER_BATCH_SIZE }: {
    campaignId: string
    campaign: CampaignSnapshot
    baseUrl: string
    from: string
    batchSize?: number
  },
): Promise<BatchResult> {
  const { rows } = await db.query(
    `select d.id as delivery_id, s.email, s.unsubscribe_token
       from public.newsletter_deliveries d
       join public.newsletter_subscribers s on s.id = d.subscriber_id
      where d.campaign_id = $1 and d.status = 'pending'
      order by s.subscribed_at
      limit $2`,
    [campaignId, batchSize],
  )

  let delivered = 0
  let failed = 0
  let lastError: string | null = null

  for (const row of rows) {
    try {
      const unsubscribeUrl = `${baseUrl.replace(/\/+$/, '')}/unsubscribe?token=${String(
        row.unsubscribe_token ?? '',
      )}`
      await mailer.sendMail({
        from,
        to: String(row.email ?? ''),
        subject: campaign.subject,
        text: `${campaign.body}\n\n——\nUnsubscribe: ${unsubscribeUrl}`,
      })
      await db.query(
        `update public.newsletter_deliveries set status = 'sent', sent_at = now(), error = null where id = $1`,
        [row.delivery_id],
      )
      delivered += 1
    } catch (error) {
      failed += 1
      lastError = errorText(error)
      await db.query(
        `update public.newsletter_deliveries set status = 'failed', error = $1 where id = $2`,
        [lastError, row.delivery_id],
      )
    }
  }

  return { delivered, failed, lastError, attempted: rows.length }
}

/**
 * Drain one campaign until it is empty or the mailer refuses everything.
 *
 * The caller owns the transaction boundary because there isn't one: each delivery
 * row is its own commit.
 */
export async function drainCampaign(
  db: Database,
  mailer: Mailer,
  options: DrainOptions,
): Promise<DrainCounts> {
  const {
    campaignId,
    campaign,
    baseUrl,
    batchSize = NEWSLETTER_BATCH_SIZE,
    chunkDelayMs = NEWSLETTER_CHUNK_DELAY_MS,
    logger = () => {},
  } = options

  await db.query(
    `update public.newsletter_campaigns set status = 'sending', last_error = null where id = $1`,
    [campaignId],
  )

  for (;;) {
    const { delivered, failed, lastError, attempted } = await sendCampaignBatch(db, mailer, {
      campaignId,
      campaign,
      baseUrl,
      from: options.from,
      batchSize,
    })
    if (attempted === 0) break
    if (failed > 0 && delivered === 0) {
      /* A whole batch refused everything — stop rather than hammer the SMTP
       * server on a misconfigured credential or a revoked key. */
      logger(`newsletter: batch fully refused for campaign ${campaignId}: ${lastError ?? 'unknown error'}`)
      break
    }
    logger(`newsletter: campaign ${campaignId} — sent ${delivered}, failed ${failed} this batch`)
    if (chunkDelayMs > 0) await sleep(chunkDelayMs)
  }

  const counts = await countCampaignDrain(db, campaignId)
  // A campaign with nothing delivered is a failure; a partial send is still a
  // send, with the per-recipient errors recorded on the delivery rows.
  const status = counts.delivered === 0 && counts.failed > 0 ? 'failed' : 'sent'

  await db.query(
    `update public.newsletter_campaigns
        set status = $2,
            sent_at = now(),
            delivered = $3,
            failed = $4,
            recipients = $5,
            last_error = case when $3 > 0 then null else $6 end
      where id = $1`,
    [
      campaignId,
      status,
      counts.delivered,
      counts.failed,
      counts.total,
      counts.delivered === 0
        ? 'All deliveries failed; see newsletter_deliveries for the error per recipient.'
        : null,
    ],
  )

  /* Stamp the last-send time on every subscriber this campaign actually reached,
   * so the list page answers "who has heard from us lately". */
  await db.query(
    `update public.newsletter_subscribers s
        set last_sent_at = now()
      from public.newsletter_deliveries d
      where d.campaign_id = $1 and d.subscriber_id = s.id and d.status = 'sent'`,
    [campaignId],
  )

  return counts
}