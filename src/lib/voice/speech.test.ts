import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSpeechOutput,
  describeSpeechOutcome,
  pickVoice,
  type SpeechSynthesisLike,
  type SpeechUtteranceLike,
} from './speech'

interface FakeSynth extends SpeechSynthesisLike {
  utterance: SpeechUtteranceLike | null
  cancelled: number
}

const fakeSynth = (voices: SpeechSynthesisLike['getVoices'] = () => []): FakeSynth => {
  const synth: FakeSynth = {
    speaking: false,
    getVoices: voices,
    speak: (utterance) => {
      synth.utterance = utterance
      synth.speaking = true
    },
    cancel: () => {
      synth.cancelled += 1
      synth.speaking = false
    },
    utterance: null,
    cancelled: 0,
  }
  return synth
}

const fakeUtterance = (text = ''): SpeechUtteranceLike => ({
  text,
  lang: '',
  voice: null,
  rate: 1,
  pitch: 1,
  onend: null,
  onerror: null,
})

describe('createSpeechOutput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports unsupported when the browser has no synthesiser', async () => {
    const output = createSpeechOutput({ synth: null })
    expect(output.supported).toBe(false)
    await expect(output.speak('hello')).resolves.toEqual({ spoken: false, reason: 'unsupported' })
  })

  it('reports empty when there is nothing to say', async () => {
    const output = createSpeechOutput({ synth: fakeSynth(), createUtterance: fakeUtterance })
    await expect(output.speak('   ')).resolves.toEqual({ spoken: false, reason: 'empty' })
  })

  it('speaks with a preferred English voice and resolves when it ends', async () => {
    const synth = fakeSynth(() => [
      { name: 'cloud', lang: 'en-US' },
      { name: 'local', lang: 'en-GB', localService: true },
    ])
    const output = createSpeechOutput({ synth, createUtterance: fakeUtterance })
    const promise = output.speak('hello there')
    expect(synth.utterance?.voice?.name).toBe('local')
    expect(synth.utterance?.text).toBe('hello there')
    synth.utterance?.onend?.()
    await expect(promise).resolves.toEqual({ spoken: true })
  })

  it('a new utterance supersedes the one still speaking', async () => {
    const synth = fakeSynth()
    const output = createSpeechOutput({ synth, createUtterance: fakeUtterance })
    const first = output.speak('first sentence')
    const second = output.speak('second sentence')
    await expect(first).resolves.toEqual({ spoken: false, reason: 'cancelled' })
    synth.utterance?.onend?.()
    await expect(second).resolves.toEqual({ spoken: true })
  })

  it('times out a synthesiser that never reports completion', async () => {
    const synth = fakeSynth()
    const output = createSpeechOutput({ synth, createUtterance: fakeUtterance, timeoutMs: () => 50 })
    const promise = output.speak('stuck')
    synth.cancelled = 0
    vi.advanceTimersByTime(60)
    await expect(promise).resolves.toEqual({ spoken: false, reason: 'timeout' })
    expect(synth.cancelled).toBe(1)
  })

  it('maps interrupted and cancelled errors to a cancelled outcome', async () => {
    const synth = fakeSynth()
    const output = createSpeechOutput({ synth, createUtterance: fakeUtterance })
    const promise = output.speak('please stop')
    synth.utterance?.onerror?.({ error: 'interrupted' })
    await expect(promise).resolves.toEqual({ spoken: false, reason: 'cancelled', detail: 'interrupted' })
  })

  it('reports other synthesis errors without claiming speech', async () => {
    const synth = fakeSynth()
    const output = createSpeechOutput({ synth, createUtterance: fakeUtterance })
    const promise = output.speak('boom')
    synth.utterance?.onerror?.({ error: 'synthesis-failed' })
    await expect(promise).resolves.toEqual({ spoken: false, reason: 'error', detail: 'synthesis-failed' })
  })
})

describe('pickVoice', () => {
  it('prefers a default local English voice and never fails on an empty list', () => {
    expect(pickVoice([])).toBeNull()
    expect(
      pickVoice([
        { name: 'remote', lang: 'en-US' },
        { name: 'default', lang: 'en-US', default: true },
        { name: 'local', lang: 'en-US', localService: true, default: true },
      ])?.name,
    ).toBe('local')
  })

  it('falls back to any voice when none speak English', () => {
    expect(pickVoice([{ name: 'de', lang: 'de-DE' }])?.name).toBe('de')
  })
})

describe('describeSpeechOutcome', () => {
  it('describes what actually happened', () => {
    expect(describeSpeechOutcome({ spoken: true })).toBe('Spoken aloud.')
    expect(describeSpeechOutcome({ spoken: false, reason: 'unsupported' })).toContain('no speech synthesiser')
    expect(describeSpeechOutcome({ spoken: false, reason: 'error', detail: 'boom' })).toContain('boom')
  })
})
