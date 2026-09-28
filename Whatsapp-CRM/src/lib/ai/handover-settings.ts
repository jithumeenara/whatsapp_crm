/**
 * How the assistant hands a customer to a person — per account.
 *
 * Stored in ai_configs.handover_settings (migration 118), read with plain
 * SQL rather than through Prisma, so a database without the column keeps
 * loading every config and simply behaves as before. Off by default: an
 * account that has not chosen it keeps the handover it has today.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export interface HandoverSettings {
  /** Ask the customer before connecting them to a person. */
  ask_first: boolean
}

export const DEFAULT_HANDOVER: HandoverSettings = { ask_first: false }

export function parseHandoverSettings(raw: unknown): HandoverSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { ask_first: o.ask_first === true }
}

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: HandoverSettings }>()

export async function handoverSettingsFor(accountId: string): Promise<HandoverSettings> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  let value = DEFAULT_HANDOVER
  try {
    const rows = await prisma.$queryRaw<Array<{ handover_settings: unknown }>>(
      Prisma.sql`SELECT handover_settings FROM ai_configs WHERE account_id = ${accountId}::uuid`,
    )
    value = parseHandoverSettings(rows[0]?.handover_settings)
  } catch {
    // No column yet: the handover as it always was.
  }
  cache.set(accountId, { at: Date.now(), value })
  return value
}

export async function setHandoverSettings(accountId: string, settings: HandoverSettings): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS handover_settings JSONB')
  await prisma.$executeRaw(
    Prisma.sql`UPDATE ai_configs SET handover_settings = ${JSON.stringify(settings)}::jsonb WHERE account_id = ${accountId}::uuid`,
  )
  cache.delete(accountId)
}
