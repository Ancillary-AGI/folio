/**
 * Outbound mail transport.
 *
 * Built from `SmtpConfig` and nothing else, so the pipeline in `./index.ts` can
 * be driven by a fake in tests. Returns `null` when the transport is incomplete
 * (no host or no From address) — callers treat that as "sending is unavailable",
 * never as success.
 */
import nodemailer, { type Transporter } from 'nodemailer'
import type { SmtpConfig } from '../config'

export type Mailer = Pick<Transporter, 'sendMail'>

/** Build a transport from the configured SMTP settings, or null if unset. */
export function createMailer(smtp: SmtpConfig): Mailer | null {
  if (!smtp.configured || !smtp.host || !smtp.from) return null
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass ?? '' } : undefined,
  })
}