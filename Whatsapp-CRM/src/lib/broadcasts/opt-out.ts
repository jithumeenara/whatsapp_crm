/**
 * A customer saying "no more promotions" — or "start again".
 *
 * Two ways in: Meta's own "Stop promotions" button (a user_preferences
 * webhook) and a message that is just STOP / START in one of several
 * languages (rules.ts optOutIntent). Either sets the contact's
 * opt_in_status, which every broadcast, follow-up and event send already
 * honours (sendable.ts, send-skip.ts). Conversations and replies to their
 * own questions are not affected — this is about campaigns.
 */

import { prisma } from '@/lib/db'

export type OptOutSource = 'meta_stop_button' | 'stop_keyword' | 'manual'

/** Returns true when the contact's state actually changed. */
export async function setMarketingConsent(args: {
  accountId: string
  contactId: string
  intent: 'stop' | 'start'
  source: OptOutSource
  at?: Date
}): Promise<boolean> {
  const at = args.at ?? new Date()
  if (args.intent === 'stop') {
    const r = await prisma.contact.updateMany({
      where: { id: args.contactId, account_id: args.accountId, opt_in_status: { not: 'opted_out' } },
      data: { opt_in_status: 'opted_out', opted_out_at: at, opt_in_source: args.source },
    })
    return r.count > 0
  }
  const r = await prisma.contact.updateMany({
    where: { id: args.contactId, account_id: args.accountId, opt_in_status: 'opted_out' },
    data: { opt_in_status: 'opted_in', opt_in_at: at, opted_out_at: null, opt_in_source: args.source },
  })
  return r.count > 0
}

export const CONSENT_REPLY: Record<'stop' | 'start', string> = {
  stop: 'You will not get offers or updates from us any more. You can still message us any time. Reply START to receive them again.',
  start: 'Welcome back — you will receive our offers and updates again. Reply STOP any time to stop them.',
}

/** Meta's "Stop promotions" / "Resume" button. Value shape:
 *  { user_preferences: [{ wa_id, category: 'marketing_messages', value: 'stop' | 'resume', timestamp }] } */
export interface MetaUserPreference {
  wa_id?: string
  category?: string
  value?: string
  timestamp?: string | number
}

export function preferenceIntent(p: MetaUserPreference): 'stop' | 'start' | null {
  if (p.category && p.category !== 'marketing_messages') return null
  if (p.value === 'stop') return 'stop'
  if (p.value === 'resume') return 'start'
  return null
}

/** Applies a user_preferences webhook for the number it came to. */
export async function applyMetaUserPreferences(phoneNumberId: string | undefined, prefs: MetaUserPreference[]): Promise<number> {
  if (!phoneNumberId || prefs.length === 0) return 0
  const configs = await prisma.whatsAppConfig.findMany({ where: { phone_number_id: phoneNumberId }, select: { account_id: true } })
  if (configs.length !== 1) {
    console.warn(`[opt-out] user_preferences for ${phoneNumberId}: ${configs.length} matching numbers, ignored`)
    return 0
  }
  const accountId = configs[0].account_id
  const { findExistingContact } = await import('@/lib/contacts/dedupe')
  let changed = 0
  for (const p of prefs) {
    const intent = preferenceIntent(p)
    if (!intent || !p.wa_id) continue
    const contact = await findExistingContact(accountId, p.wa_id)
    if (!contact) continue
    const ts = Number(p.timestamp)
    const at = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date()
    if (await setMarketingConsent({ accountId, contactId: contact.id, intent, source: 'meta_stop_button', at })) changed++
  }
  return changed
}
