/**
 * Records what each AI call actually consumed.
 *
 * Two rules this module exists to hold:
 *
 *  1. Recording never breaks the thing being recorded. Every write is
 *     wrapped and failure-tolerant — a customer's WhatsApp reply must
 *     not depend on an analytics insert succeeding.
 *  2. Measured and estimated are kept separate. Token counts come from
 *     the provider's own response, so they're what the vendor counted.
 *     Cost comes from pricing.ts and is therefore an estimate — every
 *     surface that displays it says "estimated", and says which
 *     figures are guesses rather than published rates.
 */

import { prisma } from '@/lib/db'

export type UsageFeature =
  | 'chat_customer'
  | 'chat_admin'
  | 'test'
  | 'embedding'
  | 'translation'
  | 'validation'
  /// Grading a run of the evaluation suite. Tracked separately from
  /// 'test' so a suite run's cost is visible as its own line rather
  /// than blurred into the Test AI screen's usage.
  | 'eval_grading'
  /// Text-to-speech for a voice reply, on the built-in Gemini engine.
  /// Billed in audio output tokens, which dominate a voice note's cost.
  ///
  /// Every row recorded before Google Cloud TTS was tracked at all is a
  /// Gemini one, so this has always meant exactly what it means now —
  /// no history is reinterpreted by the split.
  | 'tts'
  /// The same job on Google Cloud TTS, kept apart because the two are
  /// not comparable: different voices, different quality, and one is
  /// billed per audio token while the other is billed per character.
  /// Adding them into a single "voice" line would hide which engine an
  /// account is actually paying for.
  | 'tts_cloud'
  /// Turning a customer's voice note into text.
  | 'transcription'
  /// Reading a scanned PDF into the knowledge base. Its own line
  /// because it is one of the larger single charges an account can
  /// incur here — a 60-page scan is 60 images of input — and one it
  /// pays once per document rather than per message.
  | 'pdf_ocr'
  /// Reading a finished conversation to decide whether it was a real
  /// enquiry. Its own line because it is the one charge an account
  /// incurs per conversation rather than per message, and because
  /// somebody weighing up whether the Suggested tab earns its keep
  /// needs to see what it costs beside what it found.
  | 'lead_detect'

import { estimateCostUsd, type TokenCounts } from './pricing'

// Re-exported so every existing import of these from usage.ts keeps
// working. The numbers live in pricing.ts; this module is about
// writing rows.
export {
  estimateCostUsd,
  estimateCloudTtsCostUsd,
  priceFor,
  isLooselyPriced,
  PRICES_CHECKED_ON,
  type ResolvedPrice,
  type TokenCounts,
} from './pricing'

export interface RecordUsageArgs {
  accountId: string
  provider?: string
  model: string
  feature: UsageFeature
  tokens?: Partial<TokenCounts>
  status?: 'success' | 'error'
  error?: string
  latencyMs?: number
  /** Overrides the token-based estimate. For work that is genuinely not
   *  billed in tokens — Google Cloud TTS charges per character — where
   *  deriving a cost from a token count would be inventing one. */
  costUsd?: number
}

export async function recordAiUsage(args: RecordUsageArgs): Promise<void> {
  const tokens: TokenCounts = {
    inputTokens: args.tokens?.inputTokens ?? 0,
    outputTokens: args.tokens?.outputTokens ?? 0,
    totalTokens:
      args.tokens?.totalTokens ?? (args.tokens?.inputTokens ?? 0) + (args.tokens?.outputTokens ?? 0),
  }

  try {
    await prisma.aiUsageEvent.create({
      data: {
        account_id: args.accountId,
        provider: args.provider ?? 'gemini',
        model: args.model,
        feature: args.feature,
        input_tokens: tokens.inputTokens,
        output_tokens: tokens.outputTokens,
        total_tokens: tokens.totalTokens,
        cost_usd: args.costUsd ?? estimateCostUsd(args.model, tokens),
        status: args.status ?? 'success',
        // Truncated: an error string is for recognizing a pattern in the
        // Usage tab, not for storing a full stack trace per call.
        error: args.error ? args.error.slice(0, 500) : null,
        latency_ms: args.latencyMs ?? null,
      },
    })
  } catch (err) {
    // Deliberately swallowed. See this module's own header: usage
    // recording is observability, and observability failing is not a
    // reason for the feature being observed to fail.
    console.error('[ai-usage] could not record usage:', err instanceof Error ? err.message : err)
  }
}

/**
 * Approximates a token count from raw text, for the one case where the
 * provider genuinely doesn't report one: Gemini's embedContent response
 * carries only the vector, no usageMetadata (verified against the
 * installed SDK's EmbedContentResponse type, which has exactly one
 * field). ~4 characters per token is the usual English-ish rule of
 * thumb and is wrong for Malayalam, so this is a floor on the real
 * number, not a measurement.
 *
 * Kept as its own named function, rather than inlined at the call site,
 * so it is obvious in the usage record which numbers were counted by
 * the vendor and which were estimated here.
 */
export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

/** Pulls token counts out of a Gemini SDK response, whatever shape of
 *  result object the caller happens to be holding. */
export function tokensFromGemini(usageMetadata?: {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}): TokenCounts {
  return {
    inputTokens: usageMetadata?.promptTokenCount ?? 0,
    outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: usageMetadata?.totalTokenCount ?? 0,
  }
}
