import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

/*
 * The newsletter transport is a claim the admin console shows to an operator.
 * These tests pin the difference between "a host was typed" and "mail can
 * actually be sent": without a From address the transport stays missing, and
 * the repository never supplies an identity of its own.
 */

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  values as unknown as NodeJS.ProcessEnv

describe('loadConfig — SMTP', () => {
  it('stays unconfigured when only the host is set', () => {
    const config = loadConfig(env({ FOLIO_SMTP_HOST: 'smtp.example.com' }))

    expect(config.smtp.configured).toBe(false)
    expect(config.smtp.from).toBe('')
  })

  it('does not invent a sender address', () => {
    const config = loadConfig(env({}))

    expect(config.smtp.from).toBe('')
    expect(config.smtp.configured).toBe(false)
  })

  it('is configured when both the host and a trimmed From address are set', () => {
    const config = loadConfig(env({
      FOLIO_SMTP_HOST: ' smtp.example.com ',
      FOLIO_SMTP_FROM: ' Example <newsletter@example.com> ',
    }))

    expect(config.smtp.configured).toBe(true)
    expect(config.smtp.host).toBe('smtp.example.com')
    expect(config.smtp.from).toBe('Example <newsletter@example.com>')
  })

  it('keeps the port and TLS defaults for implicit-TLS SMTP', () => {
    const config = loadConfig(env({
      FOLIO_SMTP_HOST: 'smtp.example.com',
      FOLIO_SMTP_FROM: 'newsletter@example.com',
    }))

    expect(config.smtp.port).toBe(465)
    expect(config.smtp.secure).toBe(true)
  })
})
