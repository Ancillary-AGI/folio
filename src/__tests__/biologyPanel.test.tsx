/**
 * The biology workspace is a rail, an index and one solver per row, so these
 * tests ask the three things that break silently:
 *
 *   • does a gallery request land on the model it names, and on that model's
 *     scale rather than the one the session happened to be sitting at;
 *   • does the header always describe the row that is loaded, since the rail,
 *     the dock and a restored design all write the same state;
 *   • do the dials belong to the model that was dialled, so a multiplier set on
 *     one network cannot ride into another one that shares the key.
 *
 * A model's name appears twice on screen — once in the rail row, once in the
 * card header — so the loaded model is asserted through the header heading.
 * Charts are asserted through their readouts, not their pixels: recharts draws
 * nothing at zero container width in jsdom.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import BiologyPanel from '../components/biology/BiologyPanel'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'

/** The scale rail labels itself, so a scale button cannot be confused with a model row.
 * The rail prints the model count straight after the label — "Organ4", not "Organelle" —
 * and the digit is what keeps "Organ" from matching "Organelle". */
const scaleButton = (label: string) =>
  within(screen.getByRole('group', { name: 'Biological scale' })).getByRole('button', { name: new RegExp(`^${label}\\d`) })

/** A model row's name is its first text node, followed by the spec the rail prints beside it. */
const modelRow = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })

const loadedModel = (name: string) => screen.findByRole('heading', { level: 3, name })

beforeEach(() => {
  useProjectStore.setState({ domainDesigns: {} })
  useAppStore.setState({ demoRequest: null, armedLibraryItem: null })
})

describe('biology workspace', () => {
  it('opens on a model it can solve and publishes what is loaded', async () => {
    render(<BiologyPanel onClose={() => {}} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Biology' })).toBeInTheDocument()
    expect(await loadedModel('Enzyme mechanism, mass action')).toBeInTheDocument()
    expect(scaleButton('Molecule')).toHaveAttribute('aria-pressed', 'true')
    // The solver ran: a conservation law is only reported for a solved trajectory.
    expect(await screen.findByText(/Conservation law 1/)).toBeInTheDocument()

    await waitFor(() =>
      expect(useProjectStore.getState().domainDesigns.biology).toEqual({
        modelId: 'molecule-mm-enzyme',
        overrides: {},
      }),
    )
  })

  it('moves to the scale and model a gallery request names', async () => {
    useAppStore.setState({ demoRequest: 'biology-afterload' })
    render(<BiologyPanel onClose={() => {}} />)

    expect(await loadedModel('Afterload doubled')).toBeInTheDocument()
    expect(screen.getByText('Organ scale')).toBeInTheDocument()
    expect(scaleButton('Organ')).toHaveAttribute('aria-pressed', 'true')
    // The intervention the preset declares is on the dial the load set.
    expect(screen.getByLabelText('Peripheral resistance')).toHaveValue('2.4')
    expect(useAppStore.getState().demoRequest).toBeNull()
  })

  it('follows the rail across scales and keeps header and loader on one row', async () => {
    render(<BiologyPanel onClose={() => {}} />)

    fireEvent.click(scaleButton('System'))
    expect(await loadedModel('Single oral dose')).toBeInTheDocument()
    expect(screen.getByText('System scale')).toBeInTheDocument()

    fireEvent.click(modelRow('Infusion against a capacity-limited sink'))
    expect(await loadedModel('Infusion against a capacity-limited sink')).toBeInTheDocument()
    expect(useProjectStore.getState().domainDesigns.biology).toMatchObject({ modelId: 'system-saturable-infusion' })
  })

  it('keeps a dial with the model it was set on', async () => {
    render(<BiologyPanel onClose={() => {}} />)

    const dial = screen.getByLabelText('binding k+')
    expect(dial).toHaveValue('1')
    fireEvent.change(dial, { target: { value: '2' } })
    expect(screen.getByLabelText('binding k+')).toHaveValue('2')

    // A different network at the same scale shares the dial key but not its value.
    fireEvent.click(modelRow('Competitive inhibitor on the free enzyme'))
    expect(await screen.findByLabelText('binding k+')).toHaveValue('1')

    fireEvent.click(modelRow('Enzyme mechanism, mass action'))
    expect(await screen.findByLabelText('binding k+')).toHaveValue('2')
    expect(useProjectStore.getState().domainDesigns.biology).toMatchObject({
      overrides: { 'molecule-mm-enzyme': { 'forward-0': 2 } },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Reset inputs' }))
    expect(screen.getByLabelText('binding k+')).toHaveValue('1')
  })
})
