/**
 * AI & Automation report data (plan §4.7): assistant and chatbot replies,
 * chats settled without a person, handovers (ai_handovers, migration 163)
 * with their reasons, hours and how fast a person took over, the
 * questions the assistant could not answer, chatbot flow drop-off, and
 * the leads the assistant suggested that people accepted.
 *
 * A server that has not run migration 163 yet still gets every other part
 * of the report; the handover part says it starts once the update is in.
 */

import { prisma } from '@/lib/db'
import type { ReportPeriod } from '../period'
import { median } from './activity'
import { ASSISTANT_SOURCES } from '@/lib/ai/history'

export interface HandoverRow { reason: string; source: string; outside: boolean; takenMin: number | null; takenBy: string | null }

export function summariseHandovers(rows: HandoverRow[]) {
  const reasons = new Map<string, number>()
  const bySource: Record<string, number> = {}
  for (const r of rows) {
    reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1)
    bySource[r.source] = (bySource[r.source] ?? 0) + 1
  }
  const taken = rows.filter((r) => r.takenMin != null)
  return {
    total: rows.length,
    outside: rows.filter((r) => r.outside).length,
    taken: taken.length,
    notTaken: rows.length - taken.length,
    takenMedian: median(taken.map((r) => Math.max(0, r.takenMin as number))),
    byReason: [...reasons.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    bySource,
  }
}

/** Questions the assistant could not answer: the same one asked again counts, not repeats. */
export function topQuestions(rows: Array<{ text: string | null; at: string }>, limit = 15) {
  const by = new Map<string, { text: string; times: number; last: string }>()
  for (const r of rows) {
    const text = (r.text ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const key = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').trim()
    const e = by.get(key)
    if (!e) by.set(key, { text, times: 1, last: r.at })
    else {
      e.times += 1
      if (r.at > e.last) { e.last = r.at; e.text = text }
    }
  }
  return [...by.values()].sort((a, b) => b.times - a.times || b.last.localeCompare(a.last)).slice(0, limit)
}

export interface FlowRunRow { flow: string; name: string; status: string; endReason: string | null; node: string | null }

export function flowFunnels(rows: FlowRunRow[]) {
  const by = new Map<string, { flow: string; name: string; started: number; finished: number; handedOver: number; stopped: number; running: number; stops: Map<string, number> }>()
  for (const r of rows) {
    const f = by.get(r.flow) ?? { flow: r.flow, name: r.name, started: 0, finished: 0, handedOver: 0, stopped: 0, running: 0, stops: new Map() }
    f.started += 1
    if (r.status === 'completed') f.finished += 1
    else if (r.status === 'handed_off') f.handedOver += 1
    else if (r.status === 'active') f.running += 1
    else {
      f.stopped += 1
      if (r.node) f.stops.set(r.node, (f.stops.get(r.node) ?? 0) + 1)
    }
    by.set(r.flow, f)
  }
  return [...by.values()].map(({ stops, ...f }) => {
    const worst = [...stops.entries()].sort((a, b) => b[1] - a[1])[0]
    return { ...f, worstStep: worst?.[0] ?? null, worstStepCount: worst?.[1] ?? 0 }
  }).sort((a, b) => b.started - a.started)
}

export async function loadAutomation(a: { accountId: string; period: ReportPeriod }) {
  const p = a.period
  const [replies, handovers, runs, aiLeads] = await Promise.all([
    prisma.$queryRaw<Array<{ source: string | null; n: bigint }>>`
      SELECT m.bot_source AS source, count(*) AS n
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = ${a.accountId}::uuid AND m.sender_type = 'bot' AND m.deleted_at IS NULL
        AND m.created_at >= ${p.from} AND m.created_at < ${p.to}
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ reason: string; source: string; outside: boolean; question: string | null; at: Date; taken_min: number | null; taken_by: string | null }>>`
      SELECT h.reason, h.source, h.outside_hours AS outside, h.question, h.created_at AS at,
             EXTRACT(EPOCH FROM (t.at - h.created_at)) / 60 AS taken_min, t.sender_id::text AS taken_by
      FROM ai_handovers h
      LEFT JOIN LATERAL (
        SELECT m.created_at AS at, m.sender_id FROM messages m
        WHERE m.conversation_id = h.conversation_id AND m.sender_type = 'agent' AND m.deleted_at IS NULL AND m.created_at > h.created_at
        ORDER BY m.created_at LIMIT 1
      ) t ON true
      WHERE h.account_id = ${a.accountId}::uuid AND h.created_at >= ${p.from} AND h.created_at < ${p.to}
      LIMIT 20000`.then((r) => ({ ok: true as const, rows: r })).catch((err) => {
      console.error('[reports] handovers not readable (migration 163?):', err instanceof Error ? err.message : err)
      return { ok: false as const, rows: [] }
    }),
    prisma.$queryRaw<Array<{ flow: string; name: string; status: string; end_reason: string | null; node: string | null }>>`
      SELECT r.flow_id::text AS flow, f.name, r.status, r.end_reason, r.current_node_key AS node
      FROM flow_runs r JOIN flows f ON f.id = r.flow_id
      WHERE r.account_id = ${a.accountId}::uuid AND r.started_at >= ${p.from} AND r.started_at < ${p.to}
      LIMIT 50000`,
    prisma.$queryRaw<Array<{ suggested: bigint; accepted: bigint; rejected: bigint }>>`
      SELECT count(*) AS suggested,
             count(*) FILTER (WHERE ai_review_result = 'accepted') AS accepted,
             count(*) FILTER (WHERE ai_review_result = 'rejected') AS rejected
      FROM leads WHERE account_id = ${a.accountId}::uuid AND ai_confidence IS NOT NULL
        AND created_at >= ${p.from} AND created_at < ${p.to}`,
  ])
  const n = (v: unknown) => Number(v ?? 0) || 0
  const hRows: HandoverRow[] = handovers.rows.map((r) => ({ reason: r.reason, source: r.source, outside: r.outside, takenMin: r.taken_min == null ? null : Number(r.taken_min), takenBy: r.taken_by }))
  const QUESTION_REASONS = new Set(['low_confidence', 'unsupported_details', 'turn_limit'])
  return {
    replies: {
      // The assistant's own messages include its clarifying questions.
      ai: replies.filter((r) => r.source != null && ASSISTANT_SOURCES.has(r.source)).reduce((x, r) => x + n(r.n), 0),
      chatbot: replies.filter((r) => r.source == null || !ASSISTANT_SOURCES.has(r.source)).reduce((x, r) => x + n(r.n), 0),
    },
    handoversReady: handovers.ok,
    handovers: summariseHandovers(hRows),
    questions: topQuestions(handovers.rows.filter((r) => QUESTION_REASONS.has(r.reason)).map((r) => ({ text: r.question, at: r.at.toISOString() }))),
    flows: flowFunnels(runs.map((r) => ({ flow: r.flow, name: r.name, status: r.status, endReason: r.end_reason, node: r.node }))),
    aiLeads: { suggested: n(aiLeads[0]?.suggested), accepted: n(aiLeads[0]?.accepted), rejected: n(aiLeads[0]?.rejected) },
  }
}
