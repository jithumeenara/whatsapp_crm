import type { AiProviderAdapter, ClassifiedAiError } from './types'
import { errorMessage } from './types'
import { chatCompletionsRequest } from './openai-compatible'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

function classifyError(err: unknown): ClassifiedAiError {
  const msg = errorMessage(err)
  if (/invalid_api_key|incorrect api key/i.test(msg)) {
    return { message: 'Invalid API key. Check it at platform.openai.com/api-keys.', retryable: false }
  }
  if (/insufficient_quota|billing/i.test(msg)) {
    return { message: 'Quota exceeded or billing issue — check your OpenAI usage/billing.', retryable: false }
  }
  if (/rate_limit|429/i.test(msg)) {
    return { message: 'Rate limited by OpenAI — try again shortly.', retryable: true }
  }
  if (/model_not_found/i.test(msg)) {
    return { message: 'That model isn’t available for this API key.', retryable: false }
  }
  return { message: `OpenAI error: ${msg}`, retryable: false }
}

export const openaiAdapter: AiProviderAdapter = {
  id: 'openai',
  label: 'OpenAI (GPT)',
  // Verified against developers.openai.com/api/docs/changelog, Sept 2026 —
  // the GPT-4o/4.1 generation is legacy now that GPT-6 and the GPT-5.6
  // tiers (Sol/Terra/Luna) are current.
  defaultModels: [
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (recommended for CRM chat)' },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra (flagship, best for complex replies)' },
    { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (cheapest, highest volume)' },
  ],
  generateReply: (args) => chatCompletionsRequest(OPENAI_BASE_URL, args),
  classifyError,
}
