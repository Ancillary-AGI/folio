import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import SecretDialog from '../components/ui/SecretDialog'
import { useSecretPrompt, type SecretRequest } from '../components/ui/useSecretPrompt'

/**
 * The passphrase box that replaced `window.prompt()` on the encrypted export.
 *
 * The browser version typed the secret in plain text into an operating-system
 * dialog and could not say what losing it means. These tests pin the four things
 * that change: the field is masked, the rule is stated before the answer rather
 * than rejected after it, a decline exports nothing, and what was typed never
 * outlives the question it was typed for.
 */

const SEAL: SecretRequest = {
  title: 'Passphrase for the encrypted export',
  detail: 'Folio never stores it and cannot recover it.',
  fieldLabel: 'Passphrase',
  confirmLabel: 'Seal and export',
  hint: 'At least 8 characters.',
  minLength: 8,
}

function Harness({ onAnswer }: { onAnswer: (value: string | null) => void }) {
  const { request, ask, resolve } = useSecretPrompt()
  return (
    <div>
      <button type="button" onClick={() => void ask(SEAL).then(onAnswer)}>Seal</button>
      <button type="button" onClick={() => void ask({ ...SEAL, title: 'Second question?' }).then(onAnswer)}>
        Seal again
      </button>
      <SecretDialog request={request} onResolve={resolve} />
    </div>
  )
}

function openQuestion() {
  fireEvent.click(screen.getByRole('button', { name: 'Seal' }))
  return screen.findByRole('dialog')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SecretDialog', () => {
  it('asks for the passphrase in a masked field with the rule beside it', async () => {
    render(<Harness onAnswer={() => {}} />)
    const dialog = await openQuestion()
    expect(dialog).toHaveAccessibleName('Passphrase for the encrypted export')

    const field = within(dialog).getByLabelText('Passphrase') as HTMLInputElement
    expect(field.type).toBe('password')
    expect(field).toHaveAttribute('autocomplete', 'new-password')
    expect(within(dialog).getByRole('button', { name: 'Show the passphrase' })).toBeInTheDocument()
    expect(within(dialog).getByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(field).toHaveAccessibleDescription('At least 8 characters.')
    await waitFor(() => expect(field).toHaveFocus())
  })

  it('reveals on request and masks again', async () => {
    render(<Harness onAnswer={() => {}} />)
    const dialog = await openQuestion()
    const field = within(dialog).getByLabelText('Passphrase') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'cell-ink-42' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Show the passphrase' }))
    expect(field.type).toBe('text')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hide the passphrase' }))
    expect(field.type).toBe('password')
  })

  it('refuses to answer until the value meets the rule, in either direction', async () => {
    const onAnswer = vi.fn()
    render(<Harness onAnswer={onAnswer} />)
    const dialog = await openQuestion()
    const field = within(dialog).getByLabelText('Passphrase')
    const act = within(dialog).getByRole('button', { name: 'Seal and export' })

    fireEvent.change(field, { target: { value: 'short' } })
    expect(act).toBeDisabled()
    // Enter is the other way to answer, and must obey the same rule.
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onAnswer).not.toHaveBeenCalled()

    fireEvent.change(field, { target: { value: 'long-enough-passphrase' } })
    expect(act).toBeEnabled()
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('long-enough-passphrase'))
  })

  it('hands the typed value back on the action button and closes', async () => {
    const onAnswer = vi.fn()
    render(<Harness onAnswer={onAnswer} />)
    const dialog = await openQuestion()
    fireEvent.change(within(dialog).getByLabelText('Passphrase'), { target: { value: 'bus-bar-12' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Seal and export' }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('bus-bar-12'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('answers null when cancelled or dismissed, so nothing is exported', async () => {
    const onAnswer = vi.fn()
    render(<Harness onAnswer={onAnswer} />)
    const dialog = await openQuestion()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(null))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    onAnswer.mockClear()
    await openQuestion()
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(null))
  })

  it('starts each question empty, so a previous secret cannot seal the next export', async () => {
    render(<Harness onAnswer={() => {}} />)
    const dialog = await openQuestion()
    fireEvent.change(within(dialog).getByLabelText('Passphrase'), { target: { value: 'first-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Seal again' }))

    const next = await screen.findByRole('dialog')
    expect(within(next).getByRole('heading', { name: 'Second question?' })).toBeInTheDocument()
    expect((within(next).getByLabelText('Passphrase') as HTMLInputElement).value).toBe('')
  })

  it('answers null when the surface holding the question closes', async () => {
    const onAnswer = vi.fn()
    const { unmount } = render(<Harness onAnswer={onAnswer} />)
    await openQuestion()
    unmount()
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(null))
  })
})
