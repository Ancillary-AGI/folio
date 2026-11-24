import { beforeEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useProjectStore } from '../stores/useProjectStore'
import { loadDomainDesign, usePublishDomainDesign } from '../lib/project/domainDesign'

interface ProbeDesign {
  value: number
  label: string
}

function Probe() {
  const saved = loadDomainDesign<ProbeDesign>('probe')
  const [value, setValue] = useState(saved?.value ?? 1)
  const [label, setLabel] = useState(saved?.label ?? 'default')
  usePublishDomainDesign<ProbeDesign>('probe', { value, label }, (next) => {
    setValue(next.value)
    setLabel(next.label)
  })
  return (
    <button type="button" onClick={() => setValue(value + 1)}>
      {value}:{label}
    </button>
  )
}

describe('domain design persistence', () => {
  beforeEach(() => {
    useProjectStore.setState({ domainDesigns: {} })
  })

  it('publishes panel inputs into the project store and adopts restores', async () => {
    render(<Probe />)
    await waitFor(() => expect(useProjectStore.getState().domainDesigns.probe).toEqual({ value: 1, label: 'default' }))

    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(useProjectStore.getState().domainDesigns.probe).toEqual({ value: 2, label: 'default' }))

    // A VCS checkout replaces the whole bag; the mounted panel must adopt it
    // instead of republishing its pre-restore state.
    act(() => useProjectStore.getState().setDomainDesign('probe', { value: 9, label: 'restored' }))
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('9:restored'))
    expect(useProjectStore.getState().domainDesigns.probe).toEqual({ value: 9, label: 'restored' })
  })

  it('hydrates from a design saved before the panel mounted', () => {
    useProjectStore.setState({ domainDesigns: { probe: { value: 7, label: 'saved' } } })
    render(<Probe />)
    expect(screen.getByRole('button')).toHaveTextContent('7:saved')
  })
})
