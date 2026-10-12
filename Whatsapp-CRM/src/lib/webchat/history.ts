import { prisma } from '@/lib/db'
import { toVisitorMessage, type VisitorMessage } from './public-message'
import type { AuthenticatedSession } from './session'

/** How much of the conversation the window shows on opening. */
const HISTORY_LIMIT = 100

/**
 * The visitor's own conversation, as they may see it, oldest first.
 *
 * Read through the session's conversation id only — never one supplied
 * by the request — and filtered by the account as well, so a session row
 * pointing anywhere unexpected returns nothing rather than somebody
 * else's thread.
 */
export async function visitorHistory(
  session: AuthenticatedSession,
  after?: Date | null,
): Promise<{ messages: VisitorMessage[]; status: string | null; with_team: boolean }> {
  if (!session.conversation_id) return { messages: [], status: null, with_team: false }
  const conversation = await prisma.conversation.findFirst({
    where: { id: session.conversation_id, account_id: session.account_id, channel: 'website' },
    select: { id: true, status: true, assigned_agent_id: true },
  })
  if (!conversation) return { messages: [], status: null, with_team: false }

  const rows = await prisma.message.findMany({
    where: {
      conversation_id: conversation.id,
      sender_type: { in: ['customer', 'agent', 'bot'] },
      deleted_at: null,
      ...(after ? { created_at: { gt: after } } : {}),
    },
    orderBy: { created_at: 'desc' },
    take: HISTORY_LIMIT,
  })
  const messages = rows
    .reverse()
    .map(toVisitorMessage)
    .filter((m): m is VisitorMessage => m !== null)
  return {
    messages,
    status: conversation.status,
    with_team: conversation.status === 'pending' || Boolean(conversation.assigned_agent_id),
  }
}
