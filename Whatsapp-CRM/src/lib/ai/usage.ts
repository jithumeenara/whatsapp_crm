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
 *     Cost is derived from the price table below and is therefore an
 *     estimate that drifts whenever Google changes pricing — every
 *     surface that displays it says "estimated" for that reason.
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

export interface TokenCounts {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * USD per 1 million tokens, from ai.google.dev/pricing (Sept 2026).
 *
 * Matched by longest-prefix so a model id this table has never seen
 * (a new Flash revision, say) still gets a sane family rate instead of
 * silently costing zero. A completely unknown id falls through to zero
 * cost and is recorded honestly as such — the token counts are still
 * exact, and the UI's "estimated" label carries the caveat.
 */
const PRICES: Array<{ prefix: string; input: number; output: number }> = [
  { prefix: 'gemini-3.8-flash', input: 0.30, output: 2.50 },
  { prefix: 'gemini-3.6-flash', input: 0.15, output: 0.60 },
  { prefix: 'gemini-3.5-flash-lite', input: 0.05, output: 0.20 },
  { prefix: 'gemini-3.5-flash', input: 0.15, output: 0.60 },
  { prefix: 'gemini-embedding', input: 0.02, output: 0 },
  // Family fallbacks, so an unrecognized point release still prices.
  { prefix: 'gemini-3', input: 0.15, output: 0.60 },
  { prefix: 'gemini', input: 0.15, output: 0.60 },
]

export function estimateCostUsd(model: string, tokens: TokenCounts): number {
  const id = model.toLowerCase()
  const price = PRICES.find((p) => id.startsWith(p.prefix))
  if (!price) return 0
  const cost = (tokens.inputTokens / 1_000_000) * price.input + (tokens.outputTokens / 1_000_000) * price.output
  // 6dp matches the column; below that a single cheap call rounds away
  // to nothing and the daily total under-reports.
  return Number(cost.toFixed(6))
}

export interface RecordUsageArgs {
  accountId: string
  provider?: string
  model: string
  feature: UsageFeature
  tokens?: Partial<TokenCounts>
  status?: 'success' | 'error'
  error?: string
  latencyMs?: number
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
        cost_usd: estimateCostUsd(args.model, tokens),
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
