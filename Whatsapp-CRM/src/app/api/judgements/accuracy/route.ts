import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { NOT_LEAD_REASONS } from '@/lib/ai/judgement'

/**
 * GET /api/judgements/accuracy
 *
 * How often the assistant was right, counted from what people decided.
 *
 * ── Why a percentage is not enough ──────────────────────────────────
 *
 * "83% accurate" tells an owner whether to trust it and nothing about
 * what to do next. The useful half of this endpoint is the second half:
 * which mistakes it keeps making, and which pairs of categories it
 * keeps confusing.
 *
 * Research on classification into fine-grained label sets converges on
 * the same advice — the fix is almost never a better model, it is one
 * sentence distinguishing the two labels that keep swapping. A report
 * that names the pair turns a vague "the AI is wrong sometimes" into a
 * five-second edit.
 *
 * ── Why observe mode gets its own numbers ───────────────────────────
 *
 * Judgements that were recorded but not acted on are the whole point of
 * observe mode, so they are counted and shown as what *would* have
 * happened. An owner deciding whether to switch this on is entitled to
 * see that on their own messages, not on a vendor's benchmark.
 */

const DEFAULT_DAYS = 30

export async function GET(req: NextRequest) {
  try {
    const ctx = await getCurrentAccount()
    const url = new URL(req.url)
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || DEFAULT_DAYS, 1), 365)
    const since = new Date(Date.now() - days * 24 * 60 * 60_000)

    const rows = await prisma.aiJudgement.findMany({
      where: { account_id: ctx.accountId, created_at: { gte: since } },
      select: {
        is_lead: true,
        not_lead_reason: true,
        category: true,
        priority: true,
        acted: true,
        human_verdict: true,
        human_is_lead: true,
        human_category: true,
      },
    })

    const judged = rows.length
    // Only what somebody answered. Silence is not agreement — see the
    // note in the review endpoint for why that distinction matters.
    const reviewed = rows.filter((r) => r.human_verdict !== null)

    let leadCorrect = 0
    let categoryJudged = 0
    let categoryCorrect = 0
    const confusion = new Map<string, number>()
    const missedReasons = new Map<string, number>()

    for (const r of reviewed) {
      if (r.human_is_lead === r.is_lead) leadCorrect += 1
      else if (!r.is_lead && r.not_lead_reason) {
        // It said "not a lead, because X" and a person disagreed. X is
        // the thing to go and adjust, so it is worth counting by name.
        missedReasons.set(r.not_lead_reason, (missedReasons.get(r.not_lead_reason) ?? 0) + 1)
      }

      // Only where both sides named a category. A row nobody set a
      // category on says nothing about whether the assistant's was
      // right, and counting it either way would be inventing data.
      if (r.category && r.human_category) {
        categoryJudged += 1
        if (r.category === r.human_category) categoryCorrect += 1
        else {
          const pair = `${r.category}→${r.human_category}`
          confusion.set(pair, (confusion.get(pair) ?? 0) + 1)
        }
      }
    }

    // Labels, so the report reads in the account's own words.
    const categories = await prisma.serviceCategory.findMany({
      where: { account_id: ctx.accountId },
      select: { key: true, label: true },
    })
    const labelFor = new Map(categories.map((c) => [c.key, c.label]))
    const name = (key: string) => labelFor.get(key) ?? key

    const wouldHave = {
      created_leads: rows.filter((r) => r.is_lead).length,
      stayed_silent: rows.filter((r) => !r.is_lead && r.priority === 'quiet').length,
      alerted_urgently: rows.filter((r) => r.priority === 'urgent').length,
    }

    return NextResponse.json({
      days,
      judged,
      reviewed: reviewed.length,
      // Deliberately null rather than 0 when nothing has been reviewed.
      // A screen showing "0% accurate" for an account that simply has
      // not started reviewing would be a lie about the assistant.
      lead_percent:
        reviewed.length > 0 ? Math.round((leadCorrect / reviewed.length) * 100) : null,
      category_percent:
        categoryJudged > 0 ? Math.round((categoryCorrect / categoryJudged) * 100) : null,
      category_judged: categoryJudged,
      /** The pairs it keeps swapping, worst first. The actionable part. */
      confusion: [...confusion.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([pair, count]) => {
          const [said, was] = pair.split('→')
          return { said: name(said), was: name(was), count }
        }),
      /** Kinds of message it wrongly dismissed, worst first. */
      missed: [...missedReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([reason, count]) => ({
          reason: (NOT_LEAD_REASONS as readonly string[]).includes(reason) ? reason : 'unclear',
          count,
        })),
      /** What it would have done, for an owner deciding whether to let
       *  it. Counted over every judgement, reviewed or not. */
      would_have: wouldHave,
      acted: rows.filter((r) => r.acted).length,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
