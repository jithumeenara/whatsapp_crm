/**
 * The assistant steps in when a team member has not.
 *
 * When a customer answers a person on the team, the assistant holds back
 * (auto-reply.ts, 'skipped_staff_waiting') — the answer is that person's.
 * But a person who asked and then went to lunch must not leave the
 * customer waiting all afternoon. So once a customer's message has gone an
 * hour with nobody replying, the assistant answers it, with the team
 * member's messages marked in its history (history.ts) so it carries on
 * their conversation rather than starting another.
 *
 * Runs every minute from server.ts. Each waiting message is tried once;
 * a message older than six hours is left alone — by then a reply from a
 * machine reads as an afterthought, and the server was most likely down.
 */

import { prisma } from '@/lib/db'
import { autoReplyToMessage, staffAwaitingReply, STAFF_WAIT_MS } from './auto-reply'
import { websiteAiLimitReached, widgetLimitForConversation } from '@/lib/webchat/ai-allowance'
import { pushVisitorStatus, pushVisitorTyping } from '@/lib/webchat/realtime'

const GIVE_UP_AFTER_MS = 6 * 60 * 60 * 1000

/** Customer message ids already handed to the assistant by this process. */
const attempted = new Set<string>()
const ATTEMPTED_MAX = 5000

function remember(id: string) {
  attempted.add(id)
  if (attempted.size > ATTEMPTED_MAX) {
    const oldest = attempted.values().next().value
    if (oldest !== undefined) attempted.delete(oldest)
  }
}

let running = false

export async function sweepStaffWaits(now: Date = new Date()): Promise<number> {
  if (running) return 0
  running = true
  try {
    const accounts = await prisma.aiConfig.findMany({
      where: { ai_auto_reply_enabled: true, ai_auto_reply_pause_on_agent: true },
      select: { account_id: true },
    })
    if (accounts.length === 0) return 0

    const newest = new Date(now.getTime() - STAFF_WAIT_MS)
    const oldest = new Date(now.getTime() - GIVE_UP_AFTER_MS)
    // WhatsApp and the website chat. The website used to be left out, so a
    // visitor answered once by a colleague who then went quiet was never
    // answered again by anyone. Telegram the same way.
    const conversations = await prisma.conversation.findMany({
      where: {
        account_id: { in: accounts.map((a) => a.account_id) },
        channel: { in: ['whatsapp', 'website', 'telegram'] },
        last_message_at: { gte: oldest, lte: newest },
      },
      select: { id: true, account_id: true, user_id: true, contact_id: true, channel: true },
      take: 200,
    })

    let answered = 0
    for (const c of conversations) {
      // The last thing in the thread (notes aside) must still be the
      // customer, an hour old or more — a reply from anyone since means
      // there is nothing to step in for.
      const last = await prisma.message.findFirst({
        where: { conversation_id: c.id, sender_type: { not: 'system' } },
        orderBy: { created_at: 'desc' },
        select: { id: true, sender_type: true, created_at: true, content_text: true, transcript: true, message_id: true },
      })
      if (!last || last.sender_type !== 'customer') continue
      if (last.created_at > newest || last.created_at < oldest) continue
      if (attempted.has(last.id)) continue

      // …and it must be an answer to a person on the team.
      const staff = await staffAwaitingReply(c.id, last.created_at)
      if (!staff) continue

      const text = (last.content_text || last.transcript || '').trim()
      remember(last.id)
      if (!text || !c.contact_id) continue

      const isWebsite = c.channel === 'website'
      const isTelegram = c.channel === 'telegram'
      // The website chat's own daily ceiling applies here as well.
      if (isWebsite) {
        const limit = await widgetLimitForConversation(c.id)
        if (limit === null || (await websiteAiLimitReached(c.account_id, limit, now))) continue
        pushVisitorTyping(c.id, true)
      }

      try {
        const outcome = await autoReplyToMessage({
          accountId: c.account_id,
          userId: c.user_id,
          conversationId: c.id,
          contactId: c.contact_id,
          message: text,
          channel: isWebsite ? 'website' : isTelegram ? 'telegram' : 'whatsapp',
          wasVoice: !isWebsite && !isTelegram && !last.content_text && Boolean(last.transcript),
          providerMessageId: isWebsite || isTelegram ? undefined : last.message_id ?? undefined,
          afterStaffWait: true,
        })
        if (outcome === 'replied' || outcome === 'handed_off') answered++
        if (isWebsite && outcome === 'handed_off') pushVisitorStatus(c.id, { status: 'pending', with_team: true })
      } catch (err) {
        console.error('[staff-wait] assistant reply failed:', err instanceof Error ? err.message : err)
      } finally {
        if (isWebsite) pushVisitorTyping(c.id, false)
      }
    }
    return answered
  } finally {
    running = false
  }
}
