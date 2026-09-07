import type { AiGenerateArgs, AiProviderAdapter, ClassifiedAiError } from './types'
import { errorMessage } from './types'

/**
 * A generic OpenAI-chat-completions-compatible adapter, parameterized by
 * base URL. This one adapter covers three real cases:
 *   - OpenAI itself (openai.ts, fixed base URL)
 *   - DeepSeek (deepseek.ts, fixed base URL — DeepSeek's API deliberately
 *     mirrors OpenAI's request/response shape)
 *   - the "custom" provider slot, where the user supplies their own base
 *     URL — genuinely covers "and other providers" (Groq, Mistral,
 *     OpenRouter, a self-hosted Ollama/vLLM endpoint, etc.) without a new
 *     adapter per vendor, since all of those speak this same API shape.
 */

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string; type?: string; code?: string }
}

export async function chatCompletionsRequest(baseUrl: string, args: AiGenerateArgs): Promise<string> {
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
  if (args.systemPrompt) messages.push({ role: 'system', content: args.systemPrompt })
  for (const turn of args.conversationHistory) {
    messages.push({ role: turn.role === 'model' ? 'assistant' : 'user', content: turn.text })
  }
  messages.push({ role: 'user', content: args.userMessage })

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      messages,
      temperature: args.temperature,
      max_tokens: args.maxTokens,
    }),
  })

  const data = (await res.json().catch(() => ({}))) as OpenAiChatResponse
  if (!res.ok) {
    throw new Error(data.error?.message || `Request failed with HTTP ${res.status}`)
  }
  const reply = data.choices?.[0]?.message?.content
  if (!reply) throw new Error('No reply returned by the model.')
  return reply
}

function classifyOpenAiCompatibleError(err: unknown): ClassifiedAiError {
  const msg = errorMessage(err)
  if (/invalid_api_key|incorrect api key|unauthorized|401/i.test(msg)) {
    return { message: 'Invalid API key.', retryable: false }
  }
  if (/insufficient_quota|billing/i.test(msg)) {
    return { message: 'Quota/billing issue — check your account balance with this provider.', retryable: false }
  }
  if (/rate_limit|429|overloaded|503|502|timeout/i.test(msg)) {
    return { message: `Rate limited or temporarily unavailable: ${msg}`, retryable: true }
  }
  return { message: msg, retryable: false }
}

export const openaiCompatibleAdapter: AiProviderAdapter = {
  id: 'custom',
  label: 'Custom (OpenAI-compatible)',
  // No fixed model list exists for an arbitrary endpoint — the Settings UI
  // shows a free-text input for this provider instead of a dropdown.
  defaultModels: [],
  generateReply: (args) => chatCompletionsRequest(args.baseUrl || '', args),
  classifyError: classifyOpenAiCompatibleError,
}

export const deepseekAdapter: AiProviderAdapter = {
  id: 'deepseek',
  label: 'DeepSeek',
  // Verified against api-docs.deepseek.com/updates, Sept 2026 — V3/R1 and
  // the deepseek-chat/deepseek-reasoner aliases that used to point to them
  // are deprecated in favor of the unified V4 line.
  defaultModels: [
    { id: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash (recommended for CRM chat)' },
    { id: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro (highest quality)' },
  ],
  generateReply: (args) => chatCompletionsRequest(args.baseUrl || 'https://api.deepseek.com', args),
  classifyError: classifyOpenAiCompatibleError,
}
