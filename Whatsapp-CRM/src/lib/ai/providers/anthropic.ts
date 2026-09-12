import type { AiGenerateArgs, AiGenerateResult, AiProviderAdapter, ClassifiedAiError } from './types'
import { errorMessage, AI_REQUEST_TIMEOUT_MS } from './types'

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
  stop_reason?: string
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

async function generateReply(args: AiGenerateArgs): Promise<AiGenerateResult> {
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
    // No timeout here before meant a hung/slow Anthropic response just
    // hung the whole reply — see AI_REQUEST_TIMEOUT_MS's own comment.
    signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
  })

  const data = (await res.json().catch(() => ({}))) as AnthropicResponse
  if (!res.ok) {
    throw new Error(data.error?.message || `Request failed with HTTP ${res.status}`)
  }
  const reply = data.content?.find((c) => c.type === 'text')?.text
  if (!reply) throw new Error('No reply returned by the model.')
  return {
    text: reply,
    truncated: data.stop_reason === 'max_tokens',
    ...(data.usage
      ? {
          usage: {
            inputTokens: data.usage.input_tokens ?? 0,
            outputTokens: data.usage.output_tokens ?? 0,
            totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
          },
        }
      : {}),
  }
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
  // AbortSignal.timeout() firing throws a DOMException named 'TimeoutError'
  // — treated as retryable so a hung/slow Claude attempt still falls over
  // to whatever fallback provider is configured.
  if ((err instanceof DOMException && err.name === 'TimeoutError') || /timeout/i.test(msg)) {
    return { message: 'Claude took too long to respond — try again shortly.', retryable: true }
  }
  return { message: `Claude error: ${msg}`, retryable: false }
}

export const anthropicAdapter: AiProviderAdapter = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  // Verified against platform.claude.com/docs/en/models/overview, Sept
  // 2026 — Sonnet 5 is the best speed/intelligence balance for a
  // high-volume CRM chat node; Opus 5 is Anthropic's own "start here for
  // most workloads" pick when cost is less of a concern; Fable 5.1 is
  // reserved for demanding, long-horizon reasoning most chatbot replies
  // don't need.
  defaultModels: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (recommended for CRM chat)' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fastest, cheapest)' },
    { id: 'claude-opus-5', label: 'Claude Opus 5 (Anthropic’s pick for most workloads)' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (demanding reasoning, long-horizon agents)' },
  ],
  generateReply,
  classifyError,
}
