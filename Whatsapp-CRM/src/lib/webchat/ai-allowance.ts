/**
 * The website chat's daily assistant ceiling (web_chat_widgets.daily_ai_limit),
 * counted across the account's website chats — where a flood would land.
 * Shared by a visitor's live message (inbound.ts) and the assistant
 * stepping in after a quiet team member (staff-wait-sweep.ts), so neither
 * path can spend past it.
 */

import { prisma } from '@/lib/db'
import { AI_AUTO_REPLY_SOURCE } from '@/lib/ai/auto-reply'

const DAY_MS = 24 * 60 * 60 * 1000

export async function websiteAiLimitReached(accountId: string, dailyLimit: number, now: Date = new Date()): Promise<boolean> {
  const repliesToday = await prisma.message.count({
    where: {
      bot_source: AI_AUTO_REPLY_SOURCE,
      created_at: { gte: new Date(now.getTime() - DAY_MS) },
      conversation: { account_id: accountId, channel: 'website' },
    },
  })
  return repliesToday >= dailyLimit
}

/** The limit of the widget a website conversation came from; null when
 *  the chat cannot be traced to a widget (then nothing is sent). */
export async function widgetLimitForConversation(conversationId: string): Promise<number | null> {
  const session = await prisma.webChatSession.findFirst({
    where: { conversation_id: conversationId },
    orderBy: { created_at: 'desc' },
    select: { widget_id: true },
  })
  if (!session) return null
  const widget = await prisma.webChatWidget.findFirst({
    where: { id: session.widget_id, enabled: true },
    select: { daily_ai_limit: true },
  })
  return widget?.daily_ai_limit ?? null
}
