import { GoogleGenerativeAI, FinishReason } from '@google/generative-ai'
import type { AiGenerateArgs, AiGenerateResult, AiProviderAdapter, ClassifiedAiError } from './types'
import { AI_REQUEST_TIMEOUT_MS } from './types'

async function generateReply(args: AiGenerateArgs): Promise<AiGenerateResult> {
  const genAI = new GoogleGenerativeAI(args.apiKey)
  const model = genAI.getGenerativeModel(
    {
      model: args.model,
      generationConfig: {
        temperature: args.temperature,
        maxOutputTokens: args.maxTokens,
      },
      systemInstruction: args.systemPrompt || 'You are a helpful assistant.',
    },
    // Ground-truthed against the installed SDK's own .d.ts (RequestOptions.timeout,
    // milliseconds) rather than assumed — see AI_REQUEST_TIMEOUT_MS's own comment.
    { timeout: AI_REQUEST_TIMEOUT_MS },
  )

  const history = args.conversationHistory.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }))

  const chat = model.startChat({ history })
  const result = await chat.sendMessage(args.userMessage)
  const finishReason = result.response.candidates?.[0]?.finishReason
  return { text: result.response.text(), truncated: finishReason === FinishReason.MAX_TOKENS }
}

function classifyError(err: unknown): ClassifiedAiError {
  const msg = err instanceof Error ? err.message : String(err)
  const name = err instanceof Error ? err.name : ''
  if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
    return { message: 'Invalid API key. Check it at aistudio.google.com.', retryable: false }
  }
  if (msg.includes('PERMISSION_DENIED')) {
    return { message: 'API key does not have permission for this model.', retryable: false }
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
    return { message: 'Quota exceeded. Check your Gemini API usage limits.', retryable: true }
  }
  // GoogleGenerativeAIAbortError — thrown by the SDK when our own
  // requestOptions.timeout (see generateReply above) fires. Treated as
  // retryable so a hung/slow Gemini attempt still falls over to whatever
  // fallback provider is configured, instead of the whole reply just
  // failing after the full timeout with no second chance.
  if (name === 'GoogleGenerativeAIAbortError' || /aborted|timeout/i.test(msg)) {
    return { message: 'Gemini took too long to respond — try again shortly.', retryable: true }
  }
  return { message: `Gemini error: ${msg}`, retryable: false }
}

export const geminiAdapter: AiProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  // Verified against ai.google.dev/gemini-api/docs/models, Sept 2026 —
  // gemini-2.0-* is already shut down and the 1.5 series is long retired;
  // 2.5-* is scheduled to shut down Oct 16-20, 2026, so it's deliberately
  // not offered here even though it still technically works today.
  defaultModels: [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (recommended for CRM chat — fast, low cost)' },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (most capable Flash, best for complex replies)' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (cheapest, highest volume)' },
  ],
  generateReply,
  classifyError,
}
