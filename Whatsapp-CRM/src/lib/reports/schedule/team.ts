/**
 * The team a schedule may be sent to: this account's members with their
 * role, and whether each can be reached by Admin Chat and by email. Only
 * what the Scheduled screen needs — never the address or number itself.
 */

import { prisma } from '@/lib/db'
import { cleanPersonName } from '@/lib/auth/person-name'

/** What the Scheduled screen gets back for each schedule (no account or creator ids). */
export const SCHEDULE_FIELDS = {
  id: true, report_key: true, frequency: true, day: true, send_hour: true, recipient_ids: true,
  by_chat: true, by_email: true, enabled: true, last_sent_at: true, last_result: true, created_at: true,
} as const

export interface TeamMember { id: string; name: string; role: string; chat: boolean; email: boolean }

export async function loadScheduleTeam(accountId: string): Promise<{ roles: Map<string, string>; members: TeamMember[] }> {
  const [profiles, chat] = await Promise.all([
    prisma.profile.findMany({
      where: { account_id: accountId, account_role: { in: ['owner', 'admin', 'supervisor', 'agent', 'viewer'] } },
      select: { user_id: true, full_name: true, account_role: true, user: { select: { email: true } } },
    }),
    prisma.adminChatMember.findMany({ where: { account_id: accountId, status: 'active', verified_at: { not: null } }, select: { user_id: true } }),
  ])
  const onChat = new Set(chat.map((c) => c.user_id))
  const members = profiles.map((p) => ({
    id: p.user_id,
    name: cleanPersonName(p.full_name) || 'Team member',
    role: p.account_role as string,
    chat: onChat.has(p.user_id),
    email: Boolean(p.user?.email),
  })).sort((a, b) => a.name.localeCompare(b.name))
  return { roles: new Map(members.map((m) => [m.id, m.role])), members }
}
