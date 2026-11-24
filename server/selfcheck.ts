#!/usr/bin/env node
/**
 * End-to-end smoke check for the local backend.
 *
 * Talks to a running stack (`npm run backend`) through the same HTTP surface the
 * app uses, and asserts the properties that matter, in order:
 *
 *   health → sign up two users → write via REST as one → RLS hides it from the
 *   other → PATCH rename → viewer project quota fires at the database (the fourth
 *   insert is refused by the trigger, not by the app) → HEAD count → non-operator
 *   RPC refused → research tool passes real bytes and refuses junk → wrong
 *   password refused → sign out → sign back in → cleanup.
 *
 * Exits 0 when every step passes, 1 otherwise. The selfcheck users remain in the
 * local dev database; `npm run backend:reset` gives a truly clean room.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const BASE = process.env.FOLIO_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.FOLIO_ANON_KEY ?? 'folio-local-dev-anon-key'

interface ApiResponse {
  status: number
  body: unknown
  headers: Headers
}

interface ApiOptions {
  token?: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}

let failures = 0

function ok(label: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok ' : 'FAIL'} ${label}${condition || !detail ? '' : ` — ${detail}`}`)
  if (!condition) failures += 1
}

async function api(path: string, options: ApiOptions = {}): Promise<ApiResponse> {
  const { token, method = 'GET', body, headers = {} } = options
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}`, apikey: ANON_KEY } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? (JSON.parse(text) as unknown) : null
  } catch {
    parsed = text
  }
  return { status: response.status, body: parsed, headers: response.headers }
}

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : []

async function main(): Promise<void> {
  const stamp = Date.now()
  const emailA = `selfcheck-a-${stamp}@folio.test`
  const emailB = `selfcheck-b-${stamp}@folio.test`
  const password = 'selfcheck-pw-2026'

  console.log(`selfcheck against ${BASE}`)

  const health = await api('/healthz')
  ok(
    'health endpoint responds (and reports the database mode)',
    health.status === 200 && asRecord(health.body).ok === true,
    JSON.stringify(health.body),
  )

  const signupA = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email: emailA, password, data: { full_name: 'Selfcheck A' } },
  })
  ok(
    'user A signs up (session issued)',
    signupA.status === 200 && typeof asRecord(signupA.body).access_token === 'string',
    JSON.stringify(signupA.body).slice(0, 160),
  )
  const signupB = await api('/auth/v1/signup', { method: 'POST', body: { email: emailB, password } })
  ok(
    'user B signs up (session issued)',
    signupB.status === 200 && typeof asRecord(signupB.body).access_token === 'string',
  )

  const tokenA = asRecord(signupA.body).access_token as string | undefined
  const tokenB = asRecord(signupB.body).access_token as string | undefined
  const idA = asRecord(asRecord(signupA.body).user).id

  const insert = await api('/rest/v1/projects', {
    token: tokenA,
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: {
      user_id: idA,
      name: 'selfcheck project',
      description: 'created by server/selfcheck.ts',
    },
  })
  const inserted = asArray(insert.body)
  ok(
    'A inserts a project (RLS allows own row)',
    insert.status === 201 && inserted.length > 0 && Boolean(inserted[0]?.id),
    `status ${insert.status}: ${JSON.stringify(insert.body).slice(0, 160)}`,
  )
  const projectId = inserted[0]?.id

  const listA = await api('/rest/v1/projects?select=id,name', { token: tokenA })
  const listAAsArray = asArray(listA.body)
  ok(
    'A sees exactly the project they made',
    listA.status === 200 && listAAsArray.length === 1 && listAAsArray[0]?.id === projectId,
  )

  const listB = await api('/rest/v1/projects?select=id,name', { token: tokenB })
  ok(
    'B sees nothing of A (RLS hides it)',
    listB.status === 200 && asArray(listB.body).length === 0,
    `B saw: ${JSON.stringify(listB.body).slice(0, 160)}`,
  )

  const renamed = await api(`/rest/v1/projects?id=eq.${String(projectId)}`, {
    token: tokenA,
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: { name: 'selfcheck project (renamed)' },
  })
  const renamedRows = asArray(renamed.body)
  ok(
    'A patches their own project',
    renamed.status === 200 && renamedRows[0]?.name === 'selfcheck project (renamed)',
    `status ${renamed.status}: ${JSON.stringify(renamed.body).slice(0, 160)}`,
  )

  // Viewer quota: the migration allows 3 projects per viewer. A already has 1;
  // two more fit, the fourth overall is refused by enforce_project_quota().
  let refusedAt: number | null = null
  for (let index = 0; index < 3; index += 1) {
    const attempt = await api('/rest/v1/projects', {
      token: tokenA,
      method: 'POST',
      body: { user_id: idA, name: `selfcheck filler ${index}` },
    })
    if (attempt.status !== 201) refusedAt = index
  }
  ok(
    'viewer project quota fires at the database (4th insert refused by the trigger)',
    refusedAt === 2,
    `refused at attempt ${String(refusedAt)}`,
  )

  const head = await api(`/rest/v1/projects?user_id=eq.${String(idA)}`, {
    token: tokenA,
    method: 'HEAD',
    headers: { prefer: 'count=exact' },
  })
  const total = Number.parseInt((head.headers.get('content-range') ?? '').split('/')[1] ?? '', 10)
  ok(
    'HEAD with count=exact reports 3 projects',
    head.status === 200 && total === 3,
    `content-range: ${head.headers.get('content-range')}`,
  )

  const rpcRefused = await api('/rest/v1/rpc/admin_deployment_stats', {
    token: tokenA,
    method: 'POST',
    body: {},
  })
  ok(
    'deployment stats refused for a viewer (security definer gate holds)',
    rpcRefused.status === 400,
    `status ${rpcRefused.status}: ${JSON.stringify(rpcRefused.body).slice(0, 160)}`,
  )

  // The research endpoint must pass through real bytes, refuse junk, and stay
  // bounded — verified against a fixture server, never the open internet.
  const fixtureBody = 'FIXTURE DATASHEET: ref in data must reach Folio verbatim — 10uF X7R 16V'
  const fixture = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(fixtureBody)
  })
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
  const fixturePort = (fixture.address() as AddressInfo).port

  try {
    const research = await api(
      `/tools/fetch-text?url=${encodeURIComponent(
        `http://127.0.0.1:${fixturePort}/datasheet.txt`,
      )}`,
      { token: tokenA },
    )
    ok(
      'research tool fetches and returns bounded text',
      research.status === 200 && String(asRecord(research.body).text ?? '').includes('10uF'),
    )

    const junk = await api(
      `/tools/fetch-text?url=${encodeURIComponent('file:///etc/passwd')}`,
      { token: tokenA },
    )
    ok('research tool refuses non-http(s) URLs', junk.status === 400)
  } finally {
    fixture.close()
  }

  const wrong = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: emailA, password: 'wrong-password' },
  })
  ok(
    'wrong password refused with invalid_grant',
    wrong.status === 400 && asRecord(wrong.body).error === 'invalid_grant',
  )

  const logout = await api('/auth/v1/logout', { token: tokenA, method: 'POST' })
  ok('sign out responds 204', logout.status === 204)

  const reauthed = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: emailA, password },
  })
  ok(
    'A signs back in',
    reauthed.status === 200 && typeof asRecord(reauthed.body).access_token === 'string',
  )

  const cleanup = await api(`/rest/v1/projects?user_id=eq.${String(idA)}`, {
    token: asRecord(reauthed.body).access_token as string | undefined,
    method: 'DELETE',
    headers: { prefer: 'return=representation' },
  })
  ok(
    'cleanup removes the projects this run created',
    cleanup.status === 200 && asArray(cleanup.body).length === 3,
    `status ${cleanup.status}: ${JSON.stringify(cleanup.body).slice(0, 200)}`,
  )

  console.log(failures === 0 ? 'selfcheck passed' : `selfcheck FAILED (${failures})`)
  process.exit(failures === 0 ? 0 : 1)
}

void main().catch((error: unknown) => {
  console.error('selfcheck crashed:', error instanceof Error ? error.message : error)
  process.exit(1)
})