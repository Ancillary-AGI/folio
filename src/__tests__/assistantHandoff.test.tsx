/**
 * Launcher-composer → assistant handoff.
 *
 * When a designer starts a project from the composer, the shell stores the
 * brief in the app store with `pendingAssistantPrompt`; the assistant mounts
 * and consumes exactly one brief, so the conversation opens with the brief
 * on the table instead of a dead composer.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AIChatPanel from '../components/ai/AIChatPanel'
import { useProjectStore } from '../stores/useProjectStore'
import { useAppStore } from '../stores/useAppStore'

Element.prototype.scrollIntoView = vi.fn() as unknown as typeof Element.prototype.scrollIntoView

vi.mock('../lib/ai/aiService', () => ({
  aiService: {
    analyzeCircuit: vi.fn(async () => ({
      analysis: 'Handoff analysis report',
      issues: [{ severity: 'warning', message: 'Decoupling missing on U1' }],
      recommendations: ['Place C4 near U1 pin 8'],
    })),
    suggestComponents: vi.fn(async () => []),
  },
}))

vi.mock('../lib/nlp/nlpService', () => ({
  nlpService: {
    processCommand: vi.fn(() => ({ intent: 'general', entities: {}, confidence: 0.9 })),
  },
}))

describe('Assistant composer handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ components: [], wires: [] })
    useAppStore.setState({ workspaceMode: 'schematic', aiChatOpen: true, pendingAssistantPrompt: null })
  })

  it('consumes a primed brief on mount and sends it through the normal path', async () => {
    useAppStore.setState({ pendingAssistantPrompt: 'Analyze the rectifier for issues' })
    render(<AIChatPanel onClose={() => {}} />)

    await waitFor(() =>
      expect(screen.getByText('Analyze the rectifier for issues')).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(screen.getByText(/Decoupling missing on U1/)).toBeInTheDocument(),
    )
    expect(useAppStore.getState().pendingAssistantPrompt).toBeNull()
  })

  it('consumes nothing when nothing was primed', () => {
    render(<AIChatPanel onClose={() => {}} />)
    expect(screen.queryByText('Analyze the rectifier for issues')).not.toBeInTheDocument()
    expect(screen.getByText(/Scribe at the desk/)).toBeInTheDocument()
  })
})
