/**
 * A customer asked to talk to a person ("Talk to a person" in the
 * Website Bot). That is an enquiry, said out loud — it becomes a lead
 * and the team is told, the way a new WhatsApp enquiry is.
 *
 * - No open lead for this contact: one is created in New Pool and
 *   announced (the floating new-lead alert every agent sees). Whatever
 *   Settings → Leads → Auto lead creation says: that switch is about
 *   guessing from a first message, and here nobody is guessing.
 * - An open lead nobody has claimed: it is announced again, so the
 *   alert comes back for somebody who dismissed it.
 * - An open lead somebody owns: that person gets a push notification.
 * - A suggestion the assistant had not confirmed is confirmed now.
 *
 * Every case notes the request on the lead's timeline. Never throws —
 * the handover itself must not fail because of a lead.
 */

import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'

const CLOSED = 'closed'
const POOL_STATUSES = ['new', 'follow_up']

const CHANNEL_NAMES: Record<string, string> = {
  website: 'website chat',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Messenger',
}

export async function leadForHandoff(args: {
  accountId: string
  /** Owner of a new lead row (the widget's / channel's owner). */
  userId: string
  contactId: string
  /** leads.source — the channel the request came from. */
  source: string
  /** The chat the request came from — the push opens the Inbox for it. */
  conversationId?: string
}): Promise<{ leadId: string; created: boolean } | null> {
  const channel = CHANNEL_NAMES[args.source] ?? args.source
  try {
    const existing = await prisma.lead.findFirst({
      where: { account_id: args.accountId, contact_id: args.contactId, status: { not: CLOSED } },
      orderBy: { created_at: 'desc' },
    })

    if (!existing) {
      const contact = await prisma.contact
        .findFirst({ where: { id: args.contactId, account_id: args.accountId }, select: { name: true } })
        .catch(() => null)
      const lead = await prisma.lead.create({
        data: {
          account_id: args.accountId,
          user_id: args.userId,
          contact_id: args.contactId,
          title: contact?.name || 'Website visitor',
          source: args.source,
          status: 'new',
        },
      })
      await note(args, lead.id, `Asked to talk to a person (${channel}) — lead created`)
      emitToAccount(args.accountId, 'lead', { eventType: 'INSERT', new: lead, old: {} })
      return { leadId: lead.id, created: true }
    }

    let lead = existing
    if (existing.ai_suggested) {
      lead = await prisma.lead.update({ where: { id: existing.id }, data: { ai_suggested: false } })
    }
    await note(args, lead.id, `Asked to talk to a person (${channel})`)

    if (!lead.assigned_to && POOL_STATUSES.includes(lead.status)) {
      // Announced as an arrival: the alert lists unclaimed leads from
      // INSERT events, and the Leads page reloads on one.
      emitToAccount(args.accountId, 'lead', { eventType: 'INSERT', new: lead, old: {} })
    } else {
      emitToAccount(args.accountId, 'lead', { eventType: 'UPDATE', new: lead, old: {} })
      if (lead.assigned_to) {
        // Loaded on demand: web-push is not something every importer of
        // the inbound path should pull in.
        const { sendPushToUser } = await import('@/lib/push')
        void sendPushToUser(lead.assigned_to, {
          title: 'A customer wants to talk to you',
          body: `${lead.title} asked to talk to a person (${channel})`,
          tag: `handoff-${lead.id}`,
          // The service worker opens the Inbox for this type.
          data: { type: 'assignment', conversationId: args.conversationId ?? null, leadId: lead.id },
        }).catch(() => {})
      }
    }
    return { leadId: lead.id, created: false }
  } catch (err) {
    console.error('[leads] handoff lead failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function note(args: { accountId: string; contactId: string }, leadId: string, title: string) {
  await prisma.leadActivity
    .create({
      data: {
        account_id: args.accountId,
        lead_id: leadId,
        contact_id: args.contactId,
        type: 'note',
        title,
        description: 'The customer pressed "Talk to a person".',
      },
    })
    .catch((err) => console.error('[leads] handoff note failed:', err instanceof Error ? err.message : err))
}
