import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/judgements
 *
 * The review queue: what the assistant decided, waiting for somebody to
 * say whether it was right.
 *
 * ── Why this is one list and not two ────────────────────────────────
 *
 * The app used to ask this question in two places. A Suggested tab held
 * the conversations the assistant thought were leads, waiting for a
 * yes; nothing at all held the ones it thought were not, so a
 * conversation the assistant dismissed left no trace anywhere and its
 * mistakes were invisible by construction.
 *
 * Both are the same question — was the assistant right? — so they are
 * one list. Two lists would mean two habits, and the second one would
 * be the one nobody formed.
 *
 * ── Why judgements nobody has answered are not treated as agreement ──
 *
 * Only rows a person actually answered count toward accuracy. Silence
 * is not agreement: an account that stopped reviewing would otherwise
 * watch its accuracy climb to 100%, which is exactly backwards.
 */

/** A week. Past this, a judgement nobody looked at is not going to be
 *  looked at, and leaving it would turn a finishable list into a second
 *  inbox — the failure that makes review queues get abandoned. */
const STALE_AFTER_DAYS = 7

export async function GET(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount()
    const url = new URL(req.url)

    // 'open' is the working view. 'all' is for looking back at what the
    // assistant has been doing, which is a different task.
    const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'open'
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200)

    // One person's outstanding judgement, for the close dialog: the
    // moment a lead is closed is the moment somebody actually knows
    // whether it was ever an enquiry, which is a better answer than the
    // one they could give when it arrived.
    const contactId = url.searchParams.get('contact_id')

    const since = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60_000)

    const rows = await prisma.aiJudgement.findMany({
      where: {
        account_id: ctx.accountId,
        ...(contactId ? { contact_id: contactId } : {}),
        ...(scope === 'open' ? { reviewed_at: null, created_at: { gte: since } } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        id: true,
        conversation_id: true,
        contact_id: true,
        lead_id: true,
        is_lead: true,
        not_lead_reason: true,
        category: true,
        category_confidence: true,
        priority: true,
        out_of_scope_key: true,
        follow_up_phrase: true,
        reason: true,
        acted: true,
        human_verdict: true,
        reviewed_at: true,
        created_at: true,
        // What the customer actually said. The single most important
        // thing on the row: a person deciding whether the assistant was
        // right needs the words it was reading, not a summary of them.
        conversation: {
          select: {
            last_message_text: true,
            last_message_at: true,
            status: true,
            contact: { select: { name: true, phone: true } },
          },
        },
      },
    })

    // Labels come from this account's own list, so the screen shows
    // "Sub Staff (LGS)" rather than the stored key. Fetched once rather
    // than joined per row — there are a handful of categories and
    // potentially fifty rows.
    const categories = await prisma.serviceCategory.findMany({
      where: { account_id: ctx.accountId },
      select: { key: true, label: true },
    })
    const labelFor = new Map(categories.map((c) => [c.key, c.label]))

    return NextResponse.json({
      judgements: rows.map((r) => ({
        id: r.id,
        conversation_id: r.conversation_id,
        contact_id: r.contact_id,
        lead_id: r.lead_id,
        is_lead: r.is_lead,
        not_lead_reason: r.not_lead_reason,
        category: r.category,
        category_label: r.category ? (labelFor.get(r.category) ?? r.category) : null,
        category_confidence: r.category_confidence,
        priority: r.priority,
        out_of_scope_key: r.out_of_scope_key,
        follow_up_phrase: r.follow_up_phrase,
        reason: r.reason,
        acted: r.acted,
        human_verdict: r.human_verdict,
        reviewed_at: r.reviewed_at?.toISOString() ?? null,
        created_at: r.created_at.toISOString(),
        customer_said: r.conversation?.last_message_text ?? null,
        customer_name: r.conversation?.contact?.name ?? null,
        customer_phone: r.conversation?.contact?.phone ?? null,
        conversation_status: r.conversation?.status ?? null,
      })),
      categories,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
