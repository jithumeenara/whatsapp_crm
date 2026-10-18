import type { ParsedInbound } from './types'

/**
 * The message that started a chatbot, kept as variables from its first
 * step:
 *
 *   {{vars.trigger_message}}  what the customer sent — the typed text (or a
 *                             voice note's transcript), or the title of the
 *                             button / list row they tapped
 *   {{vars.trigger_type}}     text | voice | button | form | assistant
 *   {{vars.trigger_channel}}  whatsapp, instagram, website, …
 *
 * So a bot started by "Hotel Management fees?" can answer about Hotel
 * Management, save the question to a table, or branch on it with a
 * Condition or Switch step. A chatbot linked from another keeps the
 * original trigger.
 */
export const TRIGGER_VAR_KEYS = ['trigger_message', 'trigger_type', 'trigger_channel'] as const

export function triggerVars(message: ParsedInbound, channel?: string | null): Record<string, string> {
  const vars: Record<string, string> = {}
  if (message.kind === 'text') {
    // The assistant starting a bot itself has no customer message.
    const fromAssistant = message.meta_message_id.startsWith('assistant:')
    vars.trigger_message = message.text.slice(0, 1000)
    vars.trigger_type = fromAssistant ? 'assistant' : message.was_voice ? 'voice' : 'text'
  } else if (message.kind === 'interactive_reply') {
    vars.trigger_message = message.reply_title.slice(0, 1000)
    vars.trigger_type = 'button'
  } else {
    vars.trigger_message = ''
    vars.trigger_type = 'form'
  }
  if (channel) vars.trigger_channel = channel
  return vars
}

/** The trigger variables of a run, to carry into a chatbot it links to. */
export function carriedTriggerVars(vars: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of TRIGGER_VAR_KEYS) {
    const v = vars?.[k]
    if (typeof v === 'string') out[k] = v
  }
  return out
}
