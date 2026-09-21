/**
 * Judging one conversation, and writing down what was decided.
 *
 * The orchestration around src/lib/ai/judgement.ts: gather what the
 * model needs, ask once, store the answer. Deliberately separate from
 * the model call itself, which stays pure and therefore testable
 * without a database.
 *
 * ── What this does NOT do ───────────────────────────────────────────
 *
 * It does not create leads, alert anybody, route anything or reply to
 * the customer. It records a judgement and returns it. Acting on it is
 * the caller's business, and in the first weeks of an account's life
 * the caller does nothing at all — see `acted` on the row.
 *
 * That separation is the whole safety story. The expensive, risky part
 * (deciding) runs and is measured long before the irreversible part
 * (acting) is switched on, and both halves are the same code either
 * way, so what gets switched on is exactly what was measured.
 */

import { prisma } from '@/lib/db'
import {
  judge,
  JUDGEMENT_MODEL,
  TRANSCRIPT_TURNS,
  type Judgement,
  type JudgementInput,
} from './judgement'

/**
 * How recently confirmed an example has to be to teach anything.
 *
 * A correction from a year ago may describe a business that has since
 * changed what it sells. Recent ones only, and few of them: ten short
 * examples steer the model well and cost almost nothing, while a
 * hundred would bury the conversation being judged underneath them.
 */
const EXAMPLE_LIMIT = 10
const EXAMPLE_MAX_AGE_DAYS = 90

/** Two judgements minutes apart about the same chat say the same thing
 *  and cost twice. One per conversation per this window, unless the
 *  caller insists. */
const RECHECK_AFTER_MS = 60 * 60_000

export interface JudgeConversationResult {
  ok: boolean
  judgement?: Judgement
  judgementId?: string
  /** Why nothing was judged, when nothing was. */
  skipped?: 'too_recent' | 'no_messages' | 'no_key' | 'failed'
  message?: string
}

/**
 * Read the conversation, ask once, store the answer.
 *
 * Never throws. This runs on the tail of a handover that has already
 * done the important thing — the customer's message is saved and a
 * person can see it — and a failure here must not undo that.
 */
export async function judgeConversation(args: {
  accountId: string
  conversationId: string
  contactId?: string | null
  /** Skip the once-an-hour guard. Used by the re-check on the review
   *  screen, where somebody deliberately asked for a fresh opinion. */
  force?: boolean
}): Promise<JudgeConversationResult> {
  try {
    if (!args.force) {
      const recent = await prisma.aiJudgement.findFirst({
        where: {
          conversation_id: args.conversationId,
          created_at: { gt: new Date(Date.now() - RECHECK_AFTER_MS) },
        },
        select: { id: true },
      })
      if (recent) return { ok: false, skipped: 'too_recent' }
    }

    const [messages, categories, outOfScope, leadSettings, examples] = await Promise.all([
      prisma.message.findMany({
        where: { conversation_id: args.conversationId },
        orderBy: { created_at: 'desc' },
        take: TRANSCRIPT_TURNS,
        select: { sender_type: true, content_text: true },
      }),
      prisma.serviceCategory.findMany({
        where: { account_id: args.accountId, active: true },
        orderBy: { sort_order: 'asc' },
        select: { key: true, label: true, hint: true },
      }),
      prisma.outOfScopeAnswer.findMany({
        where: { account_id: args.accountId, active: true },
        select: { key: true, question: true },
      }),
      prisma.leadSettings
        .findUnique({
          where: { account_id: args.accountId },
          select: { ai_lead_rules: true, ai_lead_exclusions: true },
        })
        .catch(() => null),
      loadExamples(args.accountId),
    ])

    const transcript: JudgementInput['transcript'] = messages
      .reverse()
      .filter((m): m is typeof m & { content_text: string } => Boolean(m.content_text?.trim()))
      .map((m) => ({
        from: m.sender_type === 'customer' ? ('customer' as const) : ('business' as const),
        text: m.content_text,
      }))

    if (transcript.length === 0) return { ok: false, skipped: 'no_messages' }

    const result = await judge({
      accountId: args.accountId,
      transcript,
      categories: categories.map((c) => ({
        key: c.key,
        label: c.label,
        ...(c.hint ? { hint: c.hint } : {}),
      })),
      outOfScope,
      leadRules: leadSettings?.ai_lead_rules ?? null,
      leadExclusions: leadSettings?.ai_lead_exclusions ?? null,
      examples,
    })

    if (!result.ok) {
      return {
        ok: false,
        skipped: result.error === 'no_key' ? 'no_key' : 'failed',
        message: result.message,
      }
    }

    const j = result.judgement
    const row = await prisma.aiJudgement.create({
      data: {
        account_id: args.accountId,
        conversation_id: args.conversationId,
        contact_id: args.contactId ?? null,
        is_lead: j.isLead,
        not_lead_reason: j.notLeadReason,
        category: j.category,
        category_confidence: j.categoryConfidence,
        priority: j.priority,
        out_of_scope_key: j.outOfScopeKey,
        follow_up_phrase: j.followUpPhrase,
        reason: j.reason,
        // Recording only. Whoever acts on this sets it, so a row that
        // says true is a row something really happened because of.
        acted: false,
        model: JUDGEMENT_MODEL,
        latency_ms: result.latencyMs,
      },
      select: { id: true },
    })

    return { ok: true, judgement: j, judgementId: row.id }
  } catch (err) {
    console.error('[judge] failed:', err instanceof Error ? err.message : err)
    return { ok: false, skipped: 'failed', message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Recent decisions a person actually confirmed, as examples.
 *
 * These teach the model this business's own boundaries far better than
 * any wording of the rules: "Sir any vacancy?" is not a lead at a
 * coaching institute and very much is one at a recruitment agency, and
 * no general definition gets that right for both.
 *
 * Only rows a human answered. An unreviewed judgement is the model's
 * own opinion, and feeding a model its own opinions back is how a
 * mistake becomes a habit.
 */
async function loadExamples(
  accountId: string,
): Promise<Array<{ text: string; isLead: boolean }>> {
  const since = new Date(Date.now() - EXAMPLE_MAX_AGE_DAYS * 24 * 60 * 60_000)
  const rows = await prisma.aiJudgement
    .findMany({
      where: {
        account_id: accountId,
        reviewed_at: { not: null, gte: since },
        human_is_lead: { not: null },
      },
      orderBy: { reviewed_at: 'desc' },
      take: EXAMPLE_LIMIT,
      select: {
        human_is_lead: true,
        conversation: { select: { last_message_text: true } },
      },
    })
    .catch(() => [])

  return rows.flatMap((r) => {
    const text = r.conversation?.last_message_text?.trim()
    if (!text || r.human_is_lead === null) return []
    return [{ text, isLead: r.human_is_lead }]
  })
}
