/**
 * Whether the assistant reads images customers send — per account.
 *
 * Stored in ai_configs.image_settings (migration 120), read with plain
 * SQL rather than through Prisma, so a database without the column keeps
 * loading every config and simply behaves as before — the same pattern
 * as handover-settings.ts. Off by default: reading an image costs a model
 * call, and the photos customers send (prescriptions, ID cards, bank
 * slips) are exactly the kind of thing an account should choose to have
 * read, not discover it has been.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export interface ImageSettings {
  /** Read each image a customer sends: its text and what it shows. */
  read_images: boolean
  /** Read each file a customer sends — PDFs and plain text, the formats
   *  Gemini actually understands (a Word or Excel file is left for staff). */
  read_files: boolean
  /** Before acting on it, say what was read and ask the customer to
   *  confirm — with Yes / No buttons. */
  confirm: boolean
}

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = { read_images: false, read_files: false, confirm: true }

export function parseImageSettings(raw: unknown): ImageSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    read_images: o.read_images === true,
    read_files: o.read_files === true,
    // Confirming is the safe default, so only an explicit false turns it off.
    confirm: o.confirm !== false,
  }
}

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: ImageSettings }>()

export async function imageSettingsFor(accountId: string): Promise<ImageSettings> {
  const hit = cache.get(accountId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  let value = DEFAULT_IMAGE_SETTINGS
  try {
    const rows = await prisma.$queryRaw<Array<{ image_settings: unknown }>>(
      Prisma.sql`SELECT image_settings FROM ai_configs WHERE account_id = ${accountId}::uuid`,
    )
    value = parseImageSettings(rows[0]?.image_settings)
  } catch {
    // No column yet: images are not read, as before.
  }
  cache.set(accountId, { at: Date.now(), value })
  return value
}

export async function setImageSettings(accountId: string, settings: ImageSettings): Promise<void> {
  await prisma.$executeRawUnsafe('ALTER TABLE ai_configs ADD COLUMN IF NOT EXISTS image_settings JSONB')
  await prisma.$executeRaw(
    Prisma.sql`UPDATE ai_configs SET image_settings = ${JSON.stringify(settings)}::jsonb WHERE account_id = ${accountId}::uuid`,
  )
  cache.delete(accountId)
}
