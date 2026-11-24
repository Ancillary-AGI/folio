'use client'

/**
 * The CAPTCHA widget for public forms.
 *
 * Loads the provider's script on demand and reports the token to the parent.
 * With no site key configured it renders nothing and reports `null`, so the form
 * still works on an unconfigured deployment — the server decides whether an
 * unchallenged write is acceptable.
 *
 * The token is single-use and expires in a few minutes, so the parent must
 * submit promptly and reset after a failure.
 */
import { useEffect, useRef, useState } from 'react'
import { CAPTCHA_SITE_KEY, isCaptchaConfigured } from '../lib/captcha'

interface TurnstileApi {
  render: (element: HTMLElement, options: {
    sitekey: string
    action?: string
    callback?: (token: string) => void
    'expired-callback'?: () => void
    'error-callback'?: () => void
    theme?: 'auto' | 'light' | 'dark'
  }) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_ID = 'folio-captcha-script'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface CaptchaProps {
  /** Called with a fresh token, or `null` when it expires or errors. */
  onToken: (token: string | null) => void
  /** The action name, checked server-side so a token cannot be replayed elsewhere. */
  action?: string
  className?: string
}

export default function Captcha({ onToken, action = 'generic', className }: CaptchaProps) {
  const container = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!isCaptchaConfigured()) return
    const callback = onToken
    let cancelled = false

    const mount = () => {
      if (cancelled || !container.current || !window.turnstile || widgetId.current) return
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: CAPTCHA_SITE_KEY,
        // Bound server-side: a token minted for signup cannot open the
        // newsletter form, or the reverse.
        action,
        theme: 'auto',
        callback: (token) => callback(token),
        'expired-callback': () => callback(null),
        'error-callback': () => { setFailed(true); callback(null) },
      })
    }

    if (window.turnstile) {
      mount()
    } else {
      let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
      if (!script) {
        script = document.createElement('script')
        script.id = SCRIPT_ID
        script.src = SCRIPT_SRC
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
      script.addEventListener('load', mount)
      // A script that never arrives must not leave the form waiting forever.
      const timer = window.setTimeout(() => {
        if (!window.turnstile && !cancelled) setFailed(true)
      }, 15000)
      return () => {
        cancelled = true
        window.clearTimeout(timer)
        script?.removeEventListener('load', mount)
      }
    }

    return () => { cancelled = true }
  }, [onToken, action])

  if (!isCaptchaConfigured()) return null

  if (failed) {
    return (
      <p role="alert" className={className} style={{ fontSize: '.75rem', color: '#F58A8A' }}>
        The verification widget could not load. Reload the page to try again.
      </p>
    )
  }

  return <div ref={container} className={className} aria-label="CAPTCHA challenge" />
}