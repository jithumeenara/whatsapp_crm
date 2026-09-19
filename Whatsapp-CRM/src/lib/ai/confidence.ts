/**
 * Deciding whether the assistant should answer at all.
 *
 * The previous gate was a single number: retrieval similarity against a
 * threshold. That misses the two most common ways a reply goes wrong
 * while retrieval looks healthy.
 *
 *   - The question is vague ("how much?"), so it embeds close to
 *     everything and retrieves something with high similarity that is
 *     not actually an answer.
 *   - The customer has now asked three times. Similarity is fine each
 *     time, and each time the answer has not landed. Retrieval score
 *     cannot see that, because it only ever looks at one message.
 *
 * So confidence here is a blend: retrieval is still the largest term,
 * with penalties for the signals retrieval is blind to. Every penalty
 * subtracts — none can push confidence above what retrieval supports,
 * because no amount of a customer being polite makes a missing fee list
 * present.
 *
 * The weights are judgement, not measurement. They were chosen to be
 * conservative and legible rather than tuned, because tuning without the
 * evaluation suite would be fitting to whichever example was open at the
 * time. Once suites are running regularly these are the first numbers
 * worth revisiting — see src/lib/ai/eval/.
 */

export type ConfidenceSignal = {
  label: string
  /** Negative values reduce confidence. */
  delta: number
  detail: string
}

export type ConfidenceAssessment = {
  /** Final 0-1 score, after penalties. */
  score: number
  /** What retrieval alone said, before any penalty. */
  retrievalScore: number
  signals: ConfidenceSignal[]
  /** Human-readable, for the handoff note and the test screens. */
  explain: string
}

/** Questions shorter than this carry almost no retrievable content.
 *  "price?" is the canonical case. */
const VAGUE_WORD_COUNT = 3

/** ...but only when the text is also short in characters. Three words of
 *  Malayalam can be a full, specific question; three words of English
 *  ("what about it") usually is not. */
const VAGUE_CHAR_COUNT = 24

/** Words that signal the customer is not getting anywhere. Matched as
 *  whole words against the last few customer turns. */
const FRUSTRATION_MARKERS = [
  'not working', 'still waiting', 'again', 'already told', 'already said',
  'no response', 'no reply', 'useless', 'worst', 'pathetic', 'cheating',
  'fraud', 'complaint', 'refund', 'cancel', 'legal', 'consumer court',
  'manager', 'supervisor', 'human', 'real person', 'speak to someone',
]

/** Question words that, on their own, ask for something specific enough
 *  that a vague-length penalty would be wrong. "when?" is short but
 *  precise in context. */
const SPECIFIC_SHORT_FORMS = ['when', 'where', 'how much', 'what time', 'price', 'fees', 'fee']

/**
 * How many times this question was asked *and answered* before now.
 *
 * With the turns available, a prior customer message counts only if a
 * model turn follows it — that is what makes it an unsatisfied
 * question rather than a duplicate delivery or a double tap.
 *
 * Without them, falls back to counting matching customer messages, so
 * an older caller behaves exactly as it used to.
 */
function countAnsweredRepeats(
  normalizedNow: string,
  turns: Array<{ role: 'user' | 'model'; text: string }> | undefined,
  fallbackHistory: string[],
): number {
  if (!turns || turns.length === 0) {
    return fallbackHistory.filter((m) => similarEnough(normalizeForCompare(m), normalizedNow)).length
  }

  let count = 0
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]
    if (turn.role !== 'user') continue
    if (!similarEnough(normalizeForCompare(turn.text), normalizedNow)) continue
    // Answered iff anything of ours came after it.
    if (turns.slice(i + 1).some((t) => t.role === 'model')) count += 1
  }
  return count
}

export function assessConfidence(args: {
  /** Cosine similarity of the best usable knowledge match, 0-1. */
  retrievalConfidence: number
  /** The message being answered. */
  customerMessage: string
  /** Recent customer turns, newest last. Used for repetition and tone. */
  recentCustomerMessages?: string[]
  /** True when the model answered using a tool lookup rather than only
   *  retrieved text — a looked-up fact is grounded by construction. */
  usedTools?: boolean
  /** True when nothing at all was retrieved. */
  knowledgeEmpty?: boolean
  /** True when the assistant had just asked this customer something.
   *  A one-word reply to a question is an answer, not a vague enquiry. */
  isAnsweringOurQuestion?: boolean
  /** The recent turns with their speakers, newest last.
   *
   *  Needed because "asked again" is a claim about *us*, not about them:
   *  it means we answered and the answer did not land. Without the
   *  interleaving there is no way to tell that from a customer whose
   *  message arrived twice, and the two deserve opposite treatment. */
  conversationTurns?: Array<{ role: 'user' | 'model'; text: string }>
}): ConfidenceAssessment {
  const retrievalScore = clamp01(args.retrievalConfidence)
  const signals: ConfidenceSignal[] = []
  const message = (args.customerMessage || '').trim()
  const history = args.recentCustomerMessages ?? []

  // ── Nothing retrieved ────────────────────────────────────────
  // A tool lookup is its own grounding, so an empty knowledge base is
  // not disqualifying when the answer came from a record.
  if (args.knowledgeEmpty && !args.usedTools) {
    signals.push({
      label: 'No knowledge retrieved',
      delta: -0.35,
      detail: 'Nothing in the knowledge base matched this question.',
    })
  }

  // ── Vague question ───────────────────────────────────────────
  //
  // Word count alone is biased against agglutinative languages, and this
  // was caught in live testing: the Malayalam sentence
  // "എനിക്ക് കോഴ്സിനെക്കുറിച്ച് അറിയണം" ("I want to know about the
  // course") is three words and completely specific, but scored as vague
  // and lost 0.15 for it. Malayalam, Tamil and Kannada pack into one
  // word what English spreads over four, so a character-length floor
  // runs alongside the word count and a question long enough to carry
  // real content is never called vague on word count alone.
  const words = message.split(/\s+/).filter(Boolean)
  const lower = message.toLowerCase()
  const isSpecificShortForm = SPECIFIC_SHORT_FORMS.some((f) => lower.includes(f))
  const longEnoughToBeSpecific = message.length >= VAGUE_CHAR_COUNT
  //
  // And a reply to a question we just asked is never vague, whatever its
  // length. "upcoming" means nothing on its own and everything after
  // "which programme would you like to register for?" — but it scored as
  // a vague enquiry, dropped under the handoff threshold, and the
  // customer was passed to a colleague halfway through answering. Taking
  // a registration is nine short answers in a row; every one of them
  // would have tripped this.
  //
  // And the penalty says of itself that the message is "too short to
  // retrieve against reliably". When retrieval came back with usable
  // context, that premise is simply false, and charging for it anyway
  // double-counts: the retrieval score already reflects how good the
  // match was. On a live number "Upcoming training" was handed to a
  // colleague and "Upcoming training programme" answered in full, with
  // the same knowledge behind both — the only difference being that one
  // crossed a character count.
  const retrievedSomething = args.knowledgeEmpty === false
  if (
    words.length > 0 &&
    words.length <= VAGUE_WORD_COUNT &&
    !isSpecificShortForm &&
    !longEnoughToBeSpecific &&
    !args.isAnsweringOurQuestion &&
    !retrievedSomething
  ) {
    signals.push({
      label: 'Very short question',
      delta: -0.15,
      detail: `"${message}" is too short to retrieve against reliably.`,
    })
  }

  // ── Repeated asking ──────────────────────────────────────────
  //
  // Compared on a normalised form so "how much is the fee" and "How much
  // is the fee?" count as the same question asked twice.
  //
  // Only counted when we answered in between, and that is the whole
  // point of the signal — its own wording is "previous answers have not
  // landed". A customer whose message simply arrived twice has had no
  // answer to reject.
  //
  // From a live handover. Somebody asked, in Malayalam, for their email
  // to be saved and the training calendar mailed to them. The same text
  // was stored twice with nothing from us between the two, so the
  // penalty fired, 0.69 became 0.57, and a perfectly good reply — one
  // that offered to do exactly what they asked — was thrown away in
  // favour of "let me connect you with a team member". They were then
  // waiting on a person for something the assistant could have done.
  const normalizedNow = normalizeForCompare(message)
  if (normalizedNow) {
    const repeats = countAnsweredRepeats(normalizedNow, args.conversationTurns, history)
    if (repeats >= 2) {
      signals.push({
        label: 'Asked repeatedly',
        delta: -0.3,
        detail: `The customer has asked this ${repeats + 1} times. Previous answers have not landed.`,
      })
    } else if (repeats === 1) {
      signals.push({
        label: 'Asked again',
        delta: -0.12,
        detail: 'The customer has already asked this once.',
      })
    }
  }

  // ── Frustration / escalation language ────────────────────────
  const recent = [...history.slice(-3), message].join(' ').toLowerCase()
  const hits = FRUSTRATION_MARKERS.filter((m) => recent.includes(m))
  if (hits.length > 0) {
    // Capped: three angry words are not three times worse than one, and
    // an uncapped sum would send every heated-but-answerable message to
    // a person.
    const delta = Math.max(-0.3, -0.15 * hits.length)
    signals.push({
      label: 'Customer is frustrated or asking for a person',
      delta,
      detail: `Matched: ${hits.slice(0, 4).join(', ')}.`,
    })
  }

  // ── Tool grounding ───────────────────────────────────────────
  // Not a bonus above retrieval; it cancels the empty-knowledge penalty
  // above and is recorded so the handoff note can say why the score held.
  if (args.usedTools) {
    signals.push({
      label: 'Answered from a record lookup',
      delta: 0,
      detail: 'The answer came from this customer\'s own data, which is grounded by construction.',
    })
  }

  const penalty = signals.reduce((sum, s) => sum + Math.min(0, s.delta), 0)
  const score = clamp01(retrievalScore + penalty)

  return {
    score,
    retrievalScore,
    signals,
    explain: buildExplanation(retrievalScore, score, signals),
  }
}

function buildExplanation(retrieval: number, final: number, signals: ConfidenceSignal[]): string {
  if (signals.length === 0) return `Retrieval confidence ${retrieval.toFixed(2)}, no penalties applied.`
  const applied = signals
    .filter((s) => s.delta !== 0)
    .map((s) => `${s.label} (${s.delta.toFixed(2)})`)
  const base = `Retrieval ${retrieval.toFixed(2)} → ${final.toFixed(2)}`
  return applied.length > 0 ? `${base}; ${applied.join(', ')}.` : `${base}; no penalties applied.`
}

function normalizeForCompare(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Token overlap rather than exact match: a customer rephrasing the same
 *  question is the case worth catching, and an exact-string check would
 *  miss all of them. */
function similarEnough(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const aTokens = new Set(a.split(' ').filter((w) => w.length > 2))
  const bTokens = new Set(b.split(' ').filter((w) => w.length > 2))
  if (aTokens.size === 0 || bTokens.size === 0) return false
  let shared = 0
  for (const t of aTokens) if (bTokens.has(t)) shared++
  return shared / Math.min(aTokens.size, bTokens.size) >= 0.6
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}
