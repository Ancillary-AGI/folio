/**
 * The conversation loop: speech in → intent → store change → spoken reply.
 *
 * The controller owns exactly one recognition session and one speech queue per
 * app, so the header microphone and Copilot's microphone cannot
 * open two sessions. Anything that failed to run is reported in the transcript;
 * Copilot stops listening when asked, and a new phrase interrupts the
 * previous spoken reply instead of queueing behind it.
 */
import { nlpService, type NLPProcessResult } from '../nlp/nlpService'
import { useProjectStore } from '../../stores/useProjectStore'
import { useAppStore } from '../../stores/useAppStore'
import { useVoiceStore } from '../../stores/useVoiceStore'
import { composeReply, describeDesign, type DesignContext, type VoiceReply } from './conversation'
import { createSpeechOutput, type SpeechOutput } from './speech'
import {
  createVoiceSession,
  type RecognitionLike,
  type VoiceSession,
  type VoiceSessionCallbacks,
} from './voiceSession'

export interface VoiceControllerOptions {
  process?: (text: string) => Promise<NLPProcessResult>
  /** `null` means the caller already knows speech synthesis is unavailable. */
  speech?: SpeechOutput | null
  createSession?: (callbacks: VoiceSessionCallbacks) => VoiceSession
  context?: () => DesignContext
}

export interface VoiceController {
  send(text: string): Promise<VoiceReply | null>
  toggleListening(): boolean
  startListening(): boolean
  stopListening(): void
  cancelSpeech(): void
  close(): void
  dispose(): void
}

/** The Web Speech API constructor, or null where the browser omits it. */
function browserRecognition(): RecognitionLike | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as Window & {
    SpeechRecognition?: new () => RecognitionLike
    webkitSpeechRecognition?: new () => RecognitionLike
  }
  const Ctor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

function defaultContext(): DesignContext {
  const project = useProjectStore.getState()
  return {
    workspace: useAppStore.getState().workspaceMode,
    componentCount: project.components.length,
    wireCount: project.wires.length,
    references: project.components.map((component) => `${component.reference} ${component.component.name}`),
  }
}

export function createVoiceController(options: VoiceControllerOptions = {}): VoiceController {
  const store = useVoiceStore
  const processText = options.process ?? ((text: string) => nlpService.processNLP(text))
  const readContext = options.context ?? defaultContext
  let speech: SpeechOutput | null | undefined = options.speech
  let session: VoiceSession | null = null
  let disposed = false

  const getSpeech = (): SpeechOutput | null => {
    if (speech === undefined) speech = createSpeechOutput()
    return speech
  }

  const stopListening = () => {
    session?.stop()
    session = null
    store.getState().setListening(false)
    store.getState().setStatus('idle')
    store.getState().setInterim('')
  }

  const cancelSpeech = () => getSpeech()?.cancel()

  const send = async (text: string): Promise<VoiceReply | null> => {
    const trimmed = text.trim()
    if (!trimmed || disposed) return null

    // Barge-in: a new phrase replaces whatever the assistant is still saying.
    cancelSpeech()
    store.getState().setInterim('')
    store.getState().addTurn({ role: 'designer', text: trimmed })

    let result: NLPProcessResult
    try {
      result = await processText(trimmed)
    } catch (error) {
      store.getState().addTurn({
        role: 'assistant',
        text: `I could not process that request: ${error instanceof Error ? error.message : 'unknown error'}.`,
      })
      return null
    }

    const reply = composeReply(result, readContext())
    const turnId = store.getState().addTurn({
      role: 'assistant',
      text: reply.display,
      intent: reply.intent,
      confidence: reply.confidence,
      applied: reply.applied,
    })

    if (reply.stopVoice) stopListening()
    if (reply.mute) cancelSpeech()

    if (reply.mute || !store.getState().spokenReplies) {
      store.getState().setTurnSpeech(turnId, 'text-only')
      return reply
    }

    const output = getSpeech()
    if (!output) {
      store.getState().setTurnSpeech(turnId, 'unavailable')
      return reply
    }
    store.getState().setSpeaking(true)
    try {
      const outcome = await output.speak(reply.spoken)
      store.getState().setTurnSpeech(
        turnId,
        outcome.spoken
          ? 'spoken'
          : outcome.reason === 'unsupported'
            ? 'unavailable'
            : outcome.reason === 'cancelled'
              ? 'interrupted'
              : 'text-only',
      )
    } finally {
      store.getState().setSpeaking(false)
    }
    return reply
  }

  const startListening = (): boolean => {
    if (disposed) return false
    store.getState().openPanel()
    store.getState().setError('')
    if (session?.isActive()) return true

    const callbacks: VoiceSessionCallbacks = {
      onStatus: (status, detail) => {
        const current = store.getState()
        if (status === 'listening') {
          current.setListening(true)
          current.setStatus('listening')
        } else if (status === 'starting') {
          current.setStatus('starting')
        } else if (status === 'error') {
          current.setListening(false)
          current.setStatus('error')
        } else {
          current.setListening(false)
          current.setStatus('idle')
        }
        if (detail) current.setError(detail)
      },
      onTranscript: (text, final) => {
        if (!final) {
          store.getState().setInterim(text)
          return
        }
        store.getState().setInterim('')
        store.getState().setStatus('recognising')
        void send(text).finally(() => {
          if (store.getState().status === 'recognising' && session?.isActive()) {
            store.getState().setStatus('listening')
          }
        })
      },
      onError: (message, fatal) => {
        store.getState().setError(message)
        if (fatal) store.getState().setListening(false)
      },
    }

    session = options.createSession ? options.createSession(callbacks) : createVoiceSession({
      createRecognition: browserRecognition,
      callbacks,
    })
    const started = session.start()
    if (!started) {
      session = null
      store.getState().setListening(false)
    }
    return started
  }

  const toggleListening = (): boolean => {
    const state = store.getState()
    if (state.listening || state.status === 'starting' || session?.isActive()) {
      stopListening()
      return false
    }
    return startListening()
  }

  return {
    send,
    toggleListening,
    startListening,
    stopListening,
    cancelSpeech,
    close: () => {
      stopListening()
      cancelSpeech()
      store.getState().closePanel()
    },
    dispose: () => {
      disposed = true
      stopListening()
      cancelSpeech()
    },
  }
}

export const voiceController = createVoiceController()

export { describeDesign }
