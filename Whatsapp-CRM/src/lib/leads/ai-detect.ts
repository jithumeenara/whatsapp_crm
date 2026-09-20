/**
 * Reading a WhatsApp conversation and deciding whether it is a lead.
 *
 * ── Why this suggests rather than creates ───────────────────────────
 *
 * Today the app creates a lead for every brand-new contact's first
 * message when auto_lead_creation is on. That is a rule anyone can
 * understand and it is wrong about a large share of the people it fires
 * on — a wrong number, a supplier, somebody's cousin. The fix people
 * reach for is a model, and the honest reading of what happens when
 * businesses do that is: 15–30% of what a fresh model calls a lead is
 * not one in the first ninety days, and about half of these deployments
 * never produce a measurable lift at all. The failure mode is specific —
 * the agent stops trusting the label, and then the good ones get
 * ignored too.
 *
 * So the default is `suggest`: the model's answer lands on a Suggested
 * tab where somebody accepts or rejects it, and both answers are
 * recorded. After a few weeks the settings screen can show the account
 * its own accuracy figure and let it decide whether to switch to
 * `create`. A number the account watched accumulate is worth more than
 * a claim in a settings description.
 *
 * ── Why the rules run first ─────────────────────────────────────────
 *
 * Every model call costs money and takes a second. Most conversations
 * can be excluded for free and for certain: too short to contain a
 * signal, already a lead, already claimed by an agent, a blocked
 * contact, or checked recently enough that nothing has changed. Running
 * those first means the model only ever sees the cases that are
 * genuinely in question.
 *
 * ── Why the account writes the definition ───────────────────────────
 *
 * See ai-signals.ts. The exclusions box is the part that makes this
 * work outside one industry: the signal that means "customer" in a
 * showroom means "student project" in a manufacturer's inbox, and only
 * the account knows which.
 */

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { prisma } from '@/lib/db'
import { geminiCredentials } from '@/lib/ai/providers/registry'
import { recordAiUsage, tokensFromGemini } from '@/lib/ai/usage'
import { thinkingConfigFor } from '@/lib/ai/reasoning'
import {
  normalizeMode,
  normalizeThreshold,
  sanitizeSignals,
  signalsFor,
  THRESHOLD_PROMPTS,
  type LeadMode,
} from './ai-signals'

/** Fixed rather than the account's chat model, for the same reason
 *  translate.ts fixes its own: this is a classification job with a
 *  schema, and it should behave the same whatever the account has
 *  chosen for its customer-facing replies. */
export const LEAD_DETECT_MODEL = 'gemini-3.5-flash-lite'

/** Enough of the thread for intent to be visible, few enough that the
 *  call stays cheap. Intent shows up in the first handful of turns or
 *  not at all. */
const MAX_MESSAGES = 24

/** One customer message longer than this is almost certainly a pasted
 *  forward, and carrying all of it inflates every call. */
const MAX_CHARS_PER_MESSAGE = 600

export type DetectOutcome =
  | 'lead'
  | 'not_lead'
  | 'skipped_disabled'
  | 'skipped_too_short'
  | 'skipped_existing_lead'
  | 'skipped_rejected_before'
  | 'skipped_assigned'
  | 'skipped_recently_checked'
  | 'skipped_no_key'
  | 'failed'

export interface DetectResult {
  outcome: DetectOutcome
  /** The model's own words for why, shown on the Suggested row. An
   *  agent deciding whether to accept needs the reason, not a score. */
  reason?: string
  confidence?: 'high' | 'medium' | 'low'
  /** Set when a Lead row was written — either a suggestion or, in
   *  create mode, a real one. */
  leadId?: string
}

interface AiLeadSettings {
  enabled: boolean
  signals: string[]
  rules: string
  exclusions: string
  threshold: string
  mode: LeadMode
  minMessages: number
  recheckHours: number
}

/** Reads the eight ai_lead_* columns without assuming migration 097 has
 *  run. Same belt-and-braces as the settings route: an account on an
 *  older deployment gets "off", not a crashed webhook. */
export async function loadAiLeadSettings(accountId: string): Promise<AiLeadSettings | null> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        ai_lead_enabled: boolean | null
        ai_lead_signals: unknown
        ai_lead_rules: string | null
        ai_lead_exclusions: string | null
        ai_lead_threshold: string | null
        ai_lead_mode: string | null
        ai_lead_min_messages: number | null
        ai_lead_recheck_hours: number | null
      }>
    >`
      SELECT ai_lead_enabled, ai_lead_signals, ai_lead_rules, ai_lead_exclusions,
             ai_lead_threshold, ai_lead_mode, ai_lead_min_messages, ai_lead_recheck_hours
      FROM   lead_settings
      WHERE  account_id = ${accountId}::uuid
      LIMIT  1
    `
    const row = rows[0]
    if (!row) return null
    return {
      enabled: row.ai_lead_enabled === true,
      signals: sanitizeSignals(row.ai_lead_signals),
      rules: (row.ai_lead_rules ?? '').trim(),
      exclusions: (row.ai_lead_exclusions ?? '').trim(),
      threshold: normalizeThreshold(row.ai_lead_threshold),
      mode: normalizeMode(row.ai_lead_mode),
      minMessages: Math.max(1, row.ai_lead_min_messages ?? 2),
      recheckHours: Math.max(0, row.ai_lead_recheck_hours ?? 6),
    }
  } catch {
    // The columns do not exist yet on this database.
    return null
  }
}

/**
 * Decide whether one conversation is a lead, and record the answer.
 *
 * Returns rather than throws, and is called after a reply has already
 * been sent. Nothing here may turn a delivered reply into a failure —
 * the customer has been answered; whether we also filed a lead is the
 * business's problem, not theirs.
 */
export async function detectLead(args: {
  accountId: string
  conversationId: string
  contactId: string | null
}): Promise<DetectResult> {
  const settings = await loadAiLeadSettings(args.accountId)
  if (!settings?.enabled) return { outcome: 'skipped_disabled' }
  if (!args.contactId) return { outcome: 'skipped_disabled' }

  // ── The free layer ────────────────────────────────────────────────
  // Each of these is a certainty, not a guess, and each saves a call.

  const existing = await prisma.lead
    .findFirst({
      where: { account_id: args.accountId, contact_id: args.contactId },
      select: { id: true },
    })
    .catch(() => null)
  if (existing) return { outcome: 'skipped_existing_lead' }

  // Somebody already looked at this person and said no. A rejected
  // suggestion leaves no lead row behind, so without this the same
  // person would be offered again as soon as the recheck window
  // elapsed — and being overruled by the software you just corrected
  // is how people stop using a feature.
  const turnedDown = await prisma.aiLeadReview
    .findFirst({
      where: { account_id: args.accountId, contact_id: args.contactId, decision: 'rejected' },
      select: { id: true },
    })
    .catch(() => null)
  if (turnedDown) return { outcome: 'skipped_rejected_before' }

  const conversation = await prisma.conversation
    .findFirst({
      where: { id: args.conversationId, account_id: args.accountId },
      select: { id: true, assigned_agent_id: true, ai_lead_checked_at: true },
    })
    .catch(() => null)
  if (!conversation) return { outcome: 'skipped_disabled' }
  // An agent is already on this thread. Whatever it is, they know.
  if (conversation.assigned_agent_id) return { outcome: 'skipped_assigned' }

  // One timestamp, written whether the answer was yes or no, so a "no"
  // is as good at suppressing the next call as a "yes" is. Reading the
  // lead row instead would only ever see the yeses — and the noes are
  // the ones worth not paying for twice.
  if (settings.recheckHours > 0 && conversation.ai_lead_checked_at) {
    const since = Date.now() - settings.recheckHours * 3_600_000
    if (new Date(conversation.ai_lead_checked_at).getTime() >= since) {
      return { outcome: 'skipped_recently_checked' }
    }
  }

  const messages = await prisma.message
    .findMany({
      where: { conversation_id: args.conversationId },
      orderBy: { created_at: 'desc' },
      take: MAX_MESSAGES,
      select: { sender_type: true, content_text: true, created_at: true },
    })
    .catch(() => [] as Array<{ sender_type: string; content_text: string | null; created_at: Date }>)

  const fromCustomer = messages.filter(
    (m) => m.sender_type === 'customer' && (m.content_text ?? '').trim().length > 0,
  )
  if (fromCustomer.length < settings.minMessages) return { outcome: 'skipped_too_short' }

  // ── The model layer ───────────────────────────────────────────────

  const aiConfig = await prisma.aiConfig
    .findUnique({ where: { account_id: args.accountId }, select: { provider_keys: true } })
    .catch(() => null)
  const { apiKey } = aiConfig ? geminiCredentials(aiConfig) : { apiKey: null }
  if (!apiKey) return { outcome: 'skipped_no_key' }

  const transcript = [...messages]
    .reverse()
    .map((m) => {
      const who = m.sender_type === 'customer' ? 'Customer' : 'Business'
      return `${who}: ${(m.content_text ?? '').trim().slice(0, MAX_CHARS_PER_MESSAGE)}`
    })
    .join('\n')

  const started = Date.now()
  try {
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({
      model: LEAD_DETECT_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            is_lead: {
              type: SchemaType.BOOLEAN,
              description: 'True if this person should be followed up as a potential customer.',
            },
            reason: {
              type: SchemaType.STRING,
              description:
                'One short sentence, in English, saying what in the conversation led to this answer. Quote the customer where you can.',
            },
            confidence: {
              type: SchemaType.STRING,
              description: 'One of: high, medium, low.',
            },
          },
          required: ['is_lead', 'reason', 'confidence'],
        },
        // Classification against an explicit checklist. The deliberation
        // this model does by default buys nothing here and costs a
        // second — see reasoning.ts.
        ...(thinkingConfigFor(LEAD_DETECT_MODEL, 'minimal') ?? {}),
      },
    })

    const result = await model.generateContent(buildPrompt(settings, transcript))
    const raw = result.response.text()

    let parsed: { is_lead?: boolean; reason?: string; confidence?: string }
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new Error('Lead detection model returned malformed output.')
    }

    void recordAiUsage({
      accountId: args.accountId,
      model: LEAD_DETECT_MODEL,
      feature: 'lead_detect',
      tokens: tokensFromGemini(result.response.usageMetadata),
      latencyMs: Date.now() - started,
    })

    const confidence =
      parsed.confidence === 'high' || parsed.confidence === 'low' ? parsed.confidence : 'medium'
    const reason = (parsed.reason ?? '').trim().slice(0, 300)

    await markChecked(args.conversationId)

    if (parsed.is_lead !== true) {
      // No row written. A "no" that created one would put every wrong
      // number in the leads table, which is the thing this module
      // exists to avoid; the timestamp above is the whole record.
      return { outcome: 'not_lead', reason, confidence }
    }

    const leadId = await writeLead({
      accountId: args.accountId,
      contactId: args.contactId,
      conversationId: args.conversationId,
      mode: settings.mode,
      reason,
      confidence,
    })

    return { outcome: 'lead', reason, confidence, ...(leadId ? { leadId } : {}) }
  } catch (err) {
    void recordAiUsage({
      accountId: args.accountId,
      model: LEAD_DETECT_MODEL,
      feature: 'lead_detect',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    })
    console.error('[lead-detect] failed:', err instanceof Error ? err.message : err)
    return { outcome: 'failed' }
  }
}

function buildPrompt(settings: AiLeadSettings, transcript: string): string {
  const signals = signalsFor(settings.signals)
  const parts: string[] = [
    'You are reading a WhatsApp conversation between a business and somebody who messaged it.',
    'Decide one thing only: should a salesperson follow this person up?',
    '',
    'Count it as a lead when any of these is true:',
    ...signals.map((s) => `- ${s.prompt}`),
  ]

  if (settings.rules) {
    parts.push(
      '',
      'This business also counts the following as a lead, in its own words. These take priority over the list above:',
      settings.rules,
    )
  }

  if (settings.exclusions) {
    parts.push(
      '',
      'Never count the following as a lead, whatever else the conversation contains. These override everything above:',
      settings.exclusions,
    )
  }

  parts.push(
    '',
    THRESHOLD_PROMPTS[normalizeThreshold(settings.threshold)],
    '',
    'Ignore the business\'s own messages when judging intent — an assistant offering to help is not the customer asking for it.',
    'Judge what the customer actually wrote, not what they might have meant.',
    '',
    'Conversation:',
    transcript,
  )

  return parts.join('\n')
}

/**
 * Stamp the conversation as looked at, whichever way the answer went.
 *
 * Written after the model answers rather than before it is asked: a
 * failed call should not buy itself six hours of silence, because the
 * next message might be the one that succeeds.
 */
async function markChecked(conversationId: string): Promise<void> {
  await prisma.conversation
    .update({ where: { id: conversationId }, data: { ai_lead_checked_at: new Date() } })
    .catch((err: unknown) => {
      // The column may not exist on an older deployment. The recheck
      // window then degrades to "ask again next message" — wasteful,
      // not wrong, and not worth failing a delivered reply over.
      console.error(
        '[lead-detect] could not stamp conversation:',
        err instanceof Error ? err.message : err,
      )
    })
}

async function writeLead(args: {
  accountId: string
  contactId: string
  conversationId: string
  mode: LeadMode
  reason: string
  confidence: string
}): Promise<string | null> {
  const contact = await prisma.contact
    .findFirst({
      where: { id: args.contactId, account_id: args.accountId },
      select: { name: true, phone: true, user_id: true },
    })
    .catch(() => null)
  if (!contact) return null

  try {
    const lead = await prisma.lead.create({
      data: {
        account_id: args.accountId,
        user_id: contact.user_id,
        contact_id: args.contactId,
        title: contact.name || contact.phone,
        source: 'whatsapp',
        // In suggest mode the row exists but stays off the working
        // lists: the Suggested tab is the only place it shows until
        // somebody accepts it. In create mode it joins the New pool
        // like any other lead.
        status: 'new',
        ai_suggested: args.mode === 'suggest',
        ai_reason: args.reason,
        ai_confidence: args.confidence,
        ai_reviewed_at: new Date(),
        // create mode is the account saying it has watched this work
        // and does not want the review step. The row then counts as its
        // own approval, so the accuracy figure keeps a denominator.
        ai_review_result: args.mode === 'create' ? 'auto_accepted' : null,
      },
      select: { id: true },
    })

    await prisma.leadActivity
      .create({
        data: {
          account_id: args.accountId,
          lead_id: lead.id,
          contact_id: args.contactId,
          type: 'created',
          title: args.mode === 'create' ? 'Lead created by AI' : 'Lead suggested by AI',
          // The reason goes in the timeline as well as on the row, so
          // it survives the suggestion being accepted and the banner
          // going away.
          description: args.reason || 'Identified from the WhatsApp conversation.',
        },
      })
      .catch(() => {})

    return lead.id
  } catch (err) {
    console.error('[lead-detect] could not write lead:', err instanceof Error ? err.message : err)
    return null
  }
}
