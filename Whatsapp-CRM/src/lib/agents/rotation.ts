/**
 * Whose turn it is in a queue — fair round robin that survives people
 * joining and leaving and two servers choosing at once.
 *
 * Only the last person given work is stored (assignment_rotations); the
 * next is the first candidate after them in a fixed order (by user id),
 * wrapping round. Chosen under a Postgres advisory lock for the queue.
 */

import { prisma } from '@/lib/db'

export async function takeTurn<T extends { userId: string }>(accountId: string, scope: string, candidates: T[]): Promise<T | null> {
  if (candidates.length === 0) return null
  const ordered = [...candidates].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`assign:${accountId}:${scope}`}))::text`
    const rot = await tx.assignmentRotation.findUnique({ where: { account_id_scope: { account_id: accountId, scope } } })
    const last = rot?.last_user_id ?? null
    const next = (last ? ordered.find((a) => a.userId > last) : undefined) ?? ordered[0]
    await tx.assignmentRotation.upsert({
      where: { account_id_scope: { account_id: accountId, scope } },
      create: { account_id: accountId, scope, last_user_id: next.userId, turn: 1 },
      update: { last_user_id: next.userId, turn: (rot?.turn ?? 0) + 1, updated_at: new Date() },
    })
    return next
  })
}
