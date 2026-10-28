import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AdminConsole from '../components/admin/AdminConsole'
import type { User } from '../types'
import { resetUsageLedger } from '../lib/admin/usageLedger'

/*
 * A failed mirror means the cloud never saw the event, even though the local
 * ledger did. The console must say so rather than leave the two reports looking
 * consistent; this test forces the environment report to carry that failure.
 */
vi.mock('../lib/admin/adminService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/admin/adminService')>()
  return {
    ...actual,
    loadEnvironment: async () => ({
      ...(await actual.loadEnvironment()),
      cloudUsageMirrorError: 'permission denied for table usage_events',
    }),
  }
})

const owner: User = { id: 'owner-1', name: 'Local User', email: 'local@offline', role: 'owner' }

beforeEach(() => {
  localStorage.clear()
  resetUsageLedger()
})

describe('administration usage mirror', () => {
  it('reports a failed cloud mirror instead of implying the cloud saw the event', async () => {
    render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Administration' })
    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }))

    expect(await screen.findByText(/The last usage mirror failed/)).toHaveTextContent(
      'permission denied for table usage_events',
    )
  })
})
