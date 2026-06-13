import { prisma } from "@/lib/db";
import {
  daysAgoStart,
  DOW_SHORT_MON_FIRST,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(accountId: string): Promise<MetricsBundle> {
  const todayStart = startOfLocalDay()
  const yesterdayStart = daysAgoStart(1)

  const [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    openDeals,
    messagesToday,
    messagesYesterday,
  ] = await Promise.all([
    prisma.conversation.count({ where: { account_id: accountId, status: 'open' } }),
    prisma.conversation.count({ where: { account_id: accountId, status: 'open', created_at: { gte: todayStart } } }),
    prisma.conversation.count({ where: { account_id: accountId, status: 'open', created_at: { gte: yesterdayStart, lt: todayStart } } }),
    prisma.contact.count({ where: { account_id: accountId, created_at: { gte: todayStart } } }),
    prisma.contact.count({ where: { account_id: accountId, created_at: { gte: yesterdayStart, lt: todayStart } } }),
    prisma.deal.findMany({ where: { account_id: accountId, status: 'open' }, select: { value: true } }),
    prisma.message.count({
      where: {
        sender_type: 'agent',
        created_at: { gte: todayStart },
        conversation: { account_id: accountId },
      },
    }),
    prisma.message.count({
      where: {
        sender_type: 'agent',
        created_at: { gte: yesterdayStart, lt: todayStart },
        conversation: { account_id: accountId },
      },
    }),
  ])

  const openDealsValue = openDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0)

  return {
    activeConversations: {
      current: openConvCur,
      previous: newConvToday - newConvYesterday,
    },
    newContactsToday: {
      current: newContactsToday,
      previous: newContactsYesterday,
    },
    openDealsValue,
    openDealsCount: openDeals.length,
    messagesSentToday: {
      current: messagesToday,
      previous: messagesYesterday,
    },
  }
}

// --- 2. Conversations over time ---------------------------------------

export async function loadConversationsSeries(
  accountId: string,
  rangeDays: number,
): Promise<ConversationsSeriesPoint[]> {
  const start = daysAgoStart(rangeDays - 1)

  const messages = await prisma.message.findMany({
    where: {
      created_at: { gte: start },
      conversation: { account_id: accountId },
    },
    select: { created_at: true, sender_type: true },
    orderBy: { created_at: 'asc' },
  })

  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })

  for (const row of messages) {
    const key = localDayKey(row.created_at.toISOString())
    const bucket = buckets.get(key)
    if (!bucket) continue
    if (row.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1
  }

  return keys.map((day) => ({ day, ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }) }))
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut(accountId: string): Promise<PipelineDonutData> {
  const [stages, deals] = await Promise.all([
    prisma.pipelineStage.findMany({
      where: { pipeline: { account_id: accountId } },
      select: { id: true, name: true, color: true },
      orderBy: { position: 'asc' },
    }),
    prisma.deal.findMany({
      where: { account_id: accountId, status: 'open' },
      select: { stage_id: true, value: true },
    }),
  ])

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += Number(d.value ?? 0)
    byStage.set(d.stage_id, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(accountId: string): Promise<ResponseTimeSummary> {
  const fourteenDaysAgo = daysAgoStart(13)

  const rows = await prisma.message.findMany({
    where: {
      created_at: { gte: fourteenDaysAgo },
      conversation: { account_id: accountId },
    },
    select: { conversation_id: true, sender_type: true, created_at: true },
    orderBy: [{ conversation_id: 'asc' }, { created_at: 'asc' }],
  })

  interface Sample { customerAt: Date; responseAt: Date }
  const samples: Sample[] = []

  let currentConv = ''
  let pendingCustomer: Date | null = null
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id
      pendingCustomer = null
    }
    const ts = row.created_at
    if (row.sender_type === 'customer') {
      if (!pendingCustomer) pendingCustomer = ts
    } else if (pendingCustomer) {
      samples.push({ customerAt: pendingCustomer, responseAt: ts })
      pendingCustomer = null
    }
  }

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)

  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []

  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }

  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

  const buckets: ResponseTimeBucket[] = Array.from({ length: 7 }, (_, dow) => ({
    dow,
    avgMinutes: avg(byDow.get(dow) ?? []),
    samples: (byDow.get(dow) ?? []).length,
  }))

  void DOW_SHORT_MON_FIRST

  return {
    buckets,
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}

// --- 5. Activity feed --------------------------------------------------

export async function loadActivity(accountId: string, limit = 20): Promise<ActivityItem[]> {
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    prisma.message.findMany({
      where: { sender_type: 'customer', conversation: { account_id: accountId } },
      select: {
        id: true,
        content_text: true,
        created_at: true,
        conversation_id: true,
        conversation: { select: { contact: { select: { name: true, phone: true } } } },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    prisma.contact.findMany({
      where: { account_id: accountId },
      select: { id: true, name: true, phone: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
    prisma.deal.findMany({
      where: { account_id: accountId },
      select: { id: true, title: true, updated_at: true, stage: { select: { name: true } } },
      orderBy: { updated_at: 'desc' },
      take: 10,
    }),
    prisma.broadcast.findMany({
      where: { account_id: accountId },
      select: { id: true, name: true, status: true, total_recipients: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 5,
    }),
    prisma.automationLog.findMany({
      where: { account_id: accountId },
      select: {
        id: true,
        trigger_event: true,
        status: true,
        created_at: true,
        automation: { select: { name: true } },
        contact: { select: { name: true, phone: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    }),
  ])

  const items: ActivityItem[] = []

  for (const m of msgs) {
    const who = m.conversation.contact?.name || m.conversation.contact?.phone || 'Unknown'
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      text: `New message from ${who}`,
      at: m.created_at.toISOString(),
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of contacts) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      text: `New contact: ${c.name || c.phone}`,
      at: c.created_at.toISOString(),
      href: '/contacts',
    })
  }

  for (const d of deals) {
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      text: d.stage?.name
        ? `Deal "${d.title}" in ${d.stage.name}`
        : `Deal "${d.title}" updated`,
      at: d.updated_at.toISOString(),
      href: '/pipelines',
    })
  }

  for (const b of broadcasts) {
    const label =
      b.status === 'sent'
        ? `sent to ${b.total_recipients} contacts`
        : `${b.status} (${b.total_recipients} recipients)`
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      text: `Broadcast "${b.name}" ${label}`,
      at: b.created_at.toISOString(),
      href: '/broadcasts',
    })
  }

  for (const l of autoLogs) {
    const who = l.contact?.name || l.contact?.phone || 'a contact'
    const autoName = l.automation?.name || 'Automation'
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
      at: l.created_at.toISOString(),
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
