/**
 * Turns an intent result into something the assistant can say.
 *
 * The reply is written from what the handler actually reported. A command that
 * only opened a panel says so; a command that changed the sheet names the
 * reference it changed; a command that could not run says nothing was changed.
 * Nothing in a reply claims a simulation ran or a design is correct.
 */
import type { NLPProcessResult } from '../nlp/nlpService'

export interface DesignContext {
  workspace: string
  componentCount: number
  wireCount: number
  /** Placed parts as `R1 Resistor`, in sheet order. */
  references: string[]
}

export interface VoiceReply {
  /** Text shown in the transcript, with punctuation for reading. */
  display: string
  /** What is handed to the synthesiser; no markdown or bullet glyphs. */
  spoken: string
  intent: string
  confidence: number
  applied: boolean
  /** The designer asked the assistant to stop listening. */
  stopVoice: boolean
  /** Do not speak this reply (the designer asked for quiet). */
  mute: boolean
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const stringAt = (record: Record<string, unknown>, key: string): string =>
  typeof record[key] === 'string' ? (record[key] as string) : ''

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** Strip everything a speech synthesiser would read as noise. */
export function toSpeechText(text: string): string {
  return text
    .replace(/[*_`#]/g, '')
    .replace(/^\s*[-•·]\s*/gm, '')
    .replace(/[•·]/g, '')
    .replace(/→/g, ' to ')
    .replace(/×/g, ' by ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A plain-language summary of the sheet, used by describe_design. */
export function describeDesign(context: DesignContext): string {
  const head = `The ${context.workspace} workspace has ${plural(context.componentCount, 'part')} and ${plural(context.wireCount, 'wire')}.`
  if (context.references.length === 0) return `${head} Nothing is placed yet.`
  const shown = context.references.slice(0, 10)
  const rest = context.references.length - shown.length
  return `${head} Placed: ${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}.`
}

export function composeReply(result: NLPProcessResult, context: DesignContext): VoiceReply {
  const record = asRecord(result.dispatchResult)
  const detail = stringAt(record, 'detail')
  const applied = record.applied === true
  const base = {
    intent: result.intent,
    confidence: result.confidence,
    applied,
    stopVoice: false,
    mute: false,
  }

  const say = (display: string, options: Partial<VoiceReply> = {}): VoiceReply => {
    const uncertain = result.confidence > 0 && result.confidence < 0.5
    const shown = uncertain ? `${display} (low-confidence match)` : display
    return { ...base, display: shown, spoken: toSpeechText(shown), ...options }
  }

  switch (result.intent) {
    case 'unknown':
      return {
        ...base,
        applied: false,
        display:
          'I do not recognise that command yet. I can place parts, wire two references, undo, open a workspace and describe the sheet.',
        spoken:
          'I do not recognise that command yet. I can place parts, wire two references, undo, open a workspace and describe the sheet.',
        stopVoice: false,
        mute: false,
      }

    case 'switch_workspace': {
      const navigated = stringAt(record, 'navigatedTo')
      return navigated
        ? say(`Opened the ${navigated} workspace.`, { applied: true })
        : say('I could not tell which workspace you meant, so nothing changed.')
    }

    case 'add_component':
      return applied
        ? say(detail || 'Placed the part.', { applied: true })
        : say(detail ? `${detail} The sheet is unchanged.` : 'I could not place that part, so the sheet is unchanged.')

    case 'connect_components':
      return applied
        ? say(detail || 'Connected the two parts.')
        : say(detail ? `${detail} The sheet is unchanged.` : 'I could not wire those parts, so the sheet is unchanged.')

    case 'simulate_circuit': {
      const type = stringAt(record, 'type')
      return applied
        ? say(
            `Opened the simulation panel${type ? ` for a ${type} study` : ''}. Voice does not press Run, and a simulation result is not a guarantee for the built board.`,
          )
        : say('I could not open the simulation panel, so nothing changed.')
    }

    case 'optimize_design':
      return say(
        detail ||
          'Voice cannot run the optimiser yet, so nothing changed. Ask the design assistant or use the optimisation tools in the workspace.',
      )

    case 'export_design':
      return applied
        ? say(detail || 'Started the export.')
        : say(detail || 'I cannot start that export from voice, so no file was written.')

    case 'ai_analyze':
      return applied ? say('Opened the design assistant.') : say('I could not open the design assistant.')

    case 'undo':
      return applied ? say('Undid the last canvas change.') : say('There is nothing to undo.')

    case 'redo':
      return applied ? say('Reapplied the undone change.') : say('There is nothing to redo.')

    case 'save_project':
      return applied
        ? say(detail || 'Saved the project.')
        : say(detail || 'No project is open, so there was nothing to save.')

    case 'open_siem':
      return applied ? say('Opened the security workspace.') : say('I could not open the security workspace.')

    case 'describe_design':
      return say(detail || describeDesign(context), { applied: false })

    case 'stop_voice':
      return {
        ...base,
        applied: true,
        display: 'Voice off.',
        spoken: 'Voice off.',
        stopVoice: true,
        mute: true,
      }

    default:
      return applied
        ? say(detail || 'Done.')
        : say(detail || `I recognised a ${result.intent.replace(/_/g, ' ')} request but could not carry it out.`)
  }
}
