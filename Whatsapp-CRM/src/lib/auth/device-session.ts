/**
 * The UserSession row a sign-in is recorded against — Settings > Profile
 * > Sessions lists one per device, and the jwt callback in src/auth.ts
 * rejects any token whose row is revoked.
 *
 * Signing out and back in on the same browser reuses that browser's row
 * (matched by its exact User-Agent) instead of piling up a new one each
 * time — but only a LIVE row. Reviving a revoked one used to clear its
 * revoked_at, and with it every token ever issued against that row came
 * back: a stolen copy the person had logged out on purpose, or one
 * outstanding when they changed their password. A revoked row stays
 * revoked and the sign-in gets a fresh row; the Sessions list only shows
 * live rows, so nothing piles up on screen.
 */
import type { PrismaClient } from '@prisma/client'
import { deriveDeviceLabel } from './device'

type Db = Pick<PrismaClient, 'userSession'>

export async function recordDeviceSession(
  db: Db,
  userId: string,
  userAgent: string | null,
  ipAddress: string | null,
): Promise<string> {
  const existing = userAgent
    ? await db.userSession.findFirst({
        where: { user_id: userId, user_agent: userAgent, revoked_at: null },
        orderBy: { last_seen_at: 'desc' },
      })
    : null

  if (existing) {
    await db.userSession.update({
      where: { id: existing.id },
      data: { last_seen_at: new Date(), ip_address: ipAddress },
    })
    return existing.id
  }
  const session = await db.userSession.create({
    data: {
      user_id: userId,
      device_label: deriveDeviceLabel(userAgent),
      user_agent: userAgent,
      ip_address: ipAddress,
    },
  })
  return session.id
}
