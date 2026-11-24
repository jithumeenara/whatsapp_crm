/**
 * "Alert staff on Telegram" — whether a handover also messages the
 * owners/admins linked on Telegram (staff-telegram.ts). On by default:
 * that is how it behaved before the switch existed.
 *
 * Stored in ai_configs.handoff_alert_telegram (migration 180), read with
 * plain SQL rather than through Prisma, so a database without the column
 * keeps loading every config and simply keeps alerts on.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: boolean }>()

export async function telegramAlertsOn(accountId: string): Promise<boolean> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  let value = true
  try {
    const rows = await prisma.$queryRaw<Array<{ enabled: boolean | null }>>(
      Prisma.sql`SELECT handoff_alert_telegram AS enabled FROM ai_configs WHERE account_id = ${accountId}::uuid`,
    )
    value = rows[0]?.enabled !== false
  } catch {
    // No column yet: alerts stay on, as before.
  }
  cache.set(accountId, { at: Date.now(), value })
  return value
}

export async function setTelegramAlerts(accountId: string, on: boolean): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS handoff_alert_telegram BOOLEAN NOT NULL DEFAULT true')
  await prisma.$executeRaw(
    Prisma.sql`UPDATE ai_configs SET handoff_alert_telegram = ${on} WHERE account_id = ${accountId}::uuid`,
  )
  cache.delete(accountId)
}
