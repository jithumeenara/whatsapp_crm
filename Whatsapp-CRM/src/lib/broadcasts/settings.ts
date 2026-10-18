/**
 * An account's broadcast compliance settings (migration 138). No row means
 * the defaults, which are the safe choice: at most 2 marketing messages a
 * person in 7 days, STOP/START words honoured, Meta's per-person daily
 * limit retried once a day later.
 */

import { prisma } from '@/lib/db'

export interface BroadcastSettingsValue {
  frequency_cap_enabled: boolean
  frequency_cap_count: number
  frequency_cap_days: number
  stop_keywords_enabled: boolean
  auto_retry_daily_limit: boolean
}

export const DEFAULT_BROADCAST_SETTINGS: BroadcastSettingsValue = {
  frequency_cap_enabled: true,
  frequency_cap_count: 2,
  frequency_cap_days: 7,
  stop_keywords_enabled: true,
  auto_retry_daily_limit: true,
}

export async function getBroadcastSettings(accountId: string): Promise<BroadcastSettingsValue> {
  try {
    const row = await prisma.broadcastSettings.findUnique({ where: { account_id: accountId } })
    if (!row) return { ...DEFAULT_BROADCAST_SETTINGS }
    return {
      frequency_cap_enabled: row.frequency_cap_enabled,
      frequency_cap_count: row.frequency_cap_count,
      frequency_cap_days: row.frequency_cap_days,
      stop_keywords_enabled: row.stop_keywords_enabled,
      auto_retry_daily_limit: row.auto_retry_daily_limit,
    }
  } catch (err) {
    // Before migration 138 the table is missing: behave as the defaults
    // rather than stopping every send.
    console.warn('[broadcasts] settings unavailable, using defaults:', err instanceof Error ? err.message : err)
    return { ...DEFAULT_BROADCAST_SETTINGS }
  }
}

/** Validates a settings body field by field; returns the clean value or
 *  the first problem in plain words. */
export function parseBroadcastSettings(body: unknown): { value: BroadcastSettingsValue } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const bool = (k: keyof BroadcastSettingsValue) => (typeof b[k] === 'boolean' ? (b[k] as boolean) : DEFAULT_BROADCAST_SETTINGS[k] as boolean)
  const count = Number(b.frequency_cap_count ?? DEFAULT_BROADCAST_SETTINGS.frequency_cap_count)
  const days = Number(b.frequency_cap_days ?? DEFAULT_BROADCAST_SETTINGS.frequency_cap_days)
  if (!Number.isInteger(count) || count < 1 || count > 50) return { error: 'Messages per person must be a whole number from 1 to 50.' }
  if (!Number.isInteger(days) || days < 1 || days > 90) return { error: 'Days must be a whole number from 1 to 90.' }
  return {
    value: {
      frequency_cap_enabled: bool('frequency_cap_enabled'),
      frequency_cap_count: count,
      frequency_cap_days: days,
      stop_keywords_enabled: bool('stop_keywords_enabled'),
      auto_retry_daily_limit: bool('auto_retry_daily_limit'),
    },
  }
}
