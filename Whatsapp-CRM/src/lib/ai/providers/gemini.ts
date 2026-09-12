import { GoogleGenerativeAI, FinishReason, HarmCategory, HarmBlockThreshold } from '@google/generative-ai'
import type { AiGenerateArgs, AiGenerateResult, AiProviderAdapter, ClassifiedAiError } from './types'
import { AI_REQUEST_TIMEOUT_MS } from './types'

/**
 * AiConfig.safety_filter -> Gemini's own HarmBlockThreshold, applied to
 * every harm category the SDK defines (enum values ground-truthed from
 * the installed SDK's .d.ts, not assumed).
 *
 * 'balanced' is BLOCK_MEDIUM_AND_ABOVE, which is Gemini's own default —
 * so an account that never touches this setting behaves exactly as it
 * did before the setting existed. BLOCK_NONE is deliberately not
 * reachable: fully disabling safety on a bot that talks to real
 * customers is not something to expose as a dropdown option.
 */
const SAFETY_THRESHOLDS: Record<string, HarmBlockThreshold> = {
  strict: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
  balanced: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  relaxed: HarmBlockThreshold.BLOCK_ONLY_HIGH,
}

const HARM_CATEGORIES = [
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
]

function buildSafetySettings(filter: string | undefined) {
  const threshold = SAFETY_THRESHOLDS[filter ?? 'balanced'] ?? SAFETY_THRESHOLDS.balanced
  return HARM_CATEGORIES.map((category) => ({ category, threshold }))
}

async function generateReply(args: AiGenerateArgs): Promise<AiGenerateResult> {
  const genAI = new GoogleGenerativeAI(args.apiKey)
  const model = genAI.getGenerativeModel(
    {
      model: args.model,
      generationConfig: {
        temperature: args.temperature,
        maxOutputTokens: args.maxTokens,
      },
      safetySettings: buildSafetySettings(args.safetyFilter),
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
  const usage = result.response.usageMetadata
  return {
    text: result.response.text(),
    truncated: finishReason === FinishReason.MAX_TOKENS,
    ...(usage
      ? {
          usage: {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
          },
        }
      : {}),
  }
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
