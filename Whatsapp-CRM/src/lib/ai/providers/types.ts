/**
 * Normalized contract every AI provider adapter implements. Callers
 * (the chatbot flow engine's ai_reply node, the Settings > AI Config test
 * endpoint) build one plain-text systemPrompt themselves — already
 * including whatever relevance-filtered knowledge base content and
 * guardrail instructions apply (see src/lib/ai/knowledge.ts) — and pass it
 * through here unchanged. Adapters never assemble their own knowledge
 * base text; that's a caller concern, kept in one place instead of
 * duplicated per vendor.
 */

export interface AiGenerateArgs {
  apiKey: string
  model: string
  /** Only meaningful for the "custom" (OpenAI-compatible) provider, and as
   *  an optional override for "deepseek". Ignored by gemini/openai/anthropic,
   *  which always use their own fixed API base. */
  baseUrl?: string
  temperature: number
  maxTokens: number
  systemPrompt?: string
  /**
   * 'model' (not 'assistant') deliberately matches Gemini's own role
   * vocabulary — the SDK this app already uses for Gemini takes exactly
   * this shape. Every other adapter remaps internally to its own vendor's
   * role name ("assistant" for OpenAI/Anthropic/DeepSeek/custom).
   */
  conversationHistory: Array<{ role: 'user' | 'model'; text: string }>
  userMessage: string
}

export interface AiGenerateResult {
  text: string
  /** True when the provider stopped generating because it hit maxTokens,
   *  not because it actually finished the thought — a mid-sentence-cut
   *  reply looks identical to a complete one unless a caller checks this.
   *  Found as a real bug (Sept 2026): every adapter silently returned
   *  whatever partial text came back with no signal at all, so both the
   *  Test AI screen and real customer-facing WhatsApp replies could be
   *  truncated with nothing telling anyone it happened. */
  truncated: boolean
}

export interface ClassifiedAiError {
  message: string
  /** True for rate limits / transient 5xx — worth retrying against a
   *  fallback provider. False for auth/invalid-key/bad-request errors,
   *  where a fallback provider would just fail the same way for a
   *  different reason (or succeed for an unrelated reason that masks a
   *  real misconfiguration) — surface those directly instead. */
  retryable: boolean
}

export interface AiProviderAdapter {
  id: string
  label: string
  /** Shown in the model dropdown; the first entry doubles as the default
   *  used for the Settings page's live API-key validation call. */
  defaultModels: Array<{ id: string; label: string }>
  generateReply(args: AiGenerateArgs): Promise<AiGenerateResult>
  classifyError(err: unknown): ClassifiedAiError
}

/** Shared by every REST-based adapter (all but Gemini, which uses its own
 *  SDK) — a plain string message extracted from a thrown Error, since
 *  fetch-based adapters always throw Error with the vendor's message
 *  already embedded (see providers/openai-compatible.ts). */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * None of the four provider calls used to set any request timeout at
 * all — a slow or hung provider meant the customer (and the fallback
 * provider this app already supports) just waited indefinitely, since
 * Node's global fetch has no default timeout and neither did the Gemini
 * SDK call. Found live (Sept 2026) while investigating "AI replies
 * arrive late" reports. 20s is generous headroom over a normal Flash/
 * Haiku-class reply (typically 1-3s) while still giving the existing
 * fallback-to-secondary-provider logic (registry.ts) a real chance to
 * kick in instead of the whole flow hanging on one slow request.
 */
export const AI_REQUEST_TIMEOUT_MS = 20_000
