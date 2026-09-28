/**
 * How the assistant has actually been doing — the last seven days, read
 * from the explanation every AI reply now carries (messages.ai_meta,
 * reply-sources.ts) and from the hand-over notes.
 *
 * The accuracy tests say how it does on questions somebody wrote down;
 * this says how it did on the ones customers sent. The two lists at the
 * bottom are the to-do list: what it was caught inventing, and what it
 * was asked with nothing to answer from.
 */

import { prisma } from '@/lib/db'
import { REASON_HEADLINES_LIST } from '../handoff-context'

export interface QualityReport {
  days: number
  ai_replies: number
  caught: number
  unsupported: number
  table_searches: number
  handovers: Array<{ reason: string; count: number }>
  caught_items: Array<{ text: string; count: number }>
  no_knowledge: Array<{ question: string; count: number }>
}

const SCAN = 3000

interface Meta {
  retrieval?: string
  tools?: string[]
  unsupported?: string[]
  corrected?: string[]
}

function top(values: string[], limit: number): Array<{ text: string; count: number }> {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts.entries()]
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export async function qualityReport(accountId: string, days = 7): Promise<QualityReport> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [replies, notes] = await Promise.all([
    prisma.message.findMany({
      where: { sender_type: 'bot', created_at: { gte: since }, conversation: { account_id: accountId } },
      select: { ai_meta: true, conversation_id: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: SCAN,
    }),
    prisma.message.findMany({
      where: { sender_type: 'system', created_at: { gte: since }, conversation: { account_id: accountId } },
      select: { content_text: true },
      take: SCAN,
    }),
  ])

  const explained = replies.filter((r) => r.ai_meta && typeof r.ai_meta === 'object') as Array<{
    ai_meta: Meta
    conversation_id: string
    created_at: Date
  }>

  const caught = explained.filter((r) => (r.ai_meta.corrected?.length ?? 0) > 0)
  const unsupported = explained.filter((r) => (r.ai_meta.unsupported?.length ?? 0) > 0)
  const searches = explained.filter((r) => r.ai_meta.tools?.includes('search_records'))

  // Asked with nothing to answer from: no knowledge matched and nothing
  // was looked up. What the customer said just before is the question.
  const empty = explained.filter((r) => r.ai_meta.retrieval === 'none' && !(r.ai_meta.tools?.length)).slice(0, 40)
  const asked = await Promise.all(
    empty.map((r) =>
      prisma.message.findFirst({
        where: { conversation_id: r.conversation_id, sender_type: 'customer', created_at: { lte: r.created_at } },
        orderBy: { created_at: 'desc' },
        select: { content_text: true },
      }),
    ),
  )

  const reasons = new Map<string, number>()
  for (const n of notes) {
    const first = (n.content_text ?? '').split('\n')[0].trim()
    if (REASON_HEADLINES_LIST.includes(first)) reasons.set(first, (reasons.get(first) ?? 0) + 1)
  }

  return {
    days,
    ai_replies: explained.length,
    caught: caught.length,
    unsupported: unsupported.length,
    table_searches: searches.length,
    handovers: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    caught_items: top(caught.flatMap((r) => r.ai_meta.corrected ?? []), 10),
    no_knowledge: top(
      asked.map((a) => (a?.content_text ?? '').trim()).filter((t) => t && t.length <= 300),
      10,
    ).map(({ text, count }) => ({ question: text, count })),
  }
}
