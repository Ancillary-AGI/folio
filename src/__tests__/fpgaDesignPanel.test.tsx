/**
 * The FPGA workspace's library surface.
 *
 * This panel is the only route from an HDL source to a manufactured-looking
 * manifest, so its drop target has to be judged by the same rule as its
 * elaborator: a row the flow cannot synthesise must be refused in words, not
 * poured into the buffer and left there as a broken design.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import FPGADesignPanel from '../components/fpga/FPGADesignPanel'
import { dropLibraryItem } from './helpers/libraryDrop'
import { snippetCatalog } from '../lib/library/elementCatalogs'
import { libraryForMode } from '../lib/library/catalog'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import type { LibraryItem } from '../lib/library/types'

describe('FPGADesignPanel library drops', () => {
  beforeEach(() => {
    useAppStore.setState({ demoRequest: null, armedLibraryItem: null })
    useProjectStore.setState({ domainDesigns: {} })
  })

  const source = (): HTMLTextAreaElement =>
    screen.getByRole('textbox', { name: 'HDL source' }) as HTMLTextAreaElement

  const editorZone = (): HTMLElement => {
    const zone = source().closest('.cad-dropzone')
    if (!zone) throw new Error('the source box is not a drop zone')
    return zone as HTMLElement
  }

  const snippetRow = (id: string): LibraryItem => {
    const row = snippetCatalog().find((item) => item.id === id)
    if (!row) throw new Error(`catalog row ${id} is gone`)
    return row
  }

  it('elaborates the demo source on first render', () => {
    render(<FPGADesignPanel />)

    expect(screen.getByRole('button', { name: /Generate design manifest/ })).toBeEnabled()
    expect(screen.getByText(/Gates \d+ → LUT estimate/)).toBeInTheDocument()
  })

  it('inserts a Verilog row at the caret and says what it put there', () => {
    render(<FPGADesignPanel />)

    const area = source()
    area.setSelectionRange(0, 0)
    dropLibraryItem(editorZone(), snippetRow('hdl-mux2'))

    expect(source().value.startsWith('// 2:1 multiplexer, structural')).toBe(true)
    expect(screen.getByText(/"2-input mux \(structural\)" inserted at the caret\./)).toBeInTheDocument()
  })

  it('refuses firmware, which no FPGA flow synthesises', async () => {
    render(<FPGADesignPanel />)

    const before = source().value
    dropLibraryItem(editorZone(), snippetRow('fw-arduino-blink'))

    expect(
      await screen.findByText(/is C firmware — the embedded editor takes it, not this FPGA source\./),
    ).toBeInTheDocument()
    expect(source().value).toBe(before)
  })

  it('refuses a VHDL row while the source is on Verilog', async () => {
    render(<FPGADesignPanel />)

    dropLibraryItem(editorZone(), snippetRow('hdl-full-adder-vhdl'))

    expect(
      await screen.findByText(/is VHDL and this buffer is VERILOG — switch the language first, then drop it\./),
    ).toBeInTheDocument()
    expect(source().value).not.toContain('full_adder')
  })

  it('accepts a VHDL row once the panel is switched to VHDL', async () => {
    render(<FPGADesignPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Load VHDL demo' }))
    const area = source()
    area.setSelectionRange(0, 0)
    dropLibraryItem(editorZone(), snippetRow('hdl-full-adder-vhdl'))

    expect(source().value).toContain('full_adder')
    expect(screen.queryByText(/switch the language first/)).not.toBeInTheDocument()
  })

  it('spends an armed row through the Place button', async () => {
    useAppStore.setState({ armedLibraryItem: snippetRow('hdl-dff') })

    render(<FPGADesignPanel />)

    expect(await screen.findByText(/— drop it on the source or place it here\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Place' }))

    expect(await screen.findByText(/"D flip-flop with reset" inserted at the caret\./)).toBeInTheDocument()
    expect(source().value).toContain('module dff')
    expect(useAppStore.getState().armedLibraryItem).toBeNull()
  })

  it('offers the dock the rows this panel actually takes', () => {
    const dock = libraryForMode('fpga', [])
    expect(dock?.accepts).toEqual(['snippet'])
    expect(dock?.hint).toContain('the source')
    for (const row of dock?.items ?? []) {
      expect(row.kind).toBe('snippet')
    }
  })
})
