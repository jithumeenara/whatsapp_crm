/**
 * How well the assistant is actually doing.
 *
 * Every serious conversation platform reports this and this one reported
 * nothing, which is a worse gap than any missing feature: without it
 * nobody can say how many questions the bot handled, how often it had to
 * fetch a person, or which questions it keeps failing. Improvements were
 * guesses, and so was the decision that they had worked.
 *
 * Nothing new is collected to produce these numbers. They are read out
 * of messages and flow runs the app has been writing all along, which
 * means the first report covers the whole history rather than starting
 * from today.
 *
 * Two honest limits, stated here rather than implied by a confident
 * chart:
 *
 *  - Containment is measured as "no human replied", which is the
 *    industry's own definition and an operational fact, not a quality
 *    one. A bot that answered badly and was never escalated counts as
 *    contained. That is what the CSAT figures below it are for.
 *  - A conversation is counted in the window it received a customer
 *    message in. One spanning midnight is counted once, on the first day.
 */

import { prisma } from '@/lib/db'
import { AI_AUTO_REPLY_SOURCE } from './auto-reply'

export interface QualityWindow {
  accountId: string
  /** Inclusive. */
  from: Date
  /** Exclusive. */
  to: Date
}

export interface QualitySummary {
  conversations: number
  /** Ended without any human message. The industry's containment rate. */
  contained: number
  /** A person replied at some point. */
  escalated: number
  containment_rate: number
  /** Replies the AI produced because no chatbot flow matched. */
  ai_replies: number
  /** Chatbot runs that reached a handoff step, or were handed off by the
   *  confidence guard. */
  handoffs: number
  /** Customers who typed "agent" and were pulled out of a flow. */
  escapes: number
  /** Chatbot runs that finished normally. */
  flows_completed: number
  flows_started: number
  /** How many customers were asked how it went. */
  csat_asked: number
  /** How many of them answered. */
  csat_answered: number
  /** Mean of the answers, on a 1-5 scale. Null until somebody answers —
   *  a zero here would read as "everybody hated it". */
  csat_average: number | null
}

export interface UnansweredQuestion {
  question: string
  times: number
  last_asked: Date
}

/**
 * The headline numbers.
 *
 * Four small aggregates rather than one clever join: each is indexed,
 * each is independently correct, and a slow one can be found without
 * unpicking a hundred-line query.
 */
export async function loadQualitySummary(w: QualityWindow): Promise<QualitySummary> {
  const [conversationRows, aiReplies, runRows, feedback] = await Promise.all([
    // One row per conversation that heard from a customer in the window,
    // carrying whether a human ever answered in it.
    prisma.$queryRaw<Array<{ conversation_id: string; had_agent: boolean }>>`
      SELECT m.conversation_id,
             bool_or(m.sender_type = 'agent') AS had_agent
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = ${w.accountId}::uuid
        AND m.created_at >= ${w.from}
        AND m.created_at <  ${w.to}
      GROUP BY m.conversation_id
      HAVING bool_or(m.sender_type = 'customer')
    `,

    prisma.message.count({
      where: {
        bot_source: AI_AUTO_REPLY_SOURCE,
        created_at: { gte: w.from, lt: w.to },
        conversation: { account_id: w.accountId },
      },
    }),

    prisma.$queryRaw<Array<{ status: string; end_reason: string | null; n: bigint }>>`
      SELECT status, end_reason, COUNT(*) AS n
      FROM flow_runs
      WHERE account_id = ${w.accountId}::uuid
        AND started_at >= ${w.from}
        AND started_at <  ${w.to}
      GROUP BY status, end_reason
    `,

    prisma.conversationFeedback.aggregate({
      where: { account_id: w.accountId, asked_at: { gte: w.from, lt: w.to } },
      _count: { _all: true },
      _avg: { rating: true },
    }),
  ])

  // _avg ignores nulls, so the count of answers has to be asked for
  // separately rather than inferred from the aggregate above.
  const answered = await prisma.conversationFeedback.count({
    where: {
      account_id: w.accountId,
      asked_at: { gte: w.from, lt: w.to },
      rating: { not: null },
    },
  })

  const conversations = conversationRows.length
  const escalated = conversationRows.filter((r) => r.had_agent).length
  const contained = conversations - escalated

  let handoffs = 0
  let escapes = 0
  let flowsCompleted = 0
  let flowsStarted = 0
  for (const row of runRows) {
    const n = Number(row.n)
    flowsStarted += n
    if (row.status === 'handed_off') handoffs += n
    if (row.status === 'completed') flowsCompleted += n
    if (row.end_reason === 'customer_asked_for_a_person') escapes += n
  }

  return {
    conversations,
    contained,
    escalated,
    containment_rate: conversations === 0 ? 0 : contained / conversations,
    ai_replies: aiReplies,
    handoffs,
    escapes,
    flows_completed: flowsCompleted,
    flows_started: flowsStarted,
    csat_asked: feedback._count._all,
    csat_answered: answered,
    csat_average: feedback._avg.rating ?? null,
  }
}

/**
 * The questions the chatbot has no answer for.
 *
 * Found by looking at what the customer said immediately before the AI
 * had to step in — an AI auto-reply only happens when no flow claimed the
 * message, so each one is a question nobody built a flow for. A phrase
 * appearing here week after week is the clearest instruction this app can
 * give about what to build next.
 *
 * Grouped on the trimmed, lower-cased text. Deliberately crude: two
 * customers phrasing the same question differently show up as two rows,
 * which is honest — clustering them would need embeddings and would hide
 * how people actually write.
 */
export async function loadUnansweredQuestions(
  w: QualityWindow,
  limit = 40,
): Promise<UnansweredQuestion[]> {
  const rows = await prisma.$queryRaw<
    Array<{ question: string; times: bigint; last_asked: Date }>
  >`
    WITH ai_replies AS (
      SELECT m.conversation_id, m.created_at
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = ${w.accountId}::uuid
        AND m.bot_source = ${AI_AUTO_REPLY_SOURCE}
        AND m.created_at >= ${w.from}
        AND m.created_at <  ${w.to}
    ),
    asked AS (
      SELECT DISTINCT ON (r.conversation_id, r.created_at)
             q.content_text AS text,
             q.created_at   AS asked_at
      FROM ai_replies r
      JOIN messages q
        ON q.conversation_id = r.conversation_id
       AND q.sender_type = 'customer'
       AND q.content_type = 'text'
       AND q.created_at < r.created_at
      ORDER BY r.conversation_id, r.created_at, q.created_at DESC
    )
    SELECT lower(btrim(text)) AS question,
           COUNT(*)           AS times,
           MAX(asked_at)      AS last_asked
    FROM asked
    WHERE text IS NOT NULL AND btrim(text) <> ''
    GROUP BY 1
    ORDER BY times DESC, last_asked DESC
    LIMIT ${limit}
  `
  return rows.map((r) => ({
    question: r.question,
    times: Number(r.times),
    last_asked: r.last_asked,
  }))
}
