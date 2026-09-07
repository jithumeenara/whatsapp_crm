import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiGenerateArgs, AiProviderAdapter } from './types'
import { errorMessage } from './types'
import { geminiAdapter } from './gemini'
import { openaiAdapter } from './openai'
import { anthropicAdapter } from './anthropic'
import { deepseekAdapter, openaiCompatibleAdapter } from './openai-compatible'

/** Every registered adapter, keyed by provider id. Adding a new named
 *  provider means adding one adapter file and one line here — the
 *  Settings UI's provider picker is generated FROM this map (see
 *  ads-tab.tsx's ProviderRail for the pattern being followed), so no
 *  second list needs to stay in sync by hand. */
export const PROVIDERS: Record<string, AiProviderAdapter> = {
  gemini: geminiAdapter,
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  deepseek: deepseekAdapter,
  custom: openaiCompatibleAdapter,
}

export interface ProviderKeyEntry {
  /** Encrypted (via src/lib/whatsapp/encryption.ts encrypt()) — never
   *  stored or logged in plaintext. */
  api_key: string
  model: string
  /** "custom" only (optionally overrides "deepseek"'s default). */
  base_url?: string
}
export type ProviderKeys = Record<string, ProviderKeyEntry>

export function getProviderKeys(aiConfig: { provider_keys: unknown }): ProviderKeys {
  return (aiConfig.provider_keys as ProviderKeys | null) ?? {}
}

/** Single dispatcher — looks up the adapter and calls it. Both real
 *  consumers (the flows engine's ai_reply node and the Settings > AI
 *  Config test endpoint) should generally prefer
 *  generateAiReplyWithFallback below; this raw form is for the test
 *  endpoint's "try this exact provider/key the user just typed, don't
 *  fail over to anything" use case. */
export async function generateAiReply(
  providerId: string,
  config: {
    apiKey: string
    model: string
    baseUrl?: string
    temperature: number
    maxTokens: number
    systemPrompt?: string
  },
  userMessage: string,
  conversationHistory: AiGenerateArgs['conversationHistory'] = [],
): Promise<string> {
  const adapter = PROVIDERS[providerId]
  if (!adapter) throw new Error(`Unknown AI provider: ${providerId}`)
  return adapter.generateReply({ ...config, userMessage, conversationHistory })
}

export interface AiReplyResult {
  reply: string
  usedProvider: string
  usedFallback: boolean
}

/**
 * Resolves the account's active provider's saved key/model, generates a
 * reply, and — on a retryable failure (rate limit, transient outage) or a
 * simply-unconfigured active provider — retries once against the
 * configured fallback provider if one exists and has its own saved key.
 * This is the real reliability payoff of supporting multiple providers:
 * a chatbot mid-conversation should fail over, not just die, when one
 * vendor has a bad moment. This is what src/lib/flows/engine.ts's
 * ai_reply node calls.
 */
export async function generateAiReplyWithFallback(
  aiConfig: {
    active_provider: string
    fallback_provider: string | null
    provider_keys: unknown
    temperature: number
    max_tokens: number
  },
  systemPrompt: string,
  userMessage: string,
  conversationHistory: AiGenerateArgs['conversationHistory'] = [],
): Promise<AiReplyResult> {
  const keys = getProviderKeys(aiConfig)
  const activeEntry = keys[aiConfig.active_provider]
  const fallbackId = aiConfig.fallback_provider
  const fallbackEntry = fallbackId ? keys[fallbackId] : undefined

  const call = (providerId: string, entry: ProviderKeyEntry) =>
    generateAiReply(
      providerId,
      {
        apiKey: decrypt(entry.api_key),
        model: entry.model,
        baseUrl: entry.base_url,
        temperature: aiConfig.temperature,
        maxTokens: aiConfig.max_tokens,
        systemPrompt,
      },
      userMessage,
      conversationHistory,
    )

  // Active provider was never actually configured with a key — go
  // straight to the fallback (if any) rather than making a call that's
  // guaranteed to fail.
  if (!activeEntry?.api_key) {
    if (fallbackId && fallbackEntry?.api_key) {
      const reply = await call(fallbackId, fallbackEntry)
      return { reply, usedProvider: fallbackId, usedFallback: true }
    }
    throw new Error(`No API key configured for the active AI provider (${aiConfig.active_provider}). Set one up in Settings > AI Config.`)
  }

  try {
    const reply = await call(aiConfig.active_provider, activeEntry)
    return { reply, usedProvider: aiConfig.active_provider, usedFallback: false }
  } catch (err) {
    const adapter = PROVIDERS[aiConfig.active_provider]
    const classified = adapter ? adapter.classifyError(err) : { message: errorMessage(err), retryable: false }
    if (classified.retryable && fallbackId && fallbackEntry?.api_key) {
      try {
        const reply = await call(fallbackId, fallbackEntry)
        return { reply, usedProvider: fallbackId, usedFallback: true }
      } catch (fallbackErr) {
        throw new Error(
          `Primary AI provider (${aiConfig.active_provider}) failed: ${classified.message}. Fallback (${fallbackId}) also failed: ${errorMessage(fallbackErr)}`,
        )
      }
    }
    throw new Error(classified.message)
  }
}
