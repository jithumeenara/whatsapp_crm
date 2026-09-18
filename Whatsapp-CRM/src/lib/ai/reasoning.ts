/**
 * How long the assistant is allowed to think before it answers.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * Gemini 3 reasons before it replies, and it does so whether or not you
 * ask. Google's own guide is explicit about both halves of that: the
 * Flash models default to `medium` thinking (the preview defaulted to
 * `high`), and "for faster, lower-latency responses when complex
 * reasoning isn't required, you can constrain the model's thinking level
 * to low" — `minimal` being the setting they name for "chat or high
 * throughput applications".
 *
 * That default is the right one for the API's median caller and the
 * wrong one here. A customer on WhatsApp has asked what the fees are;
 * the fee table has already been retrieved and handed to the model in
 * its prompt. There is nothing left to reason about, and the seconds
 * spent reasoning about it are seconds the customer spends watching a
 * typing bubble. So this app asks for `low` and lets an account raise it
 * rather than accepting the provider's default silently.
 *
 * ── Why it is gated on the model name ───────────────────────────────
 *
 * `thinkingLevel` is a Gemini 3 parameter. Sending it to a model that
 * does not document support is an error, not a no-op — and an account
 * pinned to an older model would have every reply fail rather than
 * merely run slow, which is a far worse outcome than the problem this
 * file exists to fix. Gemini 2.5 has its own, differently-shaped
 * `thinkingBudget` and is scheduled for shutdown, so it is deliberately
 * left alone here instead of being half-supported.
 *
 * Belt and braces: `isThinkingRejection` lets a caller retry once
 * without the parameter, so a model that changes its mind about
 * accepting it costs one slow reply rather than an outage.
 *
 * Verified against ai.google.dev/gemini-api/docs/generate-content/thinking
 * and .../gemini-3, September 2026. The JSON path is
 * `generationConfig.thinkingConfig.thinkingLevel` on the
 * `:generateContent` endpoint — note that the newer Interactions API
 * spells the same idea `generation_config.thinking_level`, which is a
 * different endpoint and not the one this app calls.
 */

/** What an account chooses. Deliberately not Google's vocabulary: the
 *  person setting this is running a business, not tuning a model, and
 *  'thorough' says what they get where 'high' does not. */
export type ReasoningEffort = 'minimal' | 'low' | 'balanced' | 'thorough'

export const REASONING_EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'balanced', 'thorough']

/** Our vocabulary → Gemini's. */
const THINKING_LEVEL: Record<ReasoningEffort, string> = {
  minimal: 'minimal',
  low: 'low',
  balanced: 'medium',
  thorough: 'high',
}

/** Not the provider's default, and that is the point of this module. */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low'

export function normalizeEffort(value: unknown): ReasoningEffort {
  return typeof value === 'string' && (REASONING_EFFORTS as string[]).includes(value)
    ? (value as ReasoningEffort)
    : DEFAULT_REASONING_EFFORT
}

/** True for the models documented to accept `thinkingLevel`. Anything
 *  else — an older Gemini, or any other provider's model — is left
 *  exactly as it was before this file existed. */
export function supportsThinkingLevel(model: string | null | undefined): boolean {
  return typeof model === 'string' && /^gemini-3(\.|-)/.test(model.trim())
}

/**
 * The fragment to merge into `generationConfig`, or undefined when this
 * model should not be sent one.
 *
 * Returned as a fragment rather than applied in place so the two call
 * sites — the plain provider adapter and the tool loop — can each spread
 * it into their own config without either of them knowing the field
 * name.
 */
export function thinkingConfigFor(
  model: string | null | undefined,
  effort: unknown,
): { thinkingConfig: { thinkingLevel: string } } | undefined {
  if (!supportsThinkingLevel(model)) return undefined
  return { thinkingConfig: { thinkingLevel: THINKING_LEVEL[normalizeEffort(effort)] } }
}

/**
 * Whether a failed generation looks like the provider objecting to the
 * thinking parameter specifically.
 *
 * Kept narrow on purpose. A caller retries once without the parameter on
 * a match, so a false positive costs a slow reply — but a match on, say,
 * a quota error would hide a real problem behind a silent retry.
 */
export function isThinkingRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  if (!/thinking/i.test(message)) return false
  return /invalid|unknown|not supported|unsupported|400/i.test(message)
}
