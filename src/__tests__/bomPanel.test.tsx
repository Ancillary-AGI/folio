/**
 * BOMPanel demo audit, notes editing and lifecycle sourcing.
 * The demo BOM is a verified canvas ↔ fab-package cross-check; the panel must
 * surface its verdict and MPNs, and state coverage without over-claiming that
 * two designs are identical. Notes are canvas data, so an edit must land on the
 * components and a discarded edit must not. Lifecycle and availability are the
 * panel's loudest claims, so they are only allowed from data the part declares —
 * an undeclared part must read as Unverified, never as the safe default.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import BOMPanel from '../components/bom/BOMPanel'
import { buildDemoBoard } from '../lib/demo/demoBoard'
import { useProjectStore } from '../stores/useProjectStore'

const loadDemoBoard = () => {
  const board = buildDemoBoard()
  useProjectStore.setState({ components: board.components, wires: board.wires })
  return board
}

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
    loadDemoBoard()
    render(<BOMPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Audit demo BOM' }))

    expect(screen.getByText(/Reference coverage: 5\/5 demo designators/)).toBeInTheDocument()
    expect(screen.getByText('Bill of Materials')).toBeInTheDocument()
  })

  // A BOM row is derived from the canvas, so an edited note only means anything
  // once it is written back onto the component it was aggregated from.
  it('writes an edited note back onto the schematic component', () => {
    loadDemoBoard()
    render(<BOMPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit notes for C1' }))
    const editor = screen.getByRole('textbox', { name: 'Notes for C1' })
    fireEvent.change(editor, { target: { value: 'X7R dielectric only' } })
    fireEvent.keyDown(editor, { key: 'Enter' })

    const saved = useProjectStore.getState().components.find((c) => c.id === 'demo-C1')
    expect(saved?.properties.notes).toBe('X7R dielectric only')
    expect(screen.getByText('X7R dielectric only')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Notes for C1' })).not.toBeInTheDocument()
  })

  it('keeps the canvas untouched when a note edit is discarded', () => {
    loadDemoBoard()
    render(<BOMPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit notes for C1' }))
    const editor = screen.getByRole('textbox', { name: 'Notes for C1' })
    fireEvent.change(editor, { target: { value: 'typed then abandoned' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard note edit for C1' }))

    expect(useProjectStore.getState().components.find((c) => c.id === 'demo-C1')?.properties.notes).toBeUndefined()
    expect(screen.queryByText('typed then abandoned')).not.toBeInTheDocument()
  })
})

describe('BOMPanel lifecycle sourcing', () => {
  beforeEach(() => {
    useProjectStore.setState({ components: [], wires: [] })
  })

  const UNVERIFIED = 'No lifecycle data declared on this part — not the same as being active'
  const ACTIVE = 'Lifecycle from a declared availability of available'

  const declareOn = (declarations: Record<string, Record<string, string | number>>) => {
    const board = buildDemoBoard()
    useProjectStore.setState({
      components: board.components.map((c) =>
        declarations[c.reference] ? { ...c, properties: { ...c.properties, ...declarations[c.reference] } } : c,
      ),
      wires: board.wires,
    })
  }

  // The demo parts declare no availability, so the panel has no evidence that any
  // of them is in production. Green "Active" badges here would be invented
  // reassurance on a board heading to fab.
  it('shows undeclared parts as Unverified rather than defaulting them to Active', () => {
    loadDemoBoard()
    render(<BOMPanel />)

    expect(screen.queryByTitle(ACTIVE)).not.toBeInTheDocument()
    expect(screen.getAllByTitle(UNVERIFIED)).toHaveLength(6)
    expect(screen.getByText(/6 of 6 line items carry none and show as Unverified/)).toBeInTheDocument()
    expect(screen.queryByText(/Every line item here carries a declared status/)).not.toBeInTheDocument()
  })

  it('counts each lifecycle state on its filter so an empty state is visible', () => {
    loadDemoBoard()
    render(<BOMPanel />)

    expect(screen.getByRole('button', { name: /^All/ })).toHaveTextContent('6')
    expect(screen.getByRole('button', { name: /^Active/ })).toHaveTextContent('0')
    expect(screen.getByRole('button', { name: /^Unverified/ })).toHaveTextContent('6')
  })

  it('only calls a part Active when it declares availability', () => {
    declareOn({ C1: { availability: 'available' } })
    render(<BOMPanel />)

    expect(screen.getByTitle(ACTIVE)).toBeInTheDocument()
    expect(screen.getByTitle('Part declares availability: available')).toBeInTheDocument()
    expect(screen.getAllByTitle(UNVERIFIED)).toHaveLength(5)

    fireEvent.click(screen.getByRole('button', { name: /^Active/ }))
    expect(screen.getByText('Capacitor')).toBeInTheDocument()
    expect(screen.queryByText('Resistor')).not.toBeInTheDocument()
  })

  it('treats a declared lead time as its own evidence and an obsolete part as a risk', () => {
    declareOn({ RLOAD: { leadTime: 45 }, D1: { availability: 'obsolete' } })
    render(<BOMPanel />)

    expect(screen.getByTitle('No availability declared, but the part declares a lead time')).toBeInTheDocument()
    expect(screen.getByTitle('Lifecycle from a declared obsolete availability')).toBeInTheDocument()
    expect(screen.getByText(/1 part with NRND or Obsolete lifecycle status detected/)).toBeInTheDocument()
    expect(screen.getByText(/5 of 6 line items carry none/)).toBeInTheDocument()
  })

  it('flags an NRND-declared part without ever calling it active', () => {
    declareOn({ RSRC: { availability: 'nrnd' } })
    render(<BOMPanel />)

    expect(screen.getByTitle('Lifecycle from a declared limited / NRND availability')).toBeInTheDocument()
    expect(screen.queryByTitle(ACTIVE)).not.toBeInTheDocument()
  })

  it('says so plainly when every line item carries a declared status', () => {
    const board = buildDemoBoard()
    useProjectStore.setState({
      components: board.components.map((c) => ({ ...c, properties: { ...c.properties, availability: 'available' } })),
      wires: board.wires,
    })
    render(<BOMPanel />)

    expect(screen.getByText(/Every line item here carries a declared status/)).toBeInTheDocument()
    expect(screen.getAllByTitle(ACTIVE)).toHaveLength(6)
    expect(screen.queryAllByTitle(UNVERIFIED)).toHaveLength(0)
  })
})
