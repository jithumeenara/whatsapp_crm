import { prisma } from '@/lib/db'
import { onceSchemaPatch } from '@/lib/db/schema-patch'

/**
 * The columns migration 116 adds, applied once per process in case the
 * migration has not been run. Every ai_eval_cases query reads them, so
 * the accuracy screen and a test run call this first.
 */
export function ensureEvalColumns(): Promise<void> {
  return onceSchemaPatch('ai_eval_exact_checks', async () => {
    await prisma.$executeRawUnsafe('ALTER TABLE ai_eval_cases ADD COLUMN IF NOT EXISTS must_include JSONB')
    await prisma.$executeRawUnsafe('ALTER TABLE ai_eval_cases ADD COLUMN IF NOT EXISTS must_not_include JSONB')
  })
}

/** Phrases as stored: trimmed, non-empty, at most 20 of 200 characters. */
export function cleanPhrases(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const out = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, 20)
  return out.length ? out : null
}
