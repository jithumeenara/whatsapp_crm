import { prisma } from '@/lib/db'

/**
 * Checks that ids arriving in a request body belong to the caller's own
 * account before they are written anywhere.
 *
 * A follow-up could be pointed at a lead, contact or person in a
 * different account just by sending their id. That lead's page, in the
 * other account, would then list this account's follow-up — its title
 * and note — to people who should never see it.
 *
 * Returns the first problem as a message, or null when every given id
 * is this account's. An empty string means "clear it" and is allowed.
 */
export async function checkOwnedRefs(
  accountId: string,
  refs: { contact_id?: unknown; lead_id?: unknown; assigned_to?: unknown },
): Promise<string | null> {
  const given = (v: unknown): v is string => typeof v === 'string' && v !== ''
  const bad = (v: unknown) => v !== undefined && v !== null && v !== '' && typeof v !== 'string'
  if (bad(refs.contact_id) || bad(refs.lead_id) || bad(refs.assigned_to)) return 'Invalid reference'

  const [contact, lead, member] = await Promise.all([
    given(refs.contact_id)
      ? prisma.contact.findFirst({ where: { id: refs.contact_id, account_id: accountId }, select: { id: true } })
      : true,
    given(refs.lead_id)
      ? prisma.lead.findFirst({ where: { id: refs.lead_id, account_id: accountId }, select: { id: true } })
      : true,
    given(refs.assigned_to)
      ? prisma.profile.findFirst({ where: { user_id: refs.assigned_to, account_id: accountId }, select: { user_id: true } })
      : true,
  ]).catch(() => [null, null, null])

  if (!contact) return 'Contact not found'
  if (!lead) return 'Lead not found'
  if (!member) return 'That person is not in this account'
  return null
}

export const FOLLOW_UP_STATUSES = ['pending', 'done', 'skipped'] as const
