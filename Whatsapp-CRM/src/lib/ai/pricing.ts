/**
 * What Google charges for a model, and when that changes.
 *
 * Split out from usage.ts because that module talks to the database and
 * this one is arithmetic. The Usage tab needs to say which figures are
 * guesses, and a client component cannot import a module that pulls in
 * Prisma. Keeping the prices pure is what lets the same numbers be used
 * on both sides without shipping a database client to the browser.
 */

export interface TokenCounts {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * What Google charges, and when it changes.
 *
 * -- Why the numbers here were wrong ---------------------------------
 *
 * The first version of this table was out by five to twenty times on
 * every row, and nothing in the app could notice. Two habits caused
 * that, and both are fixed here rather than in the numbers alone:
 *
 *   - A model with no row of its own fell through to a family rate
 *     silently. `gemini-3.5-transcribe` matched a row written as
 *     `gemini-3.5-flash-transcribe` -- one word too many, a model id
 *     that does not exist -- so every voice note was priced as chat, at
 *     a twentieth of the real rate, for as long as the feature existed.
 *     A fallback nobody can see is a wrong answer nobody reports.
 *   - Nothing recorded when the numbers were last checked, so "is this
 *     still right?" had no answer short of reading Google's site.
 *
 * So `priceFor` reports whether it found an exact row or guessed, and
 * PRICES_CHECKED_ON travels with the figures.
 *
 * -- Why prices carry dates ------------------------------------------
 *
 * Google's current Flash pricing is promotional and doubles on 1
 * January 2027 -- their page says, of Gemini 3.6/3.7/3.8 Flash, "$0.75
 * through December 31, 2026. $1.50 starting January 1, 2027." A flat
 * table would have quietly halved every estimate from New Year's Day.
 * Each rate therefore knows the window it applies to, and a call is
 * priced at the moment it happened.
 *
 * All figures verified verbatim against ai.google.dev/gemini-api/docs/
 * pricing, paid tier, on the date below. Every model here is "Free of
 * charge" on the free tier -- an account that has not enabled billing
 * pays nothing, and these estimates are then what it *would* cost.
 */

/** When a person last read Google's pricing page and checked every row
 *  below against it. Shown beside the totals, because a number whose
 *  age is invisible gets trusted long after it stops being true. */
export const PRICES_CHECKED_ON = '2026-09-20'

/** Google's promotional Flash pricing ends at this instant and the
 *  rates double. Quoted from their own page; see the header. */
const FLASH_PRICE_RISE = Date.parse('2027-01-01T00:00:00Z')

interface Rate {
  input: number
  output: number
  /** Applies from this instant. Absent means "from the beginning". */
  from?: number
  /** Applies until this instant. Absent means "indefinitely". */
  until?: number
}

interface PriceRow {
  prefix: string
  rates: Rate[]
  /** False when this is not the model's own published rate -- a family
   *  fallback, or a model Google's pricing page no longer lists. */
  verified?: false
}

/** Promotional now, double from January. Written once so the three
 *  models sharing the change cannot drift apart. */
function flashPromo(now: number, then: number): Rate[] {
  return [
    { input: now, output: now * 5, until: FLASH_PRICE_RISE },
    { input: then, output: then * 5, from: FLASH_PRICE_RISE },
  ]
}

const PRICES: PriceRow[] = [
  // "$0.75 through December 31, 2026. $1.50 starting January 1, 2027."
  // Output is exactly 5x input on all three.
  { prefix: 'gemini-3.8-flash', rates: flashPromo(0.75, 1.5) },
  { prefix: 'gemini-3.7-flash', rates: flashPromo(0.75, 1.5) },
  { prefix: 'gemini-3.6-flash', rates: flashPromo(0.75, 1.5) },

  // Not promotional -- flat, and dearer than the newer Flashes.
  { prefix: 'gemini-3.5-flash-lite', rates: [{ input: 0.3, output: 2.5 }] },
  { prefix: 'gemini-3.5-flash', rates: [{ input: 1.5, output: 9.0 }] },

  // Audio in, text out. The row this replaces was named
  // "gemini-3.5-flash-transcribe", which is not a model.
  { prefix: 'gemini-3.5-transcribe', rates: [{ input: 2.0, output: 12.0 }] },

  // Text in, audio out. Audio output is the expensive half, which is
  // why a voice reply costing nothing on this tab was so misleading.
  { prefix: 'gemini-3.1-flash-tts', rates: [{ input: 1.0, output: 20.0 }] },
  { prefix: 'gemini-2.5-flash-preview-tts', rates: [{ input: 0.5, output: 10.0 }] },

  // gemini-embedding-001 is what this app embeds with, and Google's
  // pricing page no longer lists it -- only gemini-embedding-2. Priced
  // at embedding-2's text rate and flagged, because the nearest
  // documented number shown as uncertain is more use than a confident
  // wrong one, and far more use than a silent zero.
  { prefix: 'gemini-embedding', rates: [{ input: 0.2, output: 0 }], verified: false },

  // Family fallbacks, reached only by a model this table has never
  // seen. Every call landing here is reported as a guess.
  { prefix: 'gemini-3', rates: flashPromo(0.75, 1.5), verified: false },
  { prefix: 'gemini', rates: flashPromo(0.75, 1.5), verified: false },
]

/**
 * Longest prefix first, so the first match is the most specific.
 *
 * Sorted rather than trusted to hand-ordering: this list had already
 * drifted once, with a transcription row sitting after the chat row it
 * needed to beat.
 */
const PRICES_BY_SPECIFICITY = [...PRICES].sort((a, b) => b.prefix.length - a.prefix.length)

export interface ResolvedPrice {
  input: number
  output: number
  /** True when the model has a published rate of its own. False means
   *  the figure is the nearest thing this table knows. */
  exact: boolean
}

/**
 * The rate for one model at one moment.
 *
 * `at` is when the call happened, not when the question is asked, so a
 * reply sent in December keeps December's price when it is read back in
 * February.
 */
export function priceFor(model: string, at: Date = new Date()): ResolvedPrice | null {
  const id = model.trim().toLowerCase()
  if (!id) return null
  const row = PRICES_BY_SPECIFICITY.find((p) => id.startsWith(p.prefix))
  if (!row) return null

  const when = at.getTime()
  const rate =
    row.rates.find((r) => (r.from ?? -Infinity) <= when && when < (r.until ?? Infinity)) ??
    row.rates[row.rates.length - 1]

  return {
    input: rate.input,
    output: rate.output,
    exact: row.verified !== false && row.prefix === id,
  }
}

/** True when this app is pricing the model by guesswork -- no row of
 *  its own, or a row Google no longer publishes. The Usage tab says so
 *  rather than presenting the figure as fact. */
export function isLooselyPriced(model: string, at: Date = new Date()): boolean {
  return priceFor(model, at)?.exact !== true
}

/** Google Cloud TTS is billed per character, not per token, and the
 *  voices this app uses are Chirp3-HD. Verified against
 *  cloud.google.com/text-to-speech pricing, September 2026: Standard and
 *  WaveNet $4, Neural2 $16, Chirp 3 HD $30, Studio $160 per million
 *  characters. */
const CLOUD_TTS_USD_PER_MILLION_CHARS = 30

export function estimateCloudTtsCostUsd(characters: number): number {
  return Number(((Math.max(0, characters) / 1_000_000) * CLOUD_TTS_USD_PER_MILLION_CHARS).toFixed(6))
}

export function estimateCostUsd(
  model: string,
  tokens: TokenCounts,
  at: Date = new Date(),
): number {
  const price = priceFor(model, at)
  if (!price) return 0
  const cost =
    (tokens.inputTokens / 1_000_000) * price.input +
    (tokens.outputTokens / 1_000_000) * price.output
  // 6dp matches the column; below that a single cheap call rounds away
  // to nothing and the daily total under-reports.
  return Number(cost.toFixed(6))
}

