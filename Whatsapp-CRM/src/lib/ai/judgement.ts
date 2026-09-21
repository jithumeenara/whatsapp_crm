/**
 * One judgement, for everything the assistant cannot answer.
 *
 * ── Why this is a single call and not five features ─────────────────
 *
 * Five separate questions want answering the moment the assistant gives
 * up on a message: is this a real enquiry, what is it about, can this
 * business help at all, how urgent is it, and did the customer name a
 * time to be called back.
 *
 * The obvious shape is five features, built one a month, each with its
 * own model call, its own settings screen, its own accuracy figure and
 * its own idea of what the conversation was about. That is what most
 * of this category ships, and it is why those products are hard to
 * operate: the lead detector can decide a message is an enquiry while
 * the router decides it is spam, and nobody can say which is right
 * because they never saw the same input.
 *
 * So it is one call returning one object. Five answers that cannot
 * disagree with each other, for the price of one, written down once.
 * Everything downstream — whether a lead appears, who is alerted, how
 * loudly, what the customer is told, when somebody rings back — is
 * arithmetic on this object, with no further intelligence involved.
 *
 * ── Why it records itself even when nothing acts on it ──────────────
 *
 * A judgement is written whether or not the app is allowed to act on
 * it. That is what makes it possible to switch this on safely: it runs
 * beside the existing behaviour for a week, changing nothing, while the
 * owner watches what it *would* have done against what people actually
 * did. Nobody has to take a vendor's word for the accuracy of their own
 * business's messages, because the figure is computed from their own.
 *
 * ── Why "unsure" is a first-class answer ────────────────────────────
 *
 * Research on classification into fine-grained label sets is consistent
 * that accuracy falls as the labels multiply and start to overlap, and
 * a model forced to choose will choose. "My head hurts" does not say
 * whether it is Neuro, ENT or General Medicine, and a confident guess
 * there sends a patient to the wrong doctor. So the category carries
 * its own confidence, and low confidence routes to nobody in
 * particular rather than to somebody wrong.
 */

import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from '@google/generative-ai'
import { geminiCredentials } from '@/lib/ai/providers/registry'
import { recordAiUsage, tokensFromGemini } from '@/lib/ai/usage'
import { thinkingConfigFor } from '@/lib/ai/reasoning'

/**
 * Cheap, fast, and asked to do classification against an explicit list
 * rather than open reasoning — the same model and the same rationale as
 * lead detection, which this eventually replaces.
 */
export const JUDGEMENT_MODEL = 'gemini-3.5-flash-lite'

/** How much of the conversation the model sees. Enough to understand
 *  what is being asked, short enough to stay cheap on a call that runs
 *  on every handover. */
export const TRANSCRIPT_TURNS = 12
const MAX_CHARS_PER_MESSAGE = 500

/**
 * Why this is not an enquiry.
 *
 * A closed list, because these drive different behaviour and a free
 * string would drift into a hundred spellings of "job". 'unclear' is
 * deliberately present: a model that must pick a specific wrong reason
 * is worse than one that can admit the message does not say.
 */
export const NOT_LEAD_REASONS = [
  'existing_customer',
  'job_application',
  'vendor_or_sales',
  'complaint',
  'spam_or_wrong_number',
  'out_of_scope',
  'unclear',
] as const
export type NotLeadReason = (typeof NOT_LEAD_REASONS)[number]

/**
 * How loudly to tell somebody.
 *
 * Three levels, not five. Alarm research is blunt about this: when
 * everything is urgent nothing is, and the recommended ceiling for
 * interrupting one person is about one alarm per ten minutes. Three
 * levels is as fine as a small team can act on.
 */
export const PRIORITIES = ['urgent', 'normal', 'quiet'] as const
export type Priority = (typeof PRIORITIES)[number]

export const CATEGORY_CONFIDENCES = ['high', 'low', 'unsure'] as const
export type CategoryConfidence = (typeof CATEGORY_CONFIDENCES)[number]

export interface Judgement {
  /** Should this person be followed up as a potential customer? */
  isLead: boolean
  /** Only when isLead is false. */
  notLeadReason: NotLeadReason | null
  /** A key from the account's own category list, or null. */
  category: string | null
  categoryConfidence: CategoryConfidence
  priority: Priority
  /** The "we don't offer this" entry that matched, if one did. When
   *  set, the assistant can answer from that entry and nobody needs
   *  interrupting. */
  outOfScopeKey: string | null
  /**
   * A time the customer themselves named, in their own words.
   *
   * Deliberately the words and not a date: turning "after my exam on
   * the 15th" into a timestamp needs the business's own calendar and
   * time zone, which this module does not have and should not guess.
   * The caller converts it. Null unless the customer was explicit —
   * "I'll think about it" is not a time.
   */
  followUpPhrase: string | null
  /** One sentence, quoting the customer where possible. Shown to the
   *  person reviewing, so it has to be worth reading. */
  reason: string
}

export interface JudgementInput {
  accountId: string
  /** Oldest first. Only the customer/business text matters. */
  transcript: Array<{ from: 'customer' | 'business'; text: string }>
  /** The account's own categories: key plus a short description. Empty
   *  is fine — the model simply returns no category. */
  categories: Array<{ key: string; label: string; hint?: string }>
  /** The account's "we don't offer this" entries. Empty is fine. */
  outOfScope: Array<{ key: string; question: string }>
  /** What this business counts as a lead, in its own words. */
  leadRules?: string | null
  /** And what it never counts. */
  leadExclusions?: string | null
  /** Recent confirmed examples, to steer the model toward this
   *  business's own boundaries rather than a generic definition. */
  examples?: Array<{ text: string; isLead: boolean }>
}

export type JudgementResult =
  | { ok: true; judgement: Judgement; latencyMs: number }
  | { ok: false; error: 'no_key' | 'malformed' | 'failed'; message: string }

/**
 * Ask once, get all five answers.
 *
 * Never throws. A judgement that could not be made must not take down
 * the reply that prompted it — the caller falls back to whatever it did
 * before this existed, which is always "hand it to a person".
 */
export async function judge(input: JudgementInput): Promise<JudgementResult> {
  const { apiKey } = geminiCredentials({ provider_keys: await providerKeys(input.accountId) })
  if (!apiKey) return { ok: false, error: 'no_key', message: 'No Gemini key on this account.' }

  const started = Date.now()
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: JUDGEMENT_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // Classification against an explicit checklist. The deliberation
        // this model does by default buys nothing here and costs a
        // second on the path between a customer and an answer.
        ...(thinkingConfigFor(JUDGEMENT_MODEL, 'minimal') ?? {}),
      },
    })

    const result = await model.generateContent(buildPrompt(input))
    const raw = result.response.text()

    void recordAiUsage({
      accountId: input.accountId,
      model: JUDGEMENT_MODEL,
      feature: 'judgement',
      tokens: tokensFromGemini(result.response.usageMetadata),
      latencyMs: Date.now() - started,
    })

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, error: 'malformed', message: 'The model did not return JSON.' }
    }

    return {
      ok: true,
      judgement: normalizeJudgement(parsed, input),
      latencyMs: Date.now() - started,
    }
  } catch (err) {
    return {
      ok: false,
      error: 'failed',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Kept separate so the module has one Prisma touch point and the pure
 *  parts below can be tested without a database. */
async function providerKeys(accountId: string): Promise<unknown> {
  const { prisma } = await import('@/lib/db')
  const row = await prisma.aiConfig
    .findUnique({ where: { account_id: accountId }, select: { provider_keys: true } })
    .catch(() => null)
  return row?.provider_keys ?? null
}

const RESPONSE_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    is_lead: {
      type: SchemaType.BOOLEAN,
      description: 'True if this person should be followed up as a potential customer.',
    },
    not_lead_reason: {
      type: SchemaType.STRING,
      description: `Only when is_lead is false. One of: ${NOT_LEAD_REASONS.join(', ')}. Use "unclear" rather than picking one that does not fit.`,
    },
    category: {
      type: SchemaType.STRING,
      description:
        'The key of the category this is about, from the list given. Empty string if none of them fit or the message does not say.',
    },
    category_confidence: {
      type: SchemaType.STRING,
      description:
        'high when the message names the subject plainly, low when it is implied, unsure when it genuinely could be more than one. Do not guess to avoid saying unsure.',
    },
    priority: {
      type: SchemaType.STRING,
      description:
        'urgent when somebody is angry, at risk, or about to go elsewhere. quiet when nobody needs to stop what they are doing. normal otherwise. Most messages are normal or quiet.',
    },
    out_of_scope_key: {
      type: SchemaType.STRING,
      description:
        'The key of the "we do not offer this" entry that answers this message, from the list given. Empty string if none of them do.',
    },
    follow_up_phrase: {
      type: SchemaType.STRING,
      description:
        'The customer\'s own words naming when to contact them, quoted exactly — "tomorrow evening", "after my exam on the 15th". Empty string unless they were explicit. "I will think about it" is not a time.',
    },
    reason: {
      type: SchemaType.STRING,
      description:
        'One short sentence saying what in the conversation led to these answers. Quote the customer where you can.',
    },
  },
  // Not `as const`: the SDK's Schema type wants a mutable string[] for
  // `required`, and a readonly tuple will not satisfy it.
  required: [
    'is_lead',
    'not_lead_reason',
    'category',
    'category_confidence',
    'priority',
    'out_of_scope_key',
    'follow_up_phrase',
    'reason',
  ],
}

/**
 * Whatever came back, made safe.
 *
 * Every field is checked against the list it is allowed to come from,
 * because a model returning a category this account has never heard of
 * would route a conversation to nobody. Anything unrecognised becomes
 * the harmless value rather than an error: a judgement with a missing
 * category is still worth having.
 */
export function normalizeJudgement(parsed: unknown, input: JudgementInput): Judgement {
  const raw = (parsed ?? {}) as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

  const isLead = raw.is_lead === true

  const reasonRaw = str(raw.not_lead_reason)
  const notLeadReason = !isLead
    ? ((NOT_LEAD_REASONS as readonly string[]).includes(reasonRaw)
        ? (reasonRaw as NotLeadReason)
        : 'unclear')
    : null

  // Only a key this account actually defined. A category the model
  // invented cannot be routed on and must not be stored as if it could.
  const categoryRaw = str(raw.category)
  const category = input.categories.some((c) => c.key === categoryRaw) ? categoryRaw : null

  const confRaw = str(raw.category_confidence)
  const categoryConfidence: CategoryConfidence = !category
    ? 'unsure'
    : (CATEGORY_CONFIDENCES as readonly string[]).includes(confRaw)
      ? (confRaw as CategoryConfidence)
      : 'low'

  const priorityRaw = str(raw.priority)
  const priority: Priority = (PRIORITIES as readonly string[]).includes(priorityRaw)
    ? (priorityRaw as Priority)
    : 'normal'

  const scopeRaw = str(raw.out_of_scope_key)
  const outOfScopeKey = input.outOfScope.some((o) => o.key === scopeRaw) ? scopeRaw : null

  const phrase = str(raw.follow_up_phrase).slice(0, 120)

  return {
    isLead,
    notLeadReason,
    category,
    categoryConfidence,
    priority,
    outOfScopeKey,
    followUpPhrase: phrase || null,
    reason: str(raw.reason).slice(0, 300),
  }
}

/** The transcript, oldest first, trimmed. Long messages are cut rather
 *  than dropped: the opening of a rambling message is nearly always the
 *  part that says what they want. */
export function buildTranscript(
  turns: JudgementInput['transcript'],
  limit = TRANSCRIPT_TURNS,
): string {
  return turns
    .slice(-limit)
    .map((t) => {
      const who = t.from === 'customer' ? 'Customer' : 'Business'
      return `${who}: ${t.text.trim().slice(0, MAX_CHARS_PER_MESSAGE)}`
    })
    .filter((line) => line.length > 10)
    .join('\n')
}

export function buildPrompt(input: JudgementInput): string {
  const parts: string[] = [
    'You are reading a WhatsApp conversation for a business, at the moment its assistant could not answer.',
    'Answer the questions in the schema about this conversation. Answer only from what is written — never assume a detail the customer did not give.',
    '',
  ]

  if (input.leadRules?.trim()) {
    parts.push('This business counts somebody as a lead when:', input.leadRules.trim(), '')
  }
  if (input.leadExclusions?.trim()) {
    parts.push('It never counts:', input.leadExclusions.trim(), '')
  }

  if (input.categories.length > 0) {
    parts.push('Its categories, and what each one covers:')
    for (const c of input.categories) {
      parts.push(`  ${c.key} — ${c.label}${c.hint ? `: ${c.hint}` : ''}`)
    }
    parts.push(
      'Pick the key that fits. If two could fit equally, say unsure rather than choosing one.',
      '',
    )
  }

  if (input.outOfScope.length > 0) {
    parts.push('Things this business does NOT offer. If the message is asking for one, give its key:')
    for (const o of input.outOfScope) {
      parts.push(`  ${o.key} — ${o.question}`)
    }
    parts.push('')
  }

  // Real decisions from this account, which teach the model this
  // business's own boundaries far better than any wording of the rules
  // above. Recent ones only — an example from a year ago may describe a
  // business that no longer exists.
  if (input.examples && input.examples.length > 0) {
    parts.push('Real examples from this business, already confirmed by its staff:')
    for (const e of input.examples.slice(0, 10)) {
      parts.push(`  ${e.isLead ? 'LEAD' : 'NOT a lead'}: "${e.text.slice(0, 160)}"`)
    }
    parts.push('')
  }

  parts.push('The conversation:', buildTranscript(input.transcript), '')
  return parts.join('\n')
}
