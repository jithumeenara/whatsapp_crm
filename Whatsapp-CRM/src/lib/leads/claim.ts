import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'

/**
 * Makes an unclaimed lead this person's, because they just worked it.
 *
 * Marking a call-back done, moving it, or recording that nobody answered
 * is handling the customer. Leaving the lead in New Pool afterwards
 * meant a colleague could pick up somebody already being dealt with,
 * and the call counted for nobody. So acting on it claims it — the same
 * as pressing Pick, with the same consequences:
 *
 *  - the lead is assigned to them, and stamped as claimed now;
 *  - the customer's unassigned conversation comes with it;
 *  - the lead's unassigned call-backs become theirs, so the alert for
 *    them reaches the right person;
 *  - the timeline says it happened and why.
 *
 * Only ever an unclaimed lead. The update is conditional on
 * assigned_to still being empty, so two people acting at once cannot
 * both end up owning it, and a lead that is already somebody's is never
 * taken. Returns whether this call did the claiming.
 */
export async function claimIfUnassigned(args: {
  accountId: string
  leadId: string
  userId: string
  /** Shown on the timeline, e.g. "by marking a follow-up done". */
  how: string
}): Promise<boolean> {
  const { accountId, leadId, userId, how } = args
  const { count } = await prisma.lead.updateMany({
    where: { id: leadId, account_id: accountId, assigned_to: null },
    data: { assigned_to: userId, claimed_at: new Date() },
  })
  if (count === 0) return false

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, account_id: accountId },
    select: { id: true, title: true, status: true, contact_id: true },
  })

  await Promise.all([
    lead?.contact_id
      ? prisma.conversation
          .updateMany({
            where: { account_id: accountId, contact_id: lead.contact_id, assigned_agent_id: null },
            data: { assigned_agent_id: userId },
          })
          .then(({ count: moved }) => {
            if (moved > 0) {
              emitToAccount(accountId, 'conversation', {
                eventType: 'UPDATE',
                new: { contact_id: lead.contact_id, assigned_agent_id: userId },
                old: {},
              })
            }
          })
      : Promise.resolve(),
    prisma.followUp.updateMany({
      where: { account_id: accountId, lead_id: leadId, status: 'pending', assigned_to: null },
      data: { assigned_to: userId },
    }),
    prisma.leadActivity.create({
      data: {
        account_id: accountId,
        lead_id: leadId,
        contact_id: lead?.contact_id ?? null,
        user_id: userId,
        type: 'stage_change',
        title: 'Lead claimed',
        description: `Picked up ${how}`,
      },
    }),
  ]).catch((err) =>
    console.error('[leads] claimed, but a follow-on step failed:', err instanceof Error ? err.message : err),
  )

  emitToAccount(accountId, 'lead', {
    eventType: 'UPDATE',
    new: { id: leadId, title: lead?.title, status: lead?.status, assigned_to: userId },
    old: { id: leadId, assigned_to: null },
  })
  return true
}
