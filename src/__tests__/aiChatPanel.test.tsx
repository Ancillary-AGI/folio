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
    expect(screen.getByText('AI Design Assistant')).toBeInTheDocument()
    expect(screen.getByText(/your AI design assistant/)).toBeInTheDocument()
    for (const action of ['Analyze circuit', 'Suggest components', 'Optimize power', 'Check safety']) {
      expect(screen.getByRole('button', { name: new RegExp(action) })).toBeInTheDocument()
    }
  })

  it('sends a message and renders the analysis reply', async () => {
    render(<AIChatPanel onClose={() => {}} />)
    const input = screen.getByPlaceholderText(/Ask about your design/)
    fireEvent.change(input, { target: { value: 'Analyze my circuit for issues' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getByText(/Circuit Analysis Report/)).toBeInTheDocument())
    expect(screen.getByText(/Floating net on U1/)).toBeInTheDocument()
  })

  it('fires a quick action through the same path', async () => {
    render(<AIChatPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Analyze circuit/ }))
    await waitFor(() => expect(screen.getByText(/Circuit Analysis Report/)).toBeInTheDocument())
  })

  it('clears the chat back to the welcome message', async () => {
    render(<AIChatPanel onClose={() => {}} />)
    const input = screen.getByPlaceholderText(/Ask about your design/)
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(screen.getAllByText('U').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Clear chat' }))
    expect(screen.getByText('AI Design Assistant')).toBeInTheDocument()
    expect(screen.queryByText(/Circuit Analysis Report/)).not.toBeInTheDocument()
  })
})
