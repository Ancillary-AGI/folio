/**
 * BOMPanel demo audit.
 * The demo BOM is a verified canvas ↔ fab-package cross-check; the panel must
 * surface its verdict and MPNs, and state coverage without over-claiming that
 * two designs are identical.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import BOMPanel from '../components/bom/BOMPanel'
import { buildDemoBoard } from '../lib/demo/demoBoard'
import { useProjectStore } from '../stores/useProjectStore'

describe('BOMPanel demo audit', () => {
  beforeEach(() => {
    useProjectStore.setState({ components: [], wires: [] })
  })

  it('reports the fab-audited demo BOM with MPNs and no canvas coverage claim', () => {
    render(<BOMPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Audit demo BOM' }))

    expect(screen.getByRole('status')).toHaveTextContent(/PASS: 5 BOM lines/)
    expect(screen.getByText(/No canvas parts to compare/)).toBeInTheDocument()
    expect(screen.getByText('1N5817')).toBeInTheDocument()
    expect(screen.getByText('V1')).toBeInTheDocument()
  })

  it('reports reference coverage when the demo board is loaded', () => {
    const board = buildDemoBoard()
    useProjectStore.setState({ components: board.components, wires: board.wires })
    render(<BOMPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Audit demo BOM' }))

    expect(screen.getByText(/Reference coverage: 5\/5 demo designators/)).toBeInTheDocument()
    expect(screen.getByText('Bill of Materials')).toBeInTheDocument()
  })
})
