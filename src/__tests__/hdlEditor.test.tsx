import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import HDLEditor from '../components/ecad/HDLEditor'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import { dropLibraryItem } from './helpers/libraryDrop'
import { snippetCatalog } from '../lib/library/elementCatalogs'
import type { LibraryItem } from '../lib/library/types'

describe('HDLEditor', () => {
  beforeEach(() => {
    useAppStore.setState({ demoRequest: null })
    useProjectStore.setState({ domainDesigns: {} })
  })

  it('elaborates and simulates the default half adder', async () => {
    render(<HDLEditor />)

    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    expect(await screen.findByText(/Parsed module: half_adder/)).toBeInTheDocument()
    expect(await screen.findByText(/Digital simulation/)).toBeInTheDocument()
  })

  it('runs the accumulator CPU demo with expanded buses and a generated clock', async () => {
    useAppStore.setState({ demoRequest: 'hdl-acc-cpu' })

    render(<HDLEditor />)

    expect(await screen.findByText(/Parsed module: acc_cpu/)).toBeInTheDocument()
    expect(screen.getByText(/Expanded to 21 scalar bit nets/)).toBeInTheDocument()
    expect(screen.getByText(/Generated functional clock: clk/)).toBeInTheDocument()
    expect(screen.getByText(/Digital simulation \(0–\d+ time units, [1-9][0-9]* events\)/)).toBeInTheDocument()
    expect(screen.getByText(/acc\[0\]/)).toBeInTheDocument()
  })

  it('runs the FIR DSP demo through its arithmetic datapath', async () => {
    useAppStore.setState({ demoRequest: 'hdl-fir-dsp' })

    render(<HDLEditor />)

    expect(await screen.findByText(/Parsed module: fir4/)).toBeInTheDocument()
    expect(screen.getByText(/Expanded to \d+ scalar bit nets/)).toBeInTheDocument()
    expect(screen.getByText(/Digital simulation/)).toBeInTheDocument()
    expect(screen.getByText(/y\[0\]/)).toBeInTheDocument()
  })

  it('auto-runs when the gallery requests it and drives the half adder inputs', async () => {
    useAppStore.setState({ demoRequest: 'hdl-half-adder' })

    render(<HDLEditor />)

    expect(await screen.findByText(/Digital simulation/)).toBeInTheDocument()
    // No stimulus means every node stays X and the run has zero events; the
    // demo must produce real transitions instead.
    expect(screen.getByText(/Auto testbench: a, b driven as a binary count/)).toBeInTheDocument()
    expect(screen.getByText(/Digital simulation \(0–20 time units, [1-9][0-9]* events\)/)).toBeInTheDocument()
    await waitFor(() => expect(useAppStore.getState().demoRequest).toBeNull())
  })
})

/**
 * The HDL buffer is a drop target for snippet rows. It inserts at the caret
 * through the same commit path typing uses, and refuses rows it could not parse
 * rather than pouring another language into the module on screen.
 */
describe('HDLEditor library drops', () => {
  beforeEach(() => {
    useAppStore.setState({ demoRequest: null, armedLibraryItem: null })
    useProjectStore.setState({ domainDesigns: {} })
  })

  const source = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'HDL source' }) as HTMLTextAreaElement

  const editorZone = (): HTMLElement => {
    const zone = source().closest('.cad-dropzone')
    if (!zone) throw new Error('the editor pane is not a drop zone')
    return zone as HTMLElement
  }

  const snippetRow = (id: string): LibraryItem => {
    const row = snippetCatalog().find((item) => item.id === id)
    if (!row) throw new Error(`catalog row ${id} is gone`)
    return row
  }

  it('inserts a Verilog row at the caret and says what it put there', () => {
    render(<HDLEditor />)

    const area = source()
    area.setSelectionRange(0, 0)
    dropLibraryItem(editorZone(), snippetRow('hdl-mux2'))

    expect(source().value.startsWith('// 2:1 multiplexer, structural')).toBe(true)
    expect(source().value).toContain('endmodule')
    expect(screen.getByText(/"2-input mux \(structural\)" inserted at the caret\./)).toBeInTheDocument()
  })

  it('refuses firmware, which this parser would not elaborate', async () => {
    render(<HDLEditor />)

    const before = source().value
    dropLibraryItem(editorZone(), snippetRow('fw-arduino-blink'))

    expect(await screen.findByText(/is C firmware — the embedded editor takes it, not this HDL buffer\./)).toBeInTheDocument()
    expect(source().value).toBe(before)
  })

  it('refuses a VHDL row while the buffer is on Verilog', async () => {
    render(<HDLEditor />)

    dropLibraryItem(editorZone(), snippetRow('hdl-full-adder-vhdl'))

    expect(await screen.findByText(/is VHDL and this buffer is VERILOG — switch the language first, then drop it\./)).toBeInTheDocument()
    expect(source().value).not.toContain('full_adder')
  })

  it('spends an armed row through the Place button and disarms it', async () => {
    useAppStore.setState({ armedLibraryItem: snippetRow('hdl-dff') })

    render(<HDLEditor />)

    expect(await screen.findByText(/— drop it on the editor or place it here\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Place' }))

    expect(await screen.findByText(/"D flip-flop with reset" inserted at the caret\./)).toBeInTheDocument()
    expect(source().value).toContain('module dff')
    expect(useAppStore.getState().armedLibraryItem).toBeNull()
  })
})
