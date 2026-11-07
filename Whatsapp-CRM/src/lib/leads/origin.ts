/**
 * Where a new lead came from, for reports (migration 158): which
 * WhatsApp number it arrived on and which Meta click-to-WhatsApp ad
 * brought it.
 *
 * Read from the conversation the lead came from — the one named, when
 * the caller knows it, else the contact's newest conversation in the
 * same account. Both values are copied onto the lead once, at creation,
 * so a later chat on another number does not rewrite history.
 *
 * Never throws: a lead that cannot be attributed is still a lead. Every
 * lookup is scoped to the account, so an id from elsewhere finds nothing.
 */

import { prisma } from '@/lib/db'

export interface LeadOrigin {
  whatsapp_config_id: string | null
  ad_id: string | null
}

const NONE: LeadOrigin = { whatsapp_config_id: null, ad_id: null }

const SELECT = { whatsapp_config_id: true, ctwa_source_id: true } as const

export async function leadOrigin(args: {
  accountId: string
  contactId?: string | null
  /** The chat the lead came from, when the caller knows it. */
  conversationId?: string | null
}): Promise<LeadOrigin> {
  if (!args.accountId || (!args.contactId && !args.conversationId)) return NONE
  try {
    let conv: { whatsapp_config_id: string | null; ctwa_source_id: string | null } | null = null
    if (args.conversationId) {
      conv = await prisma.conversation.findFirst({
        where: {
          id: args.conversationId,
          account_id: args.accountId,
          ...(args.contactId ? { contact_id: args.contactId } : {}),
        },
        select: SELECT,
      })
    }
    if (!conv && args.contactId) {
      conv = await prisma.conversation.findFirst({
        where: { account_id: args.accountId, contact_id: args.contactId },
        // A chat with no messages yet sorts after the ones that have them
        // (Postgres puts NULLs first in a plain DESC).
        orderBy: [{ last_message_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
        select: SELECT,
      })
    }
    if (!conv) return NONE
    return {
      whatsapp_config_id: conv.whatsapp_config_id ?? null,
      ad_id: conv.ctwa_source_id || null,
    }
  } catch (err) {
    console.error('[leads] lead origin lookup failed:', err instanceof Error ? err.message : err)
    return NONE
  }
}
