/**
 * The account's accuracy rules — what this business's assistant may say,
 * beyond what the knowledge base says.
 *
 * Two kinds of rule, kept apart on purpose:
 *
 *  - Instructions, added to the prompt (accuracyPromptBlock). They make a
 *    mistake less likely and cannot make it impossible.
 *  - Checks, run in code on the finished reply (checkAccuracyRules). A
 *    blocked phrase or a price under "never quote prices" is caught here
 *    however the model was persuaded to write it, and the reply is
 *    redone once or handed to a person — never sent.
 *
 * Stored in ai_configs.accuracy_rules (migration 128), read with plain
 * SQL so a database without the column keeps loading and behaves as
 * before (the image-settings.ts pattern). Industry-neutral throughout:
 * the sensitive topics are the regulated ones every industry has.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { ValidationResult } from './validator'

export type AnswerMode = 'strict' | 'balanced'
export type PricePolicy = 'knowledge' | 'never'
export type OnUnsupported = 'handoff' | 'retry'
export type SensitiveTopic = 'medical' | 'legal' | 'financial' | 'guarantees'

export interface AccuracyRules {
  /** strict: only what the business told it; balanced: may also use
   *  everyday common sense for small talk and general wording. */
  answer_mode: AnswerMode
  /** Ask one short question when a message could mean two things,
   *  instead of guessing which. */
  clarify_first: boolean
  /** knowledge: prices only exactly as written in the knowledge;
   *  never: no prices at all — a person quotes. */
  price_policy: PricePolicy
  /** No discount, offer, refund, guarantee or exception that the
   *  knowledge does not state. */
  no_promises: boolean
  sensitive_topics: SensitiveTopic[]
  /** Words or phrases that must never appear in a reply (a competitor's
   *  name, "guaranteed", "100% placement"). Checked in code. */
  blocked_phrases: string[]
  /** A reply with an unsupported figure, a blocked phrase or a price
   *  against the policy: hand over at once, or try once more first. */
  on_unsupported: OnUnsupported
}

export const DEFAULT_ACCURACY_RULES: AccuracyRules = {
  answer_mode: 'balanced',
  clarify_first: true,
  price_policy: 'knowledge',
  no_promises: true,
  sensitive_topics: [],
  blocked_phrases: [],
  on_unsupported: 'retry',
}

export const SENSITIVE_TOPICS: ReadonlyArray<{ id: SensitiveTopic; label: string; rule: string }> = [
  {
    id: 'medical',
    label: 'Health & medical',
    rule: 'Never diagnose, suggest a treatment, a medicine or a dose, or say whether a symptom is serious. Share only what the business told you (timings, doctors, services, preparation instructions) and offer a consultation or a colleague.',
  },
  {
    id: 'legal',
    label: 'Legal',
    rule: 'Never give legal advice or say what the law allows in their case. Share only the business\'s own information and offer a consultation or a colleague.',
  },
  {
    id: 'financial',
    label: 'Money, loans & investment',
    rule: 'Never give investment, tax or credit advice, predict returns, or say whether someone qualifies for a loan. Share only the business\'s published terms and offer a colleague.',
  },
  {
    id: 'guarantees',
    label: 'Results & guarantees',
    rule: 'Never promise an outcome — a job, admission, a pass, a cure, a result, a delivery date — unless the knowledge states that exact guarantee.',
  },
]

/** Topics that suit an industry, offered as the starting point. */
export function suggestedTopics(category: string | null | undefined): SensitiveTopic[] {
  const c = (category ?? '').toLowerCase()
  const out: SensitiveTopic[] = []
  if (/health|medical|hospital|clinic|pharma|dental|wellness|beauty|fitness/.test(c)) out.push('medical')
  if (/legal|professional/.test(c)) out.push('legal')
  if (/financ|insur|loan|bank|invest|real estate/.test(c)) out.push('financial')
  if (/educat|training|coaching|recruit/.test(c)) out.push('guarantees')
  return out
}

const TOPIC_IDS = new Set<string>(SENSITIVE_TOPICS.map((t) => t.id))

export function parseAccuracyRules(raw: unknown): AccuracyRules {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_ACCURACY_RULES
  const phrases = Array.isArray(o.blocked_phrases)
    ? [...new Set(o.blocked_phrases.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x.length >= 2))]
        .map((x) => x.slice(0, 80))
        .slice(0, 50)
    : d.blocked_phrases
  return {
    answer_mode: o.answer_mode === 'strict' ? 'strict' : 'balanced',
    clarify_first: typeof o.clarify_first === 'boolean' ? o.clarify_first : d.clarify_first,
    price_policy: o.price_policy === 'never' ? 'never' : 'knowledge',
    no_promises: typeof o.no_promises === 'boolean' ? o.no_promises : d.no_promises,
    sensitive_topics: Array.isArray(o.sensitive_topics)
      ? [...new Set(o.sensitive_topics.filter((x): x is SensitiveTopic => typeof x === 'string' && TOPIC_IDS.has(x)))]
      : d.sensitive_topics,
    blocked_phrases: phrases,
    on_unsupported: o.on_unsupported === 'handoff' ? 'handoff' : 'retry',
  }
}

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: AccuracyRules }>()

export async function accuracyRulesFor(accountId: string): Promise<AccuracyRules> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  let value = DEFAULT_ACCURACY_RULES
  try {
    const rows = await prisma.$queryRaw<Array<{ accuracy_rules: unknown }>>(
      Prisma.sql`SELECT accuracy_rules FROM ai_configs WHERE account_id = ${accountId}::uuid`,
    )
    value = parseAccuracyRules(rows[0]?.accuracy_rules)
  } catch {
    // No column yet: the defaults, which are what the assistant did before.
  }
  cache.set(accountId, { at: Date.now(), value })
  return value
}

export async function setAccuracyRules(accountId: string, rules: AccuracyRules): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS accuracy_rules JSONB')
  await prisma.$executeRaw(
    Prisma.sql`UPDATE ai_configs SET accuracy_rules = ${JSON.stringify(rules)}::jsonb WHERE account_id = ${accountId}::uuid`,
  )
  cache.delete(accountId)
}

/** The rules as prompt instructions. */
export function accuracyPromptBlock(rules: AccuracyRules): string {
  const lines: string[] = ['ACCURACY RULES FOR THIS BUSINESS (these override any general habit of being helpful):']
  if (rules.answer_mode === 'strict') {
    lines.push(
      '- Answer ONLY from the business details, reference material and look-up results in this message. If the answer is not there, say you will check with the team — do not answer from general knowledge, even when you are sure.',
    )
  } else {
    lines.push(
      '- Facts about this business — what it offers, prices, dates, times, places, people, policies — come only from the material in this message. General knowledge is for ordinary conversation, never for facts about the business.',
    )
  }
  if (rules.clarify_first) {
    lines.push(
      '- If the customer\'s message could mean two different things, or names something the business has several of, ask ONE short question to find out which — do not guess and answer the wrong one.',
    )
  }
  if (rules.price_policy === 'never') {
    lines.push('- Never state a price, fee, charge, discount or amount of money. If asked, say a colleague will share the exact price.')
  } else {
    lines.push('- State a price only exactly as the material gives it, with what it is for. Never calculate, round, estimate or combine prices.')
  }
  if (rules.no_promises) {
    lines.push(
      '- Never offer or agree to a discount, offer, refund, free extra, exception or guarantee unless the material states it. If asked for one, say a colleague will confirm.',
    )
  }
  for (const t of SENSITIVE_TOPICS) {
    if (rules.sensitive_topics.includes(t.id)) lines.push(`- ${t.label}: ${t.rule}`)
  }
  if (rules.blocked_phrases.length) {
    lines.push(`- Never write any of these words or phrases: ${rules.blocked_phrases.map((p) => `"${p}"`).join(', ')}.`)
  }
  lines.push('- It is always better to say you will check than to give a detail you are not sure of.')
  return lines.join('\n')
}

export interface RuleBreach {
  kind: 'blocked_phrase' | 'price'
  value: string
}

/** Currency amounts in any common written form: ₹500, Rs. 500, $20,
 *  AED 150, 150 SAR, €9.99, 1,200 rupees. */
const MONEY = new RegExp(
  [
    String.raw`(?:[₹$€£¥]|\b(?:rs\.?|inr|usd|aed|sar|qar|omr|kwd|bhd|eur|gbp|sgd|myr|cad|aud)\s?)\s?\d[\d,]*(?:\.\d{1,2})?`,
    String.raw`\b\d[\d,]*(?:\.\d{1,2})?\s?(?:rs\.?|inr|rupees?|dollars?|dirhams?|riyals?|aed|sar|usd|eur|gbp|\/-)(?=\W|$)`,
  ].join('|'),
  'gi',
)

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** What in a finished reply breaks the account's rules. */
export function checkAccuracyRules(reply: string, rules: AccuracyRules): RuleBreach[] {
  const out: RuleBreach[] = []
  for (const phrase of rules.blocked_phrases) {
    // Whole words, any case: "free" must not catch "freedom".
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(phrase)}(?![\\p{L}\\p{N}])`, 'iu')
    if (re.test(reply)) out.push({ kind: 'blocked_phrase', value: phrase })
  }
  if (rules.price_policy === 'never') {
    for (const m of reply.matchAll(MONEY)) out.push({ kind: 'price', value: m[0].trim() })
  }
  return out
}

/** The instruction for the one retry, naming exactly what to leave out. */
export function correctionFor(breaches: readonly RuleBreach[], unsupported: readonly string[]): string {
  const parts: string[] = ['YOUR PREVIOUS DRAFT BROKE THE RULES AND WAS NOT SENT. Write it again:']
  if (unsupported.length) {
    parts.push(`- These details are not in the material, so they must not appear: ${unsupported.slice(0, 8).join(', ')}. If the customer needs them, say a colleague will confirm.`)
  }
  const phrases = breaches.filter((b) => b.kind === 'blocked_phrase').map((b) => `"${b.value}"`)
  if (phrases.length) parts.push(`- Do not use: ${phrases.join(', ')}.`)
  if (breaches.some((b) => b.kind === 'price')) parts.push('- Do not state any price or amount. Say a colleague will share the exact price.')
  parts.push('- Keep everything else that was correct.')
  return parts.join('\n')
}

/** The validator's result with the account's rule breaches added, so
 *  one decision (decideTurn) and one handover note cover both. */
export function mergeRuleBreaches(
  validation: ValidationResult | null,
  breaches: ReadonlyArray<{ kind: 'blocked_phrase' | 'price'; value: string }>,
): ValidationResult | null {
  if (breaches.length === 0) return validation
  const issues = [
    ...(validation?.issues ?? []),
    ...breaches.map((b) => ({
      kind: b.kind,
      value: b.value,
      reason: b.kind === 'price' ? 'Prices are set to be quoted by a person only.' : 'This phrase is blocked in the accuracy rules.',
    })),
  ]
  return {
    ok: false,
    issues,
    summary: `Reply held ${issues.length} detail${issues.length === 1 ? '' : 's'} it may not send: ${issues
      .slice(0, 4)
      .map((i) => `${i.value} (${i.kind.replace('_', ' ')})`)
      .join(', ')}`,
  }
}
