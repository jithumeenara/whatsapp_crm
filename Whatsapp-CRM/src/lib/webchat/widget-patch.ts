/**
 * A widget save: the checked fields (settings.ts), plus the WhatsApp
 * numbers, whose phones are read from Meta for this account only
 * (whatsapp-snapshot.ts). Shared by create and update.
 */

import { parseWidgetPatch, type PatchResult } from './settings'
import { parseWhatsAppSelection } from './contact-menu'
import { snapshotWhatsAppLinks } from './whatsapp-snapshot'

export async function buildWidgetPatch(accountId: string, body: Record<string, unknown>): Promise<PatchResult> {
  const parsed = parseWidgetPatch(body)
  if (!parsed.ok || body.whatsapp_numbers === undefined) return parsed
  const selection = parseWhatsAppSelection(body.whatsapp_numbers)
  if (!selection.ok) return { ok: false, error: selection.error }
  const snapshot = await snapshotWhatsAppLinks(accountId, selection.selection)
  if (!snapshot.ok) return { ok: false, error: snapshot.error }
  return { ok: true, patch: { ...parsed.patch, whatsapp_links: snapshot.links } }
}
