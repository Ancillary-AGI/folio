/**
 * File import in the block editor.
 *
 * The bug class these tests close is a load that reports nothing: a wrong or
 * half-broken JSON file used to leave the canvas untouched, or replace it, with
 * no message and a stale "Build OK" badge describing a program that was no
 * longer on screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import VisualProgrammingEditor from '../components/visual-programming/VisualProgrammingEditor'
import { useAppStore } from '../stores/useAppStore'

/**
 * Click "Load", catch the detached file input the handler creates, and hand it
 * one file. jsdom opens no native chooser, so the input element itself is the
 * only way into the reader path.
 */
async function chooseFile(name: string, content: string) {
  const choosers: HTMLInputElement[] = []
  const spy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
    if (this.type === 'file') choosers.push(this)
  })

  fireEvent.click(screen.getByRole('button', { name: 'Load' }))
  spy.mockRestore()
  const picked = choosers[0]
  if (!picked) throw new Error('the Load button did not open a file chooser')

  const file = new File([content], name, { type: 'application/json' })
  Object.defineProperty(picked, 'files', { value: [file], configurable: true })
  await act(async () => {
    picked.onchange?.({ target: picked } as unknown as Event)
    await Promise.resolve()
  })
}

const programFile = (nodes: unknown[], edges: unknown[]) =>
  JSON.stringify({ nodes, edges, timestamp: 1, name: 'Imported' })

describe('VisualProgrammingEditor file import', () => {
  beforeEach(() => {
    useAppStore.setState({ demoRequest: null })
  })

  it('refuses a JSON file that is not a block program and says why', async () => {
    render(<VisualProgrammingEditor onClose={() => {}} />)

    await chooseFile('netlist.json', JSON.stringify({ parts: ['R1', 'C2'] }))

    const note = await screen.findByRole('status')
    expect(note.textContent).toContain('netlist.json')
    expect(note.textContent).toContain('no nodes[] and edges[] arrays')
  })

  it('reports malformed JSON instead of failing in the console', async () => {
    render(<VisualProgrammingEditor onClose={() => {}} />)

    await chooseFile('truncated.json', '{ "nodes": [')

    const note = await screen.findByRole('status')
    expect(note.textContent).toContain('truncated.json is not JSON')
  })

  it('loads a program, counts the entries it rejects, and drops the stale verdict', async () => {
    useAppStore.setState({ demoRequest: 'visual-blocks' })
    render(<VisualProgrammingEditor onClose={() => {}} />)
    await screen.findByText(/Build OK/)

    await chooseFile(
      'responder.json',
      programFile(
        [
          { id: 'in1', type: 'digital-in', position: { x: 0, y: 0 }, data: {} },
          { id: 'led1', type: 'digital-out', position: { x: 120, y: 0 }, data: {} },
          // No position at all — the validator must refuse this one.
          { id: 'ghost', type: 'digital-out', data: {} },
        ],
        [{ id: 'w1', source: 'in1', target: 'led1' }],
      ),
    )

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Loaded 2 blocks and 1 wire from responder.json'),
    )
    expect(screen.getByRole('status').textContent).toContain('1 malformed entry rejected')
    expect(screen.getByText(/^Blocks: 2$/)).toBeInTheDocument()
    // The demo's verdict described the demo graph, not this file.
    expect(screen.queryByText(/Build OK/)).not.toBeInTheDocument()
    expect(screen.getByText(/Status:.*Not built|Not built/)).toBeInTheDocument()
  })
})
