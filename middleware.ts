/**
 * Emits the production Content-Security-Policy with a fresh nonce per
 * request. In development there is no CSP (fast refresh needs eval) and the
 * static security headers in next.config.mjs are the whole story.
 *
 * The nonce is what makes `script-src 'self'` survivable for the App
 * Router: Next applies the nonce automatically to the scripts it generates
 * when it sees one in the CSP/request header, and `strict-dynamic` lets
 * those trusted scripts load the ones they need. No `unsafe-inline` for
 * scripts, anywhere.
 */
import { NextResponse, type NextRequest } from 'next/server'

export const config = {
  matcher: ['/((?!api|.*\\..*|_next/static|_next/image).*)'],
}

/* A deployment's own backend may speak plain http on localhost (the
 * self-hosted PGlite/PostgREST shape), or https wherever else. Point
 * connect-src at exactly that origin — nothing broader. Local model
 * providers (Ollama, LM Studio, llama.cpp) are also plain http on the
 * loopback interface; a cloud-only CSP would block the bring-your-own-key
 * path. Those two entries are the only non-TLS origins allowed. Loopback is
 * given by hostname or `127.0.0.1` because a CSP source expression cannot
 * match a literal IPv6 address; `localhost` still resolves over IPv6. */
const backendOrigin = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  if (!raw) return null
  try {
    return new URL(raw).origin
  } catch {
    return null
  }
})()

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next()

  const nonceBytes = new Uint8Array(16)
  crypto.getRandomValues(nonceBytes)
  const nonce = btoa(Array.from(nonceBytes, (byte) => String.fromCharCode(byte)).join(''))

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:*${backendOrigin ? ` ${backendOrigin}` : ''}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `manifest-src 'self'`,
  ].join('; ')

  /* Next reads the nonce from the CSP in the *request* headers and stamps it
   * onto every script it generates (framework chunks and the inline RSC
   * payload scripts), so both the request and the response carry the header. */
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}
