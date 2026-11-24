/**
 * The contract every domain panel inherits from `useDomainLibraryZone`.
 *
 * The panels test their own placement logic; this pins the shared surface
 * behaviour they all depend on: the edge answers the drag before the drop, a
 * foreign row is refused in words, an armed row is spent exactly once, and a
 * click that belongs to a control inside the zone is not a placement.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useDomainLibraryZone } from '../lib/library/useDomainLibraryZone'
import LibraryDropNote from '../components/library/LibraryDropNote'
import { armLibraryItem, dragLibraryOver, dropLibraryItem } from './helpers/libraryDrop'
import { snippetCatalog } from '../lib/library/elementCatalogs'
import { mechanicalCatalog } from '../lib/library/catalog'
import { useAppStore } from '../stores/useAppStore'
import type { LibraryItem } from '../lib/library/types'

const solid = (): LibraryItem => mechanicalCatalog()[0]
const foreign = (): LibraryItem => snippetCatalog()[0]

function Probe({ onPlaced }: { onPlaced: (name: string) => void }) {
  const [placed, setPlaced] = useState<string[]>([])
  const zone = useDomainLibraryZone({
    accepts: ['solid'],
    as: 'the test surface',
    onPlace: (item) => {
      setPlaced((current) => [...current, item.name])
      onPlaced(item.name)
    },
  })
  return (
    <div className="cad-dropzone" data-testid="zone" {...zone.zoneProps}>
      <LibraryDropNote zone={zone} surface="the test surface" />
      <button type="button" onClick={() => {}}>Inner control</button>
      <p data-testid="placed">{placed.length === 0 ? 'nothing' : placed.join(', ')}</p>
    </div>
  )
}

describe('library drop zone', () => {
  const placed: string[] = []

  beforeEach(() => {
    placed.length = 0
    useAppStore.setState({ armedLibraryItem: null })
  })

  const zone = () => screen.getByTestId('zone')
  const lastPlaced = () => screen.getByTestId('placed')

  it('follows the pointer: the edge accepts a row it takes and refuses one it does not', () => {
    render(<Probe onPlaced={(name) => placed.push(name)} />)

    dragLibraryOver(zone(), solid())
    expect(zone()).toHaveAttribute('data-library-drop', 'accept')

    dragLibraryOver(zone(), foreign())
    expect(zone()).toHaveAttribute('data-library-drop', 'refuse')
  })

  it('refuses a foreign row by name and places nothing', async () => {
    render(<Probe onPlaced={(name) => placed.push(name)} />)

    dropLibraryItem(zone(), foreign())

    expect(await screen.findByText(/takes mechanical solids\./)).toBeInTheDocument()
    expect(lastPlaced()).toHaveTextContent('nothing')
    expect(placed).toEqual([])
  })

  it('places a row dropped on it', () => {
    render(<Probe onPlaced={(name) => placed.push(name)} />)

    dropLibraryItem(zone(), solid())

    expect(lastPlaced()).toHaveTextContent(solid().name)
    expect(placed).toEqual([solid().name])
  })

  it('spends an armed row once, and not when a control inside the zone is clicked', async () => {
    render(<Probe onPlaced={(name) => placed.push(name)} />)
    act(() => armLibraryItem(solid()))

    // Awaited so the store change has landed in the render the click will read.
    expect(await screen.findByText(/— drop it on the test surface or place it here\./)).toBeInTheDocument()

    // A click on the inner control is that control's business, not a placement.
    fireEvent.click(screen.getByRole('button', { name: 'Inner control' }))
    expect(lastPlaced()).toHaveTextContent('nothing')

    // A click on the surface itself places the armed row and disarms it.
    fireEvent.click(zone())
    expect(placed).toEqual([solid().name])
    expect(useAppStore.getState().armedLibraryItem).toBeNull()

    fireEvent.click(zone())
    expect(placed).toEqual([solid().name])
  })

  it('leaves a non-library drag alone instead of swallowing it', () => {
    const preventDefault = vi.fn()
    render(<Probe onPlaced={(name) => placed.push(name)} />)

    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['text/plain'], getData: () => 'https://example.com' } })
    Object.defineProperty(event, 'preventDefault', { value: preventDefault })
    fireEvent(zone(), event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(lastPlaced()).toHaveTextContent('nothing')
  })
})
