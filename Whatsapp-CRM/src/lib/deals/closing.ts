/**
 * What a deal records when it is won, lost or reopened, and the history
 * row every stage or status change leaves (migration 158). Kept in one
 * place so the board, the API and order auto-creation agree, and reports
 * can trust won_at / lost_at the same way they trust a lead's
 * converted_at / lost_at.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export const DEAL_STATUSES = ['open', 'won', 'lost'] as const
export type DealStatus = (typeof DEAL_STATUSES)[number]

export const isDealStatus = (v: unknown): v is DealStatus =>
  typeof v === 'string' && (DEAL_STATUSES as readonly string[]).includes(v)

export const MAX_LOST_REASON = 300

interface Previous {
  status: string
  won_at?: Date | null
  lost_at?: Date | null
}

/**
 * The closing fields to write when a deal's status becomes `next`.
 * Nothing when the status does not change, so an edit to a won deal's
 * title keeps the day it was won.
 */
export function closingFields(
  prev: Previous | null,
  next: DealStatus,
  userId: string | null,
  now = new Date(),
): Prisma.DealUncheckedUpdateInput {
  if (prev && prev.status === next) return {}
  if (next === 'won') return { won_at: now, lost_at: null, lost_reason: null, closed_by: userId }
  if (next === 'lost') return { lost_at: now, won_at: null, closed_by: userId }
  return { won_at: null, lost_at: null, lost_reason: null, closed_by: null }
}

/** One history row. Never fails the change it describes. */
export async function recordDealEvent(e: {
  accountId: string
  dealId: string
  fromStageId?: string | null
  toStageId?: string | null
  fromStatus?: string | null
  toStatus?: string | null
  value?: Prisma.Decimal | number | string | null
  userId?: string | null
}): Promise<void> {
  try {
    await prisma.dealStageEvent.create({
      data: {
        account_id: e.accountId,
        deal_id: e.dealId,
        from_stage_id: e.fromStageId ?? null,
        to_stage_id: e.toStageId ?? null,
        from_status: e.fromStatus ?? null,
        to_status: e.toStatus ?? null,
        value: e.value == null ? null : String(e.value),
        user_id: e.userId ?? null,
      },
    })
  } catch (err) {
    console.error('[deals] stage history not recorded:', err instanceof Error ? err.message : err)
  }
}
