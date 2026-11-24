/**
 * What the deployment actually accepts for sign-in.
 *
 * The account screen used to print a fixed list of providers, which is a claim
 * about configuration that the bundle cannot make: a self-hosted install may
 * have email only, a hosted project may have OAuth apps, and a fork is not the
 * company that built this one. GoTrue publishes the truth at
 * `/auth/v1/settings`, so the console reads it and renders that.
 */

export interface SignInMethod {
  /** GoTrue's provider key, e.g. `email`, `google`. */
  id: string
  label: string
}

/** Provider keys GoTrue reports in its `external` map, with operator-facing names. */
const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email and password',
  phone: 'Phone and password',
  google: 'Google',
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  azure: 'Microsoft',
  discord: 'Discord',
  facebook: 'Facebook',
  keycloak: 'Keycloak',
  linkedin: 'LinkedIn',
  notion: 'Notion',
  saml: 'SAML single sign-on',
  slack: 'Slack',
  spotify: 'Spotify',
  twitch: 'Twitch',
  twitter: 'X',
  workos: 'WorkOS',
  zoom: 'Zoom',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * Read GoTrue's settings payload. Only providers it marks as enabled are
 * returned; an unknown provider keeps its key as the label rather than
 * disappearing, so a newly supported method is still visible.
 */
export function parseSignInMethods(payload: unknown): SignInMethod[] {
  if (!isRecord(payload) || !isRecord(payload.external)) return []
  const methods: SignInMethod[] = []
  for (const [id, enabled] of Object.entries(payload.external)) {
    if (enabled !== true) continue
    methods.push({ id, label: PROVIDER_LABELS[id] ?? id })
  }
  const rank = (method: SignInMethod): number => (method.id === 'email' ? 0 : method.id === 'phone' ? 1 : 2)
  return methods.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
}

export interface SignInMethodsRequest {
  /** Deployment origin, without a trailing slash. */
  url: string
  anonKey: string
  signal?: AbortSignal
}

/**
 * Ask the deployment which providers it has enabled.
 *
 * A failed request is an error, not an empty list: "this deployment accepts
 * nothing" and "this deployment did not answer" are different statements and
 * only one of them is useful to the person reading the screen.
 */
export async function loadSignInMethods({ url, anonKey, signal }: SignInMethodsRequest): Promise<SignInMethod[]> {
  const response = await fetch(`${url.replace(/\/+$/, '')}/auth/v1/settings`, {
    headers: { apikey: anonKey },
    signal,
  })
  if (!response.ok) {
    throw new Error(`The identity service answered ${response.status}.`)
  }
  return parseSignInMethods(await response.json())
}
