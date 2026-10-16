/**
 * The account's connected WhatsApp numbers, with the phone a visitor would
 * message — read from Meta, since the CRM stores only Meta's number id.
 *
 * Used by Settings → Website Bot to list the numbers, and on save to keep
 * a snapshot on the widget (contact-menu.ts) so page views never wait on
 * Meta. Always scoped to one account; tokens never leave this file.
 */

import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { normalizePhone, type WhatsAppLink } from './contact-menu'

export interface AccountWhatsAppNumber {
  id: string
  label: string | null
  is_default: boolean
  status: string
  /** Digits with country code, or null when Meta could not be read. */
  phone: string | null
}

async function phoneOf(config: { phone_number_id: string; access_token: string }): Promise<string | null> {
  try {
    const info = await verifyPhoneNumber({ phoneNumberId: config.phone_number_id, accessToken: decrypt(config.access_token) })
    return normalizePhone(info.display_phone_number)
  } catch (err) {
    console.error('[webchat] could not read a WhatsApp number from Meta:', err instanceof Error ? err.message : err)
    return null
  }
}

async function load(accountId: string, ids?: string[]) {
  return prisma.whatsAppConfig.findMany({
    where: { account_id: accountId, ...(ids ? { id: { in: ids } } : {}) },
    select: { id: true, label: true, is_default: true, status: true, phone_number_id: true, access_token: true },
    orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
  })
}

export async function accountWhatsAppNumbers(accountId: string): Promise<AccountWhatsAppNumber[]> {
  const configs = await load(accountId)
  const phones = await Promise.all(configs.map(phoneOf))
  return configs.map((c, i) => ({ id: c.id, label: c.label, is_default: c.is_default, status: c.status, phone: phones[i] }))
}

/** The chosen numbers with their phones, or why they cannot be saved. */
export async function snapshotWhatsAppLinks(
  accountId: string,
  selection: { config_id: string; label: string }[],
): Promise<{ ok: true; links: WhatsAppLink[] } | { ok: false; error: string }> {
  if (selection.length === 0) return { ok: true, links: [] }
  const configs = await load(accountId, selection.map((s) => s.config_id))
  const links: WhatsAppLink[] = []
  for (const chosen of selection) {
    const config = configs.find((c) => c.id === chosen.config_id)
    if (!config) return { ok: false, error: 'That WhatsApp number is not connected to this account any more. Pick again.' }
    const phone = await phoneOf(config)
    if (!phone) return { ok: false, error: `Could not read the number for "${chosen.label}" from WhatsApp just now. Try saving again.` }
    links.push({ config_id: chosen.config_id, label: chosen.label, phone })
  }
  return { ok: true, links }
}
