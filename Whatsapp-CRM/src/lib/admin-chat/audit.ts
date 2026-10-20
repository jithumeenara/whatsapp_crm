/**
 * Admin Chat audit log — append-only and hash-chained: each row's hash
 * covers the previous row's hash, so a row edited or deleted later breaks
 * the chain and verifyAuditChain says where. One writer at a time per
 * account (an advisory lock), so two events at once cannot fork the chain.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { auditHash } from './rules'

export type AuditEvent =
  | 'settings_changed'
  | 'member_added'
  | 'member_verified'
  | 'member_changed'
  | 'member_disabled'
  | 'code_requested'
  | 'code_failed'
  | 'locked'
  | 'session_started'
  | 'question'
  | 'session_ended'
  | 'refused'
  | 'all_sessions_ended'
  | 'brief_sent'
  | 'alert_sent'
  | 'brief_off'
  | 'alerts_off'
  | 'action_proposed'
  | 'action_awaiting_web'
  | 'action_rejected'
  | 'action_done'
  | 'action_failed'
  | 'action_undone'

export async function writeAudit(args: {
  accountId: string
  event: AuditEvent
  memberId?: string | null
  sessionId?: string | null
  actorUserId?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  const detail = { ...(args.detail ?? {}), ...(args.memberId ? { member_id: args.memberId } : {}), ...(args.actorUserId ? { actor_user_id: args.actorUserId } : {}) }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`admin-chat-audit:${args.accountId}`}))::text`
      const last = await tx.adminChatAudit.findFirst({ where: { account_id: args.accountId }, orderBy: { id: 'desc' }, select: { hash: true } })
      const prev = last?.hash ?? 'genesis'
      const createdAt = new Date()
      await tx.adminChatAudit.create({
        data: {
          account_id: args.accountId,
          member_id: args.memberId ?? null,
          session_id: args.sessionId ?? null,
          actor_user_id: args.actorUserId ?? null,
          event: args.event,
          detail: detail as Prisma.InputJsonValue,
          prev_hash: prev,
          hash: auditHash(prev, { accountId: args.accountId, event: args.event, detail, createdAt }),
          created_at: createdAt,
        },
      })
    })
  } catch (err) {
    // The audit must never stop the answer; the failure itself is logged.
    console.error('[admin-chat] audit write failed:', err instanceof Error ? err.message : err)
  }
}

/** Walks the chain from the start. ok=false names the first row that does not fit. */
export async function verifyAuditChain(accountId: string): Promise<{ ok: boolean; rows: number; brokenAtId: string | null }> {
  let prev = 'genesis'
  let rows = 0
  let cursor: bigint | null = null
  for (;;) {
    const batch: Array<{ id: bigint; event: string; detail: Prisma.JsonValue; prev_hash: string; hash: string; created_at: Date }> =
      await prisma.adminChatAudit.findMany({
        where: { account_id: accountId, ...(cursor !== null ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: 500,
        select: { id: true, event: true, detail: true, prev_hash: true, hash: true, created_at: true },
      })
    if (batch.length === 0) break
    for (const row of batch) {
      rows++
      const expected = auditHash(prev, { accountId, event: row.event, detail: row.detail, createdAt: row.created_at })
      if (row.prev_hash !== prev || row.hash !== expected) return { ok: false, rows, brokenAtId: row.id.toString() }
      prev = row.hash
    }
    cursor = batch[batch.length - 1].id
  }
  return { ok: true, rows, brokenAtId: null }
}
