/**
 * Formatting and download helpers for the console.
 *
 * These are plain functions, not components, so they live apart from
 * `shared.tsx`: a module that mixes components and helpers defeats React Fast
 * Refresh, and the lint gate rejects it.
 */
import { toCsv } from '../lib/csv'
import { ADMIN_ROLES, ROLE_LABELS, type AdminRole } from '../lib/admin/quotaPolicy'

export function formatTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown'
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export function formatDay(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown'
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
  })
}

/** Roles arrive as strings from an aggregate; an unknown one is shown verbatim. */
export function roleLabel(role: string): string {
  if (role === 'user') return 'Unassigned'
  return (ADMIN_ROLES as readonly string[]).includes(role) ? ROLE_LABELS[role as AdminRole] : role
}

export function downloadCsv(filename: string, header: string[], rows: string[][]): void {
  const csv = toCsv(header, rows)
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking in the same task can cancel the download before it starts.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}