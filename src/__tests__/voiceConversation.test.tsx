import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import VoiceCommandBar from '../components/nlp/VoiceCommandBar'
import { voiceController } from '../lib/voice/controller'
import {
  loadVoiceSettings,
  saveVoiceSettings,
  useVoiceStore,
  VOICE_SETTINGS_KEY,
} from '../stores/useVoiceStore'

const resetStore = () => {
  useVoiceStore.setState({
    open: false,
    listening: false,
    speaking: false,
    status: 'idle',
    error: '',
    interim: '',
    turns: [],
    spokenReplies: true,
  })
}

describe('VoiceCommandBar', () => {
  beforeEach(() => {
    resetStore()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the conversation surface with honest idle copy', () => {
    render(<VoiceCommandBar onClose={() => {}} />)
    expect(screen.getByTestId('voice-panel')).toBeDefined()
    expect(screen.getByTestId('voice-status').textContent).toContain('Ready')
    expect(screen.getByText(/Say things like/)).toBeDefined()
    expect(screen.getByText('place a resistor')).toBeDefined()
  })

  it('shows the transcript and marks a reply as spoken only when it was', () => {
    useVoiceStore.setState({
      turns: [
        { id: 'a', role: 'designer', text: 'add a resistor', timestamp: 1 },
        {
          id: 'b',
          role: 'assistant',
          text: 'Placed R1 (Resistor) at 80, 80.',
          intent: 'add_component',
          applied: true,
          speech: 'spoken',
          timestamp: 2,
        },
      ],
    })
    render(<VoiceCommandBar onClose={() => {}} />)
    expect(screen.getByText('add a resistor')).toBeDefined()
    expect(screen.getByText('Placed R1 (Resistor) at 80, 80.')).toBeDefined()
    expect(screen.getByText(/spoken aloud/)).toBeDefined()
    expect(screen.getByText(/applied/)).toBeDefined()
  })

  it('shows the live interim transcript and the error message', () => {
    useVoiceStore.setState({ interim: 'place a cap', error: 'Microphone access was denied.' })
    render(<VoiceCommandBar onClose={() => {}} />)
    expect(screen.getByTestId('voice-interim').textContent).toContain('place a cap')
    expect(screen.getByRole('alert').textContent).toContain('denied')
  })

  it('routes typed commands and suggestions through the controller', async () => {
    const send = vi.spyOn(voiceController, 'send').mockResolvedValue(null)
    render(<VoiceCommandBar onClose={() => {}} />)
    fireEvent.change(screen.getByTestId('voice-input'), { target: { value: 'open the pcb' } })
    fireEvent.click(screen.getByTestId('voice-send'))
    await waitFor(() => expect(send).toHaveBeenCalledWith('open the pcb'))

    fireEvent.click(screen.getByText('add a capacitor'))
    await waitFor(() => expect(send).toHaveBeenCalledWith('add a capacitor'))
  })

  it('toggles the microphone through the controller and reports pressed state', () => {
    const toggle = vi.spyOn(voiceController, 'toggleListening').mockReturnValue(true)
    useVoiceStore.setState({ listening: true })
    render(<VoiceCommandBar onClose={() => {}} />)
    const mic = screen.getByTestId('voice-mic')
    expect(mic.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(mic)
    expect(toggle).toHaveBeenCalled()
  })

  it('flips the spoken-replies preference and persists it', () => {
    render(<VoiceCommandBar onClose={() => {}} />)
    const toggle = screen.getByTestId('voice-speech-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(useVoiceStore.getState().spokenReplies).toBe(false)
    expect(loadVoiceSettings(localStorage).spokenReplies).toBe(false)
    expect(screen.getByText('Spoken replies off')).toBeDefined()
  })

  it('offers a stop-speaking button while the assistant is talking', () => {
    const cancel = vi.spyOn(voiceController, 'cancelSpeech').mockImplementation(() => {})
    useVoiceStore.setState({ speaking: true })
    render(<VoiceCommandBar onClose={() => {}} />)
    fireEvent.click(screen.getByText('Stop speaking'))
    expect(cancel).toHaveBeenCalled()
  })
})

describe('voice settings storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults for missing or malformed stores', () => {
    expect(loadVoiceSettings(localStorage)).toEqual({ spokenReplies: true })
    localStorage.setItem(VOICE_SETTINGS_KEY, 'not json')
    expect(loadVoiceSettings(localStorage)).toEqual({ spokenReplies: true })
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ version: 2, spokenReplies: false }))
    expect(loadVoiceSettings(localStorage)).toEqual({ spokenReplies: true })
    localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify({ version: 1, spokenReplies: 'yes' }))
    expect(loadVoiceSettings(localStorage)).toEqual({ spokenReplies: true })
  })

  it('round-trips a valid preference', () => {
    saveVoiceSettings({ spokenReplies: false })
    expect(loadVoiceSettings(localStorage)).toEqual({ spokenReplies: false })
  })
})
