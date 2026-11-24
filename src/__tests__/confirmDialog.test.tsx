import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useConfirm, type ConfirmSpec } from '../components/ui/useConfirm'

/**
 * The panel that replaced `window.confirm()` in four places.
 *
 * A browser box cannot be tested — the harness has to stub it, which is how the
 * suites used to assert on a spy instead of on the product. These tests answer
 * the real buttons, and pin the behaviours the native dialog never gave: the
 * consequence is written out, Escape and the backdrop both decline, focus starts
 * on the safe answer, a replaced or abandoned question still settles, and a key
 * the question ate is not also a shell shortcut.
 */

const DELETE_PROJECT: ConfirmSpec = {
  title: 'Delete “Legacy Board”?',
  detail: 'The project, its version history and its backups are removed. There is no undo.',
  confirmLabel: 'Delete project',
  destructive: true,
}

function Harness({ onAnswer }: { onAnswer: (accepted: boolean) => void }) {
  const { spec, confirm, resolve } = useConfirm()
  const ask = (spec2: ConfirmSpec) => void confirm(spec2).then(onAnswer)
  return (
    <div>
      <button type="button" onClick={() => ask(DELETE_PROJECT)}>Ask</button>
      <button type="button" onClick={() => ask({ ...DELETE_PROJECT, title: 'Second question?' })}>Ask again</button>
      <button type="button" onClick={() => ask(DELETE_PROJECT)}>Ask from here</button>
      <ConfirmDialog spec={spec} onResolve={resolve} />
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ConfirmDialog', () => {
  it('names the action and the consequence instead of asking a bare yes/no', async () => {
    render(<Harness onAnswer={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Delete “Legacy Board”?')
    expect(within(dialog).getByText(/version history and its backups/i)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete project' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    // Nothing in the app is labelled "OK" any more; a verb says what happens.
    expect(within(dialog).queryByRole('button', { name: 'OK' })).not.toBeInTheDocument()
  })

  it('resolves true on the action button and closes', async () => {
    const onAnswer = vi.fn()
    render(<Harness onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete project' }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('declines on Escape, and the key it takes is not also a shell shortcut', async () => {
    const onAnswer = vi.fn()
    render(<Harness onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus())

    // The shell listens on window too. Escape must answer this question and
    // nothing behind it, so the dialog claims the key before it reaches them.
    const shellListener = vi.fn()
    window.addEventListener('keydown', shellListener)
    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cancel' }), { key: 'Escape' })
    window.removeEventListener('keydown', shellListener)

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))
    expect(shellListener).not.toHaveBeenCalled()
  })

  it('declines when the backdrop is pressed, and stays for a press inside', async () => {
    const onAnswer = vi.fn()
    render(<Harness onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.mouseDown(within(dialog).getByRole('button', { name: 'Delete project' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onAnswer).not.toHaveBeenCalled()

    fireEvent.mouseDown(document.querySelector('.modal-scrim') as Element)
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))
  })

  it('puts focus on the safe answer, and Tab cannot leave the panel', async () => {
    render(<Harness onAnswer={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    const dialog = await screen.findByRole('dialog')
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    const act = within(dialog).getByRole('button', { name: 'Delete project' })
    await waitFor(() => expect(cancel).toHaveFocus())

    /*
     * A browser moves focus on Tab itself; the dialog only has to catch the two
     * keys that would walk out of it. Those are the wrap-around ends, so those
     * are what the test drives — and the control behind the scrim must stay
     * unreachable from either end.
     */
    const outside = screen.getByRole('button', { name: 'Ask again' })
    fireEvent.keyDown(act, { key: 'Tab' })
    expect(cancel).toHaveFocus()
    expect(outside).not.toHaveFocus()
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(act).toHaveFocus()
    expect(outside).not.toHaveFocus()
  })

  it('hands focus back to the control that asked', async () => {
    render(<Harness onAnswer={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Ask from here' })
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('declines the question a second call replaces, so no caller waits forever', async () => {
    const onAnswer = vi.fn()
    render(<Harness onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }))

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Second question?' })).toBeInTheDocument()
  })

  it('declines an unanswered question when the surface holding it closes', async () => {
    const onAnswer = vi.fn()
    const { unmount } = render(<Harness onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    await screen.findByRole('dialog')
    unmount()
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false))
  })
})
