import type { AiGenerateArgs, AiProviderAdapter, ClassifiedAiError } from './types'
import { errorMessage } from './types'

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>
  error?: { type?: string; message?: string }
}

/**
 * Anthropic's Messages API takes the system prompt as its own top-level
 * field (not a message in the array, unlike OpenAI/Gemini), and requires
 * the messages array to start with 'user' and strictly alternate
 * user/assistant with no two consecutive same-role turns. Real WhatsApp
 * conversation history is always naturally alternating (customer, then
 * bot, then customer, ...), but this collapses/guards against the edge
 * cases anyway (a leading assistant turn with no prior user message, or
 * two same-role turns back to back) rather than letting Anthropic reject
 * the request outright.
 */
function buildMessages(args: AiGenerateArgs): Array<{ role: 'user' | 'assistant'; content: string }> {
  const raw = [
    ...args.conversationHistory.map((m) => ({ role: (m.role === 'model' ? 'assistant' : 'user') as 'user' | 'assistant', content: m.text })),
    { role: 'user' as const, content: args.userMessage },
  ]

  // Drop any leading assistant turn(s) — Anthropic requires the first
  // message to be from 'user'.
  while (raw.length > 0 && raw[0].role === 'assistant') raw.shift()

  // Collapse consecutive same-role turns by merging their text, since
  // Anthropic rejects back-to-back same-role messages.
  const merged: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const turn of raw) {
    const last = merged[merged.length - 1]
    if (last && last.role === turn.role) {
      last.content += `\n${turn.content}`
    } else {
      merged.push({ ...turn })
    }
  }
  return merged
}

async function generateReply(args: AiGenerateArgs): Promise<string> {
  const res = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': args.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: args.maxTokens,
      temperature: args.temperature,
      system: args.systemPrompt || undefined,
      messages: buildMessages(args),
    }),
  })

  const data = (await res.json().catch(() => ({}))) as AnthropicResponse
  if (!res.ok) {
    throw new Error(data.error?.message || `Request failed with HTTP ${res.status}`)
  }
  const reply = data.content?.find((c) => c.type === 'text')?.text
  if (!reply) throw new Error('No reply returned by the model.')
  return reply
}

function classifyError(err: unknown): ClassifiedAiError {
  const msg = errorMessage(err)
  if (/authentication_error|invalid x-api-key/i.test(msg)) {
    return { message: 'Invalid API key. Check it at console.anthropic.com.', retryable: false }
  }
  if (/permission_error/i.test(msg)) {
    return { message: 'API key does not have permission for this model.', retryable: false }
  }
  if (/rate_limit_error|429/i.test(msg)) {
    return { message: 'Rate limited by Anthropic — try again shortly.', retryable: true }
  }
  if (/overloaded_error|529|503/i.test(msg)) {
    return { message: 'Anthropic is temporarily overloaded — try again shortly.', retryable: true }
  }
  return { message: `Claude error: ${msg}`, retryable: false }
}

export const anthropicAdapter: AiProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  defaultModels: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (recommended)' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast, cheap)' },
    { id: 'claude-opus-5', label: 'Claude Opus 5 (highest quality)' },
  ],
  generateReply,
  classifyError,
}
