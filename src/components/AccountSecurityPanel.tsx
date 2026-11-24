'use client'

/**
 * Account security: passkeys and time-based one-time passwords.
 *
 * Both are Supabase Auth features, so the same code runs against the hosted
 * project and the bundled local backend — but the local backend implements
 * neither endpoint, so the panel reports that honestly instead of pretending a
 * credential was stored.
 *
 * Passkeys are phishing-resistant by construction: the private key never leaves
 * the platform authenticator, and the signature is scoped to the relying party,
 * so a look-alike site cannot replay it. TOTP is the fallback for a device with
 * no biometric or PIN unlock.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Fingerprint, KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import HoverHelp from './ui/HoverHelp'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { supabase } from '../lib/supabase'

interface PasskeyItem {
  id: string
  friendly_name?: string | null
  created_at?: string
  last_used_at?: string | null
}

interface TotpFactor {
  id: string
  friendly_name?: string
  created_at?: string
  status?: string
}

const messageOf = (error: unknown): string =>
  String(error instanceof Error ? error.message : error)

/** True when the server answered "this deployment has no such endpoint". */
const isUnavailable = (error: unknown): boolean => {
  const message = messageOf(error).toLowerCase()
  return message.includes('404') || message.includes('not found') || message.includes('not implemented')
}

export default function AccountSecurityPanel() {
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([])
  const [factors, setFactors] = useState<TotpFactor[]>([])
  const [loading, setLoadating] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadating(true)
    setNotice(null)
    try {
      const [passkeyResult, factorResult] = await Promise.all([
        supabase.auth.passkey.list(),
        supabase.auth.mfa.listFactors(),
      ])
      if (passkeyResult.error) {
        setUnavailable(
          isUnavailable(passkeyResult.error)
            ? 'This deployment does not provide the passkey API.'
            : messageOf(passkeyResult.error),
        )
      }
      if (factorResult.error) {
        setUnavailable((current) => current ?? (
          isUnavailable(factorResult.error)
            ? 'This deployment does not provide the multi-factor API.'
            : messageOf(factorResult.error)
        ))
      }
      setPasskeys((passkeyResult.data ?? []) as PasskeyItem[])
      setFactors(((factorResult.data?.totp ?? []) as TotpFactor[]))
    } catch (error) {
      setUnavailable(messageOf(error))
    } finally {
      setLoadating(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const addPasskey = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await supabase.auth.registerPasskey()
      if (result.error) {
        setNotice({ kind: 'error', text: messageOf(result.error) })
      } else {
        setNotice({ kind: 'ok', text: 'Passkey added to this account.' })
        await load()
      }
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const removePasskey = async (passkeyId: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await supabase.auth.passkey.delete({ passkeyId })
      if (result.error) {
        setNotice({ kind: 'error', text: messageOf(result.error) })
      } else {
        setNotice({ kind: 'ok', text: 'Passkey removed.' })
        await load()
      }
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const enrolTotp = async () => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' })
      if (result.error) {
        setNotice({ kind: 'error', text: messageOf(result.error) })
        return
      }
      const factor = result.data
      const uri = (factor as { totp?: { uri?: string; qr_code?: string } }).totp
      /* The secret is shown once. The panel deliberately does not persist it —
     * storing the shared secret alongside the factor would defeat the factor. */
      setNotice({
        kind: 'ok',
        text: uri?.uri
          ? `Add this to your authenticator app: ${uri.uri}`
          : 'Factor created. Enter the 6-digit code to confirm it.',
      })
      await load()
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const unenrolFactor = async (factorId: string) => {
    setBusy(true)
    setNotice(null)
    try {
      const result = await supabase.auth.mfa.unenroll({ factorId })
      if (result.error) {
        setNotice({ kind: 'error', text: messageOf(result.error) })
      } else {
        setNotice({ kind: 'ok', text: 'Authenticator removed.' })
        await load()
      }
    } catch (error) {
      setNotice({ kind: 'error', text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Account security</h2>
        <p className="text-xs text-muted-foreground">
          Passkeys are phishing-resistant and need no password. An authenticator app is the
          fallback for devices without a screen lock.
        </p>
      </div>

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`rounded border p-2 text-xs ${
            notice.kind === 'error'
              ? 'border-destructive/40 bg-destructive/10 text-destructive'
              : 'border-success/40 bg-success/10 text-success'
          }`}
        >
          {notice.text}
        </p>
      )}

      {unavailable && (
        <p role="alert" className="rounded border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          {unavailable}
        </p>
      )}

      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs flex items-center gap-1">
            <Fingerprint className="h-3 w-3" aria-hidden="true" /> Passkeys
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {loading ? (
            <p className="text-xs text-muted-foreground">Reading…</p>
          ) : passkeys.length === 0 ? (
            <p className="text-xs text-muted-foreground">No passkeys on this account yet.</p>
          ) : (
            <ul className="space-y-1">
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {passkey.friendly_name ?? 'Passkey'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {passkey.last_used_at ? `Last used ${passkey.last_used_at}` : 'Not used yet'}
                    </p>
                  </div>
                  <HoverHelp
                    title={`Remove ${passkey.friendly_name ?? 'this passkey'}`}
                    description="Delete this passkey. You will need another way in — a password or an authenticator — afterwards."
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void removePasskey(passkey.id)}
                      aria-label={`Remove ${passkey.friendly_name ?? 'passkey'}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </HoverHelp>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" disabled={busy} onClick={() => void addPasskey()}>
            <KeyRound className="h-4 w-4" aria-hidden="true" /> Add a passkey
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Authenticator app (TOTP)
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {factors.length === 0 ? (
            <p className="text-xs text-muted-foreground">No authenticator enrolled.</p>
          ) : (
            <ul className="space-y-1">
              {factors.map((factor) => (
                <li key={factor.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-foreground">
                    {factor.friendly_name ?? 'Authenticator'}
                  </span>
                  <HoverHelp
                    title={`Remove ${factor.friendly_name ?? 'this authenticator'}`}
                    description="Delete this authenticator. Without it, and without a passkey, only your password will sign you in."
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void unenrolFactor(factor.id)}
                      aria-label={`Remove ${factor.friendly_name ?? 'authenticator'}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </HoverHelp>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void enrolTotp()}>
            <AlertCircle className="h-4 w-4" aria-hidden="true" /> Enrol an authenticator
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}