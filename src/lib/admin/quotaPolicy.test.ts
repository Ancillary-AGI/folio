import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_QUOTA_POLICIES,
  QUOTA_STORAGE_KEY,
  checkQuotaCapacity,
  parseQuotaLimit,
  quotaRows,
  readQuotaPolicies,
  resetQuotaPolicies,
  setQuotaPolicy,
  subjectLimits,
  validateQuotaLimits,
  type QuotaUsage,
} from './quotaPolicy'

const usage = (overrides: Partial<QuotaUsage> = {}): QuotaUsage => ({
  projects: 0,
  exportsToday: 0,
  simulationsToday: 0,
  storageMb: 0,
  ...overrides,
})

beforeEach(() => {
  localStorage.clear()
  resetQuotaPolicies()
})

describe('quota policy', () => {
  it('gives owners and administrators unlimited defaults', () => {
    expect(subjectLimits('owner')).toEqual(DEFAULT_QUOTA_POLICIES.owner)
    expect(subjectLimits('admin')).toEqual(DEFAULT_QUOTA_POLICIES.admin)
    expect(DEFAULT_QUOTA_POLICIES.owner.maxProjects).toBeNull()
    expect(DEFAULT_QUOTA_POLICIES.admin.maxExportsPerDay).toBeNull()
  })

  it('treats unassigned accounts as viewers', () => {
    expect(subjectLimits('user')).toEqual(DEFAULT_QUOTA_POLICIES.viewer)
  })

  it('parses edited limits', () => {
    expect(parseQuotaLimit('')).toBeNull()
    expect(parseQuotaLimit('   ')).toBeNull()
    expect(parseQuotaLimit('12')).toBe(12)
    expect(parseQuotaLimit('0')).toBe(0)
    expect(parseQuotaLimit('-1')).toBeUndefined()
    expect(parseQuotaLimit('abc')).toBeUndefined()
  })

  it('rejects invalid limits and refuses to edit privileged roles', () => {
    expect(validateQuotaLimits({ ...DEFAULT_QUOTA_POLICIES.engineer, maxProjects: -2 })).toMatch(/projects/)
    expect(setQuotaPolicy('owner', { ...DEFAULT_QUOTA_POLICIES.owner, maxProjects: 1 })).toMatchObject({ ok: false })
    expect(setQuotaPolicy('admin', { ...DEFAULT_QUOTA_POLICIES.admin, maxProjects: 1 })).toMatchObject({ ok: false })
  })

  it('persists engineer limits and applies them to enforcement', () => {
    const result = setQuotaPolicy('engineer', {
      maxProjects: 2,
      maxExportsPerDay: 5,
      maxSimulationsPerDay: 10,
      maxStorageMb: 100,
    })
    expect(result.ok).toBe(true)
    expect(JSON.parse(localStorage.getItem(QUOTA_STORAGE_KEY) ?? '{}')).toMatchObject({
      engineer: { maxProjects: 2, maxExportsPerDay: 5 },
    })
    expect(subjectLimits('engineer').maxProjects).toBe(2)

    expect(checkQuotaCapacity('project', 'engineer', usage({ projects: 1 }))).toMatchObject({
      allowed: true,
      used: 1,
      limit: 2,
    })
    const blocked = checkQuotaCapacity('project', 'engineer', usage({ projects: 2 }))
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toContain('allows 2 projects')
    expect(checkQuotaCapacity('export', 'engineer', usage({ exportsToday: 5 })).allowed).toBe(false)
    expect(checkQuotaCapacity('simulation', 'engineer', usage({ simulationsToday: 9 })).allowed).toBe(true)
  })

  it('treats zero as an exhausted limit and blank storage as defaults', () => {
    setQuotaPolicy('viewer', { maxProjects: 0, maxExportsPerDay: 0, maxSimulationsPerDay: 0, maxStorageMb: 0 })
    expect(checkQuotaCapacity('export', 'viewer', usage()).allowed).toBe(false)
    expect(checkQuotaCapacity('export', 'viewer', usage({ exportsToday: 0 }))).toMatchObject({ allowed: false, limit: 0 })
  })

  it('ignores unreadable stored policies and keeps defaults', () => {
    localStorage.setItem(QUOTA_STORAGE_KEY, '{not json')
    expect(readQuotaPolicies()).toEqual(DEFAULT_QUOTA_POLICIES)
  })

  it('reports warn and fail states in the quota rows', () => {
    setQuotaPolicy('engineer', { maxProjects: 10, maxExportsPerDay: 10, maxSimulationsPerDay: 10, maxStorageMb: 10 })
    const rows = quotaRows('engineer', usage({ projects: 8, exportsToday: 10, simulationsToday: 0, storageMb: 4 }))
    expect(rows.find((row) => row.id === 'projects')?.status).toBe('warn')
    expect(rows.find((row) => row.id === 'exports')?.status).toBe('fail')
    expect(rows.find((row) => row.id === 'simulations')?.status).toBe('ok')
  })
})
