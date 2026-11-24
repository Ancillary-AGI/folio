/**
 * PowerGridPanel: the study has to headline the solver's real verdict. A
 * three-bus case converges and reports generation, demand and losses; pushing
 * the stressed tie past its transfer limit must admit non-convergence instead
 * of painting the last iterate green. The distribution tab exercises the
 * backward/forward sweep on the default urban feeder.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PowerGridPanel from '../components/electronics/PowerGridPanel'
import { armLibraryItem, dropLibraryItem } from './helpers/libraryDrop'
import { gridCatalog } from '../lib/library/elementCatalogs'
import type { LibraryItem } from '../lib/library/types'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'

describe('PowerGridPanel power flow', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('solves the default transmission study with real totals', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/Power flow converged in \d+ iterations? with a [\d.e+-]+ pu mismatch/)

    expect(screen.getByText('Generation')).toBeInTheDocument()
    expect(screen.getByText('Demand')).toBeInTheDocument()
    expect(screen.getByText('Losses')).toBeInTheDocument()
    expect(screen.getByText('Minimum voltage')).toBeInTheDocument()

    const busTable = screen.getByRole('table', { name: 'Bus voltages, angles and power injections' })
    expect(within(busTable).getByText('Bus 1')).toBeInTheDocument()
    expect(within(busTable).getByText('Bus 3')).toBeInTheDocument()

    const branchTable = screen.getByRole('table', { name: 'Branch sending-end and receiving-end power flows' })
    expect(within(branchTable).getByText('Bus 1 → Bus 2')).toBeInTheDocument()
  })

  it('reports non-convergence past the transfer limit instead of a fake solution', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Transmission study'), { target: { value: 'two-bus' } })
    fireEvent.change(screen.getByLabelText('Demand scale'), { target: { value: '2' } })

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      /Power flow did not converge after \d+ Newton iterations\. Bus values below are the last iterate, not a solution\./,
    )
    expect(screen.getByText('stopped without a solution')).toBeInTheDocument()
  })

  it('runs the distribution sweep and reports section currents', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Distribution' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/Feeder converged in \d+ backward\/forward sweeps?\./)

    expect(screen.getByText('Source delivered')).toBeInTheDocument()
    expect(screen.getByText('Copper loss')).toBeInTheDocument()

    const sectionTable = screen.getByRole('table', { name: 'Feeder section currents, losses and voltage drop' })
    expect(within(sectionTable).getByText('Tx → Kiosk A')).toBeInTheDocument()
    expect(within(sectionTable).getByText('Kiosk B → Kiosk C')).toBeInTheDocument()
  })
})

/**
 * The bus, branch and node lists are real drop targets: a row that fits is
 * written into the case being solved, and a row that does not is refused with
 * the reason the panel knows, not a shrug.
 */
describe('PowerGridPanel library drops', () => {
  beforeEach(() => {
    localStorage.clear()
    // The project store keeps the last published grid design in memory, so a
    // panel restored here would otherwise open on whichever tab ran before it.
    useProjectStore.setState({ domainDesigns: {} })
    useAppStore.setState({ armedLibraryItem: null })
  })

  const gridRow = (id: string): LibraryItem => {
    const row = gridCatalog().find((item) => item.id === id)
    if (!row) throw new Error(`catalog row ${id} is gone`)
    return row
  }

  /** The card whose title is `title`, with the drop-zone attributes it carries. */
  const zone = (title: string): HTMLElement => {
    const card = screen.getByText(title).closest('.cad-dropzone')
    if (!card) throw new Error(`${title} card is not a drop zone`)
    return card as HTMLElement
  }

  it('ties a dropped bus into the case instead of orphaning it', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    dropLibraryItem(zone('Buses'), gridRow('grid-bus-pv-33'))

    // 230 kV anchor against a 33 kV bus: the only legal tie is per-unit, so the
    // panel adds a nominal changer and says so.
    expect(
      await screen.findByText(/Gen 33 kV joined to "Bus 1" through a nominal 230\/33 kV transformer/),
    ).toBeInTheDocument()
    expect(within(zone('Buses')).getByText('gen-33')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove branch L-dock Bus 1→gen-33/ })).toBeInTheDocument()
    // Adding a bus must not break the study it lands in.
    expect(screen.getByText(/Power flow converged in \d+ iterations/)).toBeInTheDocument()
  })

  it('refuses a branch whose buses are not in the case yet and names them', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    dropLibraryItem(zone('Branches'), gridRow('grid-xfmr-132-33'))

    expect(await screen.findByText(/joins "slack-132" and "gen-33", neither of which is in this case — drop that bus first\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove branch L-dock slack-132→gen-33' })).not.toBeInTheDocument()
  })

  it('refuses a second slack bus, which would leave the network unsolvable', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    dropLibraryItem(zone('Buses'), gridRow('grid-bus-slack-132'))

    expect(await screen.findByText(/already has a slack bus \("Bus 1"\)/)).toBeInTheDocument()
    expect(screen.queryByText('slack-132')).not.toBeInTheDocument()
  })

  it('tells a row dropped on the wrong list where it belongs', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    dropLibraryItem(zone('Branches'), gridRow('grid-bus-pq-11'))

    expect(await screen.findByText(/Load bus, 11 kV \/ 5 MW is a bus — it belongs on the bus list\./)).toBeInTheDocument()
  })

  it('spends an armed feeder node through the Place button and disarms it', async () => {
    render(<PowerGridPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Distribution' }))

    armLibraryItem(gridRow('grid-feeder-100kw'))

    expect(await screen.findByText(/— drop it on the node list or place it here\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Place' }))

    expect(await screen.findByText(/dropped behind "Kiosk C" on 400 m of 0\.12 \+ j0\.11 Ω\./)).toBeInTheDocument()
    expect(within(zone('Node demand')).getByText('dp-100')).toBeInTheDocument()
    expect(useAppStore.getState().armedLibraryItem).toBeNull()
  })
})
