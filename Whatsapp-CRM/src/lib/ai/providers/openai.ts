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
  defaultModels: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini (fast, recommended)' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1 (highest quality)' },
  ],
  generateReply: (args) => chatCompletionsRequest(OPENAI_BASE_URL, args),
  classifyError,
}
