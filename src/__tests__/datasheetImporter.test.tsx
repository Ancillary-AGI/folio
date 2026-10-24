import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import DatasheetImporter from '../components/ecad/DatasheetImporter'
import { useAppStore } from '../stores/useAppStore'

beforeEach(() => useAppStore.setState({ demoRequest: null }))
afterEach(cleanup)

describe('DatasheetImporter', () => {
  it('parses the demo datasheet and synthesizes a part on open', () => {
    useAppStore.setState({ demoRequest: 'datasheet-demo' })
    render(
      <StrictMode>
        <DatasheetImporter />
      </StrictMode>,
    )

    expect(screen.getByText('MCP3008-I/SL')).toBeInTheDocument()
    expect(screen.getByText(/16 pins/)).toBeInTheDocument()
    expect(screen.getByText(/2.7–5.5 V/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('VDD')).toBeInTheDocument()
    expect(screen.getByText(/Generated SPICE stub/)).toBeInTheDocument()
    expect(useAppStore.getState().demoRequest).toBeNull()
  })
})
