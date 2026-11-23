/**
 * Knowledge-search settings, per account (migration 197,
 * ai_configs.retrieval_settings). Read with plain SQL, like
 * image-settings.ts, so a database without the column behaves as before.
 *
 *   rerank  After the search, a small fast model re-orders the best
 *           candidates by how well they answer this exact question
 *           (rerank.ts). Off by default: it adds a model call and a
 *           little time to every reply. Measure it on the Accuracy tab
 *           ("Right knowledge found in X of Y") before and after.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export interface RetrievalSettings {
  rerank: boolean
}

export const DEFAULT_RETRIEVAL_SETTINGS: RetrievalSettings = { rerank: false }

export function parseRetrievalSettings(raw: unknown): RetrievalSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { rerank: o.rerank === true }
}

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: RetrievalSettings }>()

export async function retrievalSettingsFor(accountId: string): Promise<RetrievalSettings> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  let value = DEFAULT_RETRIEVAL_SETTINGS
  try {
    const rows = await prisma.$queryRaw<Array<{ retrieval_settings: unknown }>>(
      Prisma.sql`SELECT retrieval_settings FROM ai_configs WHERE account_id = ${accountId}::uuid`,
    )
    value = parseRetrievalSettings(rows[0]?.retrieval_settings)
  } catch {
    // No column yet: defaults, as before.
  }
  cache.set(accountId, { at: Date.now(), value })
  return value
}

export async function setRetrievalSettings(accountId: string, settings: RetrievalSettings): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS retrieval_settings JSONB')
  await prisma.$executeRaw(
    Prisma.sql`UPDATE ai_configs SET retrieval_settings = ${JSON.stringify(settings)}::jsonb WHERE account_id = ${accountId}::uuid`,
  )
  cache.delete(accountId)
}
