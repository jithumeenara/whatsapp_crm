/**
 * Conversation report data (plan §4.4): chats that had a customer message
 * in the period, how fast they got a first reply (from anyone, and from a
 * person), who answered, which ones lost WhatsApp's 24-hour window, by
 * channel / number / hour / person, and customer ratings.
 *
 * Unit: a conversation with at least one customer message in the period.
 * A thread lives as long as the contact, so "created in the period" would
 * miss every returning customer; the reply time is measured from the first
 * customer message inside the period. Worked out from messages (index on
 * conversation_id, created_at — migration 145); no new columns needed.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import type { ReportPeriod } from '../period'
import { zoneForSql } from '../summary'
import { median } from './activity'

/** "Answered within" target used for the share, in minutes. */
export const REPLY_TARGET_MIN = 15
/** WhatsApp's free reply window. */
export const WINDOW_MIN = 24 * 60

export interface ChatRow {
  id: string
  channel: string
  number: string | null
  agent: string | null
  day: string
  hour: number
  /** First reply from anyone (team or assistant), minutes; null = none yet. */
  replyMin: number | null
  replyType: 'agent' | 'bot' | null
  /** First reply from a person. */
  personMin: number | null
  personBy: string | null
  /** Minutes since the first customer message (for "still waiting"). */
  ageMin: number
}

interface Group { key: string; chats: number; answered: number; medians: number[] }

export function summariseChats(rows: ChatRow[]) {
  const byChannel = new Map<string, Group>()
  const byNumber = new Map<string, Group>()
  const byHour = Array.from({ length: 24 }, () => ({ chats: 0, answered: 0 }))
  const byPerson = new Map<string, { answered: number; mins: number[] }>()
  const add = (m: Map<string, Group>, key: string, r: ChatRow) => {
    const g = m.get(key) ?? { key, chats: 0, answered: 0, medians: [] }
    g.chats += 1
    if (r.replyMin != null) { g.answered += 1; g.medians.push(r.replyMin) }
    m.set(key, g)
  }
  let missedWindow = 0
  let waiting = 0
  for (const r of rows) {
    add(byChannel, r.channel, r)
    add(byNumber, r.number ?? '__none', r)
    const h = byHour[r.hour]
    if (h) { h.chats += 1; if (r.replyMin != null) h.answered += 1 }
    if (r.personBy && r.personMin != null) {
      const p = byPerson.get(r.personBy) ?? { answered: 0, mins: [] }
      p.answered += 1
      p.mins.push(r.personMin)
      byPerson.set(r.personBy, p)
    }
    if (r.replyMin == null ? r.ageMin >= WINDOW_MIN : r.replyMin > WINDOW_MIN) missedWindow += 1
    if (r.replyMin == null && r.ageMin < WINDOW_MIN) waiting += 1
  }
  const replies = rows.map((r) => r.replyMin).filter((m): m is number => m != null).map((m) => Math.max(0, m))
  const people = rows.map((r) => r.personMin).filter((m): m is number => m != null).map((m) => Math.max(0, m))
  const sortG = (m: Map<string, Group>) => [...m.values()].sort((a, b) => b.chats - a.chats).map((g) => ({ key: g.key, chats: g.chats, answered: g.answered, median: median(g.medians) }))
  return {
    total: rows.length,
    answered: replies.length,
    byAi: rows.filter((r) => r.replyType === 'bot').length,
    firstReplyMedian: median(replies),
    personReplyMedian: median(people),
    withinTarget: replies.filter((m) => m <= REPLY_TARGET_MIN).length,
    missedWindow,
    waiting,
    byChannel: sortG(byChannel),
    byNumber: sortG(byNumber),
    byHour,
    byPerson: new Map([...byPerson.entries()].map(([k, v]) => [k, { answered: v.answered, median: median(v.mins) }])),
  }
}

export async function loadChats(a: { accountId: string; userId: string | null; period: ReportPeriod; tz: string; now: Date }) {
  const p = a.period
  const zone = await zoneForSql(prisma, a.tz, a.now)
  const mine = a.userId ? Prisma.sql`AND c.assigned_agent_id = ${a.userId}::uuid` : Prisma.empty
  const [rows, feedback] = await Promise.all([
    prisma.$queryRaw<Array<{
      id: string; channel: string; number: string | null; agent: string | null; day: string; hour: number
      reply_min: number | null; reply_type: string | null; person_min: number | null; person_by: string | null; age_min: number
    }>>`
      SELECT c.id::text AS id, c.channel, c.whatsapp_config_id::text AS number, c.assigned_agent_id::text AS agent,
             ((fi.at AT TIME ZONE ${zone})::date)::text AS day,
             EXTRACT(hour FROM (fi.at AT TIME ZONE ${zone}))::int AS hour,
             EXTRACT(EPOCH FROM (r.at - fi.at)) / 60 AS reply_min, r.sender_type AS reply_type,
             EXTRACT(EPOCH FROM (pr.at - fi.at)) / 60 AS person_min, pr.sender_id::text AS person_by,
             EXTRACT(EPOCH FROM (${a.now}::timestamptz - fi.at)) / 60 AS age_min
      FROM conversations c
      JOIN LATERAL (
        SELECT m.created_at AS at FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_type = 'customer' AND m.deleted_at IS NULL
          AND m.created_at >= ${p.from} AND m.created_at < ${p.to}
        ORDER BY m.created_at LIMIT 1
      ) fi ON true
      LEFT JOIN LATERAL (
        SELECT m.created_at AS at, m.sender_type FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_type IN ('agent', 'bot') AND m.deleted_at IS NULL AND m.created_at > fi.at
        ORDER BY m.created_at LIMIT 1
      ) r ON true
      LEFT JOIN LATERAL (
        SELECT m.created_at AS at, m.sender_id FROM messages m
        WHERE m.conversation_id = c.id AND m.sender_type = 'agent' AND m.deleted_at IS NULL AND m.created_at > fi.at
        ORDER BY m.created_at LIMIT 1
      ) pr ON true
      WHERE c.account_id = ${a.accountId}::uuid AND c.last_message_at >= ${p.from} ${mine}
      LIMIT 50000`,
    prisma.$queryRaw<Array<{ asked: bigint; answered: bigint; avg: number | null; good: bigint }>>`
      SELECT count(*) AS asked, count(f.rating) AS answered, avg(f.rating)::float AS avg,
             count(*) FILTER (WHERE f.rating >= 5) AS good
      FROM conversation_feedback f JOIN conversations c ON c.id = f.conversation_id
      WHERE f.account_id = ${a.accountId}::uuid AND f.asked_at >= ${p.from} AND f.asked_at < ${p.to} ${mine}`,
  ])
  const chats: ChatRow[] = rows.map((r) => ({
    id: r.id, channel: r.channel || 'whatsapp', number: r.number, agent: r.agent, day: r.day, hour: Number(r.hour),
    replyMin: r.reply_min == null ? null : Math.max(0, Number(r.reply_min)),
    replyType: r.reply_type === 'agent' || r.reply_type === 'bot' ? r.reply_type : null,
    personMin: r.person_min == null ? null : Math.max(0, Number(r.person_min)),
    personBy: r.person_by,
    ageMin: Number(r.age_min),
  }))
  const f = feedback[0]
  return {
    rows: chats,
    summary: summariseChats(chats),
    feedback: { asked: Number(f?.asked ?? 0), answered: Number(f?.answered ?? 0), avg: f?.avg == null ? null : Math.round(Number(f.avg) * 10) / 10, good: Number(f?.good ?? 0) },
  }
}
