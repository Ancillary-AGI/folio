/**
 * AI chat render coverage.
 * The panel is UI over aiService/nlpService; the services are stubbed at
 * the module boundary so the send lifecycle, quick actions, clear and
 * error paths run for real.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AIChatPanel from '../components/ai/AIChatPanel'
import { useProjectStore } from '../stores/useProjectStore'
import { useAppStore } from '../stores/useAppStore'

Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView

vi.mock('../lib/ai/aiService', () => ({
  aiService: {
    analyzeCircuit: vi.fn(async () => ({
      analysis: 'Test analysis report',
      issues: [{ severity: 'warning', message: 'Floating net on U1' }],
      recommendations: ['Tie unused inputs'],
    })),
    suggestComponents: vi.fn(async () => []),
  },
}))

vi.mock('../lib/nlp/nlpService', () => ({
  nlpService: {
    processQuery: vi.fn(async () => ({ intent: 'general', entities: {}, confidence: 0.9 })),
  },
}))

describe('AIChatPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ components: [], wires: [] })
    useAppStore.setState({ workspaceMode: 'schematic' })
  })

  it('renders welcome message, quick actions and input', () => {
    render(<AIChatPanel onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: 'Scribe' })).toBeInTheDocument()
    expect(screen.getByText(/Scribe at the desk/)).toBeInTheDocument()
    expect(screen.getByText(/every claim traced/i)).toBeInTheDocument()
    expect(screen.getByText(/It advises; the rule checks/i)).toBeInTheDocument()
    for (const action of ['Analyze circuit', 'Suggest components', 'Optimize power', 'Review assumptions']) {
      expect(screen.getByRole('button', { name: new RegExp(action) })).toBeInTheDocument()
    }
  })

  it('sends a message and renders the analysis reply', async () => {
    render(<AIChatPanel onClose={() => {}} />)
    const input = screen.getByPlaceholderText(/Ask Scribe/)
    fireEvent.change(input, { target: { value: 'Analyze my circuit for issues' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByText(/Circuit Analysis Report/)).toBeInTheDocument())
    expect(screen.getByText(/Floating net on U1/)).toBeInTheDocument()
  })

  it('attaches a file to the prompt and inlines it into the message', async () => {
    render(<AIChatPanel onClose={() => {}} />)
    const attachButton = screen.getByRole('button', { name: 'Attach a file' })
    expect(attachButton).toBeEnabled()

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()

    const notes = new File(['C4 decoupling next to U1'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [notes] } })

    expect(await screen.findByText('notes.txt')).toBeInTheDocument()
    expect(screen.getByLabelText('Detach notes.txt')).toBeInTheDocument()

    const input = screen.getByPlaceholderText(/Ask Scribe/)
    fireEvent.change(input, { target: { value: 'Analyze my circuit for issues' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(screen.getByText(/Circuit Analysis Report/)).toBeInTheDocument())
    expect(screen.getByText(/\[Attached: notes\.txt/)).toBeInTheDocument()
  })

  it('detaches an attached file before sending', async () => {
    render(<AIChatPanel onClose={() => {}} />)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const notes = new File(['C4 decoupling next to U1'], 'notes.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [notes] } })
    expect(await screen.findByText('notes.txt')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Detach notes.txt'))
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()

    const input = screen.getByPlaceholderText(/Ask Scribe/)
    fireEvent.change(input, { target: { value: 'Analyze my circuit for issues' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByText(/Circuit Analysis Report/)).toBeInTheDocument())
    expect(screen.queryByText(/\[Attached:/)).not.toBeInTheDocument()
  })

  it('refuses attachments over the per-file cap instead of truncating silently', async () => {
    render(<AIChatPanel onClose={() => {}} />)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const big = new File([new Uint8Array(300 * 1024)], 'big.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [big] } })

    expect(await screen.findByRole('alert')).toHaveTextContent(/big\.txt.*256 KB/)
  })

  it('fires a quick action through the same path', async () => {
    render(<AIChatPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Analyze circuit/ }))
    await waitFor(() => expect(screen.getByText(/Circuit Analysis Report/)).toBeInTheDocument())
  })

  it('clears the chat back to the welcome message', async () => {
    render(<AIChatPanel onClose={() => {}} />)
    const input = screen.getByPlaceholderText(/Ask Scribe/)
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getAllByText('U').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
    expect(screen.getByRole('heading', { name: 'Scribe' })).toBeInTheDocument()
    expect(screen.queryByText(/Circuit Analysis Report/)).not.toBeInTheDocument()
  })

  /*
   * The tick is a statement that the clipboard holds the text, so it may only
   * appear once the write resolves. A denied write must report the denial
   * instead of the same tick.
   */
  const stubClipboard = (writeText: () => Promise<void>) => {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  }

  /* The reply is posted as more than one assistant bubble, so every copy
   * control is addressed by index and only the clicked one changes state. */
  const copyButton = (index = 0): HTMLElement =>
    screen.getAllByRole('button', { name: 'Copy reply to clipboard' })[index]

  it('marks a reply copied only after the clipboard write resolves', async () => {
    let resolveWrite: () => void = () => {}
    stubClipboard(() => new Promise<void>((resolve) => { resolveWrite = resolve }))

    render(<AIChatPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Analyze circuit/ }))
    await screen.findByText(/Circuit Analysis Report/)

    fireEvent.click(copyButton())
    expect(screen.queryByRole('button', { name: 'Copied to clipboard' })).not.toBeInTheDocument()

    resolveWrite()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copied to clipboard' })).toBeInTheDocument())
  })

  it('reports a denied clipboard write instead of claiming it copied', async () => {
    stubClipboard(() => Promise.reject(new Error('Document is not focused')))

    render(<AIChatPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Analyze circuit/ }))
    await screen.findByText(/Circuit Analysis Report/)

    fireEvent.click(copyButton())
    expect(
      await screen.findByRole('button', { name: /Copy failed — clipboard access denied/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copied to clipboard' })).not.toBeInTheDocument()
  })
})
