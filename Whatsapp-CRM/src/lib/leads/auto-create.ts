/**
 * Auto lead creation: a brand-new contact's first message becomes a lead
 * in the New pool, when the account has switched it on (Settings → Leads
 * → Auto lead creation).
 *
 * One function for every channel. It was written inline in the WhatsApp
 * webhook, and a second channel copying it would be a second copy to keep
 * in step — the Website Bot is that second channel.
 *
 * Runs alongside AI lead detection, not instead of it: this rule's job is
 * that nobody is missed; the assistant's is to read the ones it caught
 * and mark the ones that were never an enquiry (src/lib/leads/ai-detect.ts
 * reviews a lead it finds here rather than proposing a second one).
 *
 * Never throws — a lead that could not be created must not cost the
 * customer their reply.
 */

import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'

const CHANNEL_NAMES: Record<string, string> = {
  whatsapp: 'WhatsApp',
  website: 'website chat',
  instagram: 'Instagram',
  facebook: 'Messenger',
}

export async function autoCreateLead(args: {
  accountId: string
  /** Owner of the new lead row (the channel config's / widget's owner). */
  userId: string
  contactId: string
  title: string
  /** leads.source — the channel the customer came from. */
  source: string
}): Promise<void> {
  try {
    const settings = await prisma.leadSettings.findUnique({
      where: { account_id: args.accountId },
      select: { auto_lead_creation: true },
    })
    if (!settings?.auto_lead_creation) return

    const existing = await prisma.lead.findFirst({
      where: { contact_id: args.contactId, account_id: args.accountId },
      select: { id: true },
    })
    if (existing) return

    const lead = await prisma.lead.create({
      data: {
        account_id: args.accountId,
        user_id: args.userId,
        contact_id: args.contactId,
        title: args.title,
        source: args.source,
        status: 'new',
      },
    })
    await prisma.leadActivity.create({
      data: {
        account_id: args.accountId,
        lead_id: lead.id,
        contact_id: args.contactId,
        type: 'created',
        title: 'Lead auto-created',
        description: `Lead created automatically from first ${CHANNEL_NAMES[args.source] ?? args.source} message`,
      },
    })

    // Tell whoever is looking. Without this the lead appears in the pool
    // silently and is found only by somebody who happens to refresh the
    // Leads page.
    emitToAccount(args.accountId, 'lead', { eventType: 'INSERT', new: lead, old: {} })
  } catch (err) {
    console.error('[leads] auto lead creation failed:', err instanceof Error ? err.message : err)
  }
}
