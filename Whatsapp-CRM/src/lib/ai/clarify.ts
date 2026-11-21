/**
 * Ask before giving up.
 *
 * When the assistant is not sure it understood (low confidence), it used
 * to hand the customer to a person straight away. Often the message was
 * only vague ("how much?", "details", a single word in Manglish), and one
 * short question would have found what they meant.
 *
 * So the first time in an exchange it asks ONE clarifying question in the
 * customer's own language. If the next message is still not understood,
 * it hands over as before — the team is told on WhatsApp and Telegram —
 * and never asks a second question in a row.
 *
 * The question is tagged on the message (bot_source 'ai_clarify'), so
 * "did we just ask?" is answered from the thread itself, not from memory.
 */
import { generateAiReplyWithFallback } from '@/lib/ai/providers/registry'

export const CLARIFY_SOURCE = 'ai_clarify'

/** The same window as an exchange: after a day the customer is starting over. */
const WINDOW_MS = 24 * 60 * 60 * 1000

export interface LastAssistantMessage {
  bot_source: string | null
  created_at: Date
}

/**
 * Whether to ask a clarifying question instead of handing over now.
 * Only for "not sure I understood" (low confidence); never when the
 * conversation is already with the team, and never twice in a row.
 */
export function shouldAskToClarify(args: {
  reason: string
  conversationStatus: string | null | undefined
  /** The assistant's most recent message in this conversation, if any. */
  lastAssistant: LastAssistantMessage | null
  now: Date
}): boolean {
  if (args.reason !== 'low_confidence') return false
  if (args.conversationStatus === 'pending') return false
  const last = args.lastAssistant
  if (last && last.bot_source === CLARIFY_SOURCE && args.now.getTime() - last.created_at.getTime() < WINDOW_MS) return false
  return true
}

export function clarifySystemPrompt(): string {
  return [
    'You help a business answer customers on chat. The customer\'s last message was not clear enough to answer from the business\'s information.',
    'Ask the customer ONE short, friendly question that will tell you what they need.',
    'Reply in the same language and script the customer used (Malayalam, Manglish written in English letters, English, Hindi or another language).',
    'Do not answer the question, do not guess facts, prices or dates, and do not say you will connect them to anyone.',
    'One or two short sentences. Plain text, no lists or markdown.',
  ].join('\n')
}

export function clarifyUserMessage(customerMessage: string, recent: Array<{ role: 'user' | 'model'; text: string }>): string {
  const thread = recent
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'Customer' : 'Us'}: ${t.text.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n')
  return `${thread ? `Recent chat:\n${thread}\n\n` : ''}The customer's last message: ${customerMessage.slice(0, 500)}`
}

/** Used when the model cannot be reached: still a question, never a dead end. */
export const FALLBACK_CLARIFY = 'Sorry, I did not quite understand. Could you tell me a little more about what you need?'

/** One or two sentences of plain text, at most 300 characters. */
export function cleanClarify(reply: string): string {
  const plain = reply.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim()
  if (!plain) return ''
  const sentences = plain.match(/[^.!?।]+[.!?।]+(?=\s|$)|[^.!?।]+$/g) ?? [plain]
  return sentences.slice(0, 2).map((x) => x.trim()).join(' ').slice(0, 300)
}

type AiConfigForClarify = Parameters<typeof generateAiReplyWithFallback>[0]

/** The clarifying question, or the fallback line if the model fails. */
export async function makeClarifyingQuestion(
  aiConfig: AiConfigForClarify,
  customerMessage: string,
  recent: Array<{ role: 'user' | 'model'; text: string }>,
): Promise<{ text: string; usage?: unknown; provider?: string; model?: string }> {
  try {
    const result = await generateAiReplyWithFallback(
      { ...aiConfig, temperature: Math.min(aiConfig.temperature, 0.4), max_tokens: Math.min(aiConfig.max_tokens || 200, 200) },
      clarifySystemPrompt(),
      clarifyUserMessage(customerMessage, recent),
    )
    const text = cleanClarify(result.reply ?? '')
    return { text: text || FALLBACK_CLARIFY, usage: result.usage, provider: result.usedProvider, model: result.usedModel }
  } catch (err) {
    console.error('[clarify] could not write a question:', err instanceof Error ? err.message : err)
    return { text: FALLBACK_CLARIFY }
  }
}
