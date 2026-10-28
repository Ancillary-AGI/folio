import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import LimitsDialog from '../components/workspace/LimitsDialog'
import {
  CAPABILITY_RECORDS,
  filterCapabilities,
  type CapabilityRecord,
} from '../lib/workspace/limitsRegistry'

const open = (props: Partial<Parameters<typeof LimitsDialog>[0]> = {}) => {
  const onClose = vi.fn()
  render(<LimitsDialog open onClose={onClose} {...props} />)
  return { onClose }
}

const recordById = (id: string): CapabilityRecord => {
  const record = CAPABILITY_RECORDS.find((entry) => entry.id === id)
  if (!record) throw new Error(`the registry has no record "${id}"`)
  return record
}

/*
 * Rows are found by the accordion contract — the header button controls the body
 * by id — instead of by scanning every accessible name: with 45 rows, a role+name
 * query per record costs tens of seconds and proves no more than this does. The
 * visible title text is asserted separately, so the lookup stays honest.
 */
const triggerById = (id: string): HTMLButtonElement => {
  const trigger = document.querySelector<HTMLButtonElement>(`button[aria-controls="limits-${id}-body"]`)
  if (!trigger) throw new Error(`the "${id}" row is not rendered`)
  return trigger
}

const expectRow = (id: string) => {
  const record = recordById(id)
  const trigger = triggerById(id)
  expect(document.getElementById(`limits-${id}-title`)?.textContent).toBe(record.title)
  return { record, trigger }
}

const rowIsVisible = (id: string) =>
  Boolean(document.querySelector(`button[aria-controls="limits-${id}-body"]`))

describe('LimitsDialog', () => {
  it('renders the registry itself, not a restatement of it', () => {
    open()
    const dialog = screen.getByRole('dialog', { name: /capabilities and limits/i })
    expect(dialog).toBeInTheDocument()
    // The group headers, not the filter chips, prove the registry is rendered.
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Circuit simulation' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Control & ML toolbox' })).toBeInTheDocument()
    for (const record of CAPABILITY_RECORDS) expectRow(record.id)
  })

  it('opens a row to show the method, the limits and the tests that pin them', () => {
    open()
    const { record, trigger } = expectRow('circuit-dc')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const body = within(document.getElementById('limits-circuit-dc-body') as HTMLElement)
    expect(body.getByText(/Not covered/i)).toBeInTheDocument()
    expect(body.getByText(/Pinned by \d+ test files?/i)).toBeInTheDocument()
    // The method and every limit are quoted back verbatim, so the panel cannot
    // soften either of them relative to what the registry says.
    expect(body.getByText(record.method)).toBeInTheDocument()
    for (const line of record.notCovered) expect(body.getByText(line)).toBeInTheDocument()
    for (const path of record.validatedBy) {
      expect(body.getByText(path.replace('src/', ''))).toBeInTheDocument()
    }
  })

  it('expands every match while the engineer is searching a phrase', () => {
    open()
    fireEvent.change(screen.getByPlaceholderText(/search methods/i), { target: { value: 'damped least squares' } })
    expect(expectRow('motion-kinematics').trigger).toHaveAttribute('aria-expanded', 'true')
    expect(rowIsVisible('circuit-dc')).toBe(false)
    expect(screen.getByText(/matches are expanded/i)).toBeInTheDocument()
  })

  it('filters by family and to the current workspace', () => {
    const { onClose } = open({ currentMode: 'control' })
    fireEvent.click(screen.getByRole('button', { name: /Machines & parts/i }))
    expect(rowIsVisible('machine-models')).toBe(true)
    expect(rowIsVisible('circuit-dc')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /^All/i }))
    const checkbox = screen.getByRole('checkbox', { name: /only/i })
    fireEvent.click(checkbox)
    expect(checkbox).toBeChecked()
    const expected = filterCapabilities('all', '', 'control')
    expect(expected.length).toBeGreaterThan(0)
    expect(screen.getByText(/records shown/i).textContent).toContain(`${expected.length} of`)
    for (const record of expected) expectRow(record.id)
    expect(rowIsVisible('circuit-dc')).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps the search and family filter when the host re-renders', () => {
    const { rerender } = render(<LimitsDialog open onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /^Circuit simulation/i }))
    fireEvent.change(screen.getByPlaceholderText(/search methods/i), { target: { value: 'modified nodal' } })
    expect(expectRow('circuit-dc').trigger).toHaveAttribute('aria-expanded', 'true')

    // A new inline close handler is not a new opening; resetting here discarded
    // the engineer's filter and search mid-query.
    rerender(<LimitsDialog open onClose={() => {}} />)

    expect(screen.getByRole('button', { name: /^Circuit simulation/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByPlaceholderText(/search methods/i)).toHaveValue('modified nodal')
    expect(expectRow('circuit-dc').trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes on Escape and on the scrim, and never on the panel itself', () => {
    const { onClose } = open()
    const panel = screen.getByRole('dialog', { name: /capabilities and limits/i })
    fireEvent.mouseDown(panel)
    expect(onClose).not.toHaveBeenCalled()

    const scrim = panel.parentElement as HTMLElement
    fireEvent.mouseDown(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: /close capabilities and limits/i }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('states the standing caveat rather than leaving it implicit', () => {
    open()
    expect(screen.getByText(/validate against measured hardware/i)).toBeInTheDocument()
  })
})
