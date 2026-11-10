/**
 * Operator identity for the admin console.
 *
 * The console is a separate application (`admin.html`) for the people who run
 * Folio and manage the accounts that use it. It never shares the workbench's
 * session: its client persists under its own storage key, so signing in here
 * cannot sign a designer into governance and a designer's session cannot open
 * this console. Authority is the `profiles` row the server holds — owner or
 * administrator, active — and every table the console reads is restricted to
 * those roles by row-level security, so a refused client is refused by the
 * database too.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cloudConfig, isSupabaseConfigured } from '../cloudConfig'
import { isAdminRole, type AdminRole } from './quotaPolicy'

export const OPERATOR_STORAGE_KEY = 'folio.operator.session'

export interface Operator {
  id: string
  name: string
  email: string
  role: Extract<AdminRole, 'owner' | 'admin'>
}

export interface OperatorResolution {
  operator: Operator | null
  /** Why access was refused, in the operator's own words. Never a guess. */
  reason?: string
}

let client: SupabaseClient | null = null

/** Null when this build has no managed deployment to govern. */
export function operatorClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null
  if (!client) {
    client = createClient(cloudConfig.url!, cloudConfig.anonKey!, {
      auth: {
        storageKey: OPERATOR_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        // The console is not an OAuth redirect target; a `#access_token` in the
        // address bar must not be adopted as an operator session.
        detectSessionInUrl: false,
      },
    })
  }
  return client
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read the signed-in account's governance row and decide whether it may operate. */
export async function resolveOperator(db: SupabaseClient): Promise<OperatorResolution> {
  let userId: string
  let email: string
  try {
    const { data, error } = await db.auth.getUser()
    if (error || !data.user) {
      return { operator: null, reason: error ? `The operator session could not be read: ${error.message}` : undefined }
    }
    userId = data.user.id
    email = data.user.email ?? ''
  } catch (error) {
    return { operator: null, reason: `Could not reach the identity service: ${describe(error)}` }
  }

  try {
    const { data, error } = await db
      .from('profiles')
      .select('id,email,display_name,role,status')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      return {
        operator: null,
        reason: `The governance schema is unavailable (${error.message}). Apply the admin migration before operating this deployment.`,
      }
    }
    if (!data) {
      return {
        operator: null,
        reason: 'No governance profile exists for this account. An owner must create one in the deployment database.',
      }
    }
    const row = data as Record<string, unknown>
    const role = typeof row.role === 'string' ? row.role : ''
    if (row.status === 'suspended') {
      return { operator: null, reason: 'This account is suspended and cannot operate the deployment.' }
    }
    if (!isAdminRole(role)) {
      return {
        operator: null,
        reason: 'This account uses Folio; it does not operate it. The console is for the people who run the product and manage its accounts.',
      }
    }
    return {
      operator: {
        id: userId,
        name: String(row.display_name || row.email || email || 'Operator'),
        email: String(row.email || email),
        role: role as Operator['role'],
      },
    }
  } catch (error) {
    return { operator: null, reason: `Could not read the account directory: ${describe(error)}` }
  }
}

export async function signInOperator(
  db: SupabaseClient,
  email: string,
  password: string,
): Promise<OperatorResolution & { error?: string }> {
  const address = email.trim()
  if (!address || !password) return { operator: null, error: 'Enter the operator email and password.' }
  try {
    const { error } = await db.auth.signInWithPassword({ email: address, password })
    if (error) {
      // A wrong password and a non-operator account must not be distinguishable
      // to someone probing the console: both end at the same refusal.
      await db.auth.signOut()
      return { operator: null, error: 'Those credentials were not accepted for this deployment.' }
    }
  } catch (error) {
    return { operator: null, error: `Could not reach the identity service: ${describe(error)}` }
  }
  const resolution = await resolveOperator(db)
  if (!resolution.operator) await db.auth.signOut()
  return resolution
}

export async function signOutOperator(db: SupabaseClient): Promise<void> {
  try {
    await db.auth.signOut()
  } catch {
    // A failed remote sign-out still clears the local session below.
  }
  try {
    localStorage.removeItem(OPERATOR_STORAGE_KEY)
  } catch {
    // Storage may be blocked; the in-memory client is already signed out.
  }
}