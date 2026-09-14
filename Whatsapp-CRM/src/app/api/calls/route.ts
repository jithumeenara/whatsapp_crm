import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/calls — the call list.
 *
 * Filters are named after what a person looking at a phone would call
 * them, not after the column: "missed" is the one the list exists for,
 * and it means the call rang and nobody — no agent and no assistant —
 * ever picked it up.
 *
 * Totals come back with the page because a call list is read for the
 * shape of the day ("six missed this morning") at least as often as for
 * any single row, and counting them client-side would only ever count
 * the page.
 */

const PAGE_SIZE_MAX = 100

/** What the tabs above the list mean, in terms of stored rows. */
const FILTERS: Record<string, Prisma.CallWhereInput> = {
  all: {},
  missed: { status: { in: ['missed', 'rejected'] } },
  received: { direction: 'inbound', status: { in: ['completed', 'in_progress'] } },
  made: { direction: 'outbound' },
  /** Handled end-to-end by the assistant, never passed to a person. */
  ai: { handled_by: 'ai', transferred_at: null },
  /** Reached a person, whether directly or by transfer. */
  agent: { handled_by: 'agent' },
}

export async function GET(request: Request) {
  let accountId: string
  try {
    // Agents answer calls, so agents can see the list. Scoping is by
    // account either way — nobody sees another account's calls.
    accountId = (await requireRole('agent')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const url = new URL(request.url)
  const filter = url.searchParams.get('filter') ?? 'all'
  const q = url.searchParams.get('q')?.trim() ?? ''
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(url.searchParams.get('limit') ?? 25) || 25))

  const where: Prisma.CallWhereInput = {
    account_id: accountId,
    ...(FILTERS[filter] ?? {}),
  }

  if (q) {
    // Searched by what is actually written on the row — a name if the
    // caller is known, the number if they are not. Not the transcript: a
    // match deep inside a ten-minute call gives no hint why the row came
    // back.
    where.OR = [
      { from_number: { contains: q, mode: 'insensitive' } },
      { to_number: { contains: q, mode: 'insensitive' } },
      { contact: { name: { contains: q, mode: 'insensitive' } } },
    ]
  }

  try {
    const [calls, total, statusCounts, talkTime] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: { started_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          channel: true,
          direction: true,
          status: true,
          from_number: true,
          to_number: true,
          handled_by: true,
          transferred_at: true,
          transfer_reason: true,
          started_at: true,
          answered_at: true,
          ended_at: true,
          duration_seconds: true,
          end_reason: true,
          conversation_id: true,
          // Only what the row shows. A transcript can run to thousands of
          // words and the list never displays it.
          contact: { select: { id: true, name: true, phone: true } },
          agent: { select: { id: true, profile: { select: { full_name: true } } } },
        },
      }),
      prisma.call.count({ where }),
      // Account-wide, ignoring the current filter — these drive the tab
      // badges, which have to keep showing what is in the other tabs.
      prisma.call.groupBy({
        by: ['status'],
        where: { account_id: accountId },
        _count: { _all: true },
      }),
      prisma.call.aggregate({
        where: { account_id: accountId, duration_seconds: { not: null } },
        _sum: { duration_seconds: true },
        _avg: { duration_seconds: true },
        _count: { _all: true },
      }),
    ])

    return NextResponse.json({
      calls,
      total,
      page,
      limit,
      status_counts: Object.fromEntries(statusCounts.map((c) => [c.status, c._count._all])),
      talk_time: {
        total_seconds: talkTime._sum.duration_seconds ?? 0,
        average_seconds: Math.round(talkTime._avg.duration_seconds ?? 0),
        answered_calls: talkTime._count._all,
      },
    })
  } catch (err) {
    console.error('[GET /api/calls]', err)
    return NextResponse.json({ error: 'Could not load calls.' }, { status: 500 })
  }
}
