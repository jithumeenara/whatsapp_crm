/**
 * Admin Chat briefs and alerts — run every 5 minutes from server.ts.
 *
 * For each admin who has them on: the morning brief at their chosen time
 * (business time zone, once a day, not more than 3 hours late), and an
 * alert when the chats waiting for the team reach the account's line (at
 * most every 3 hours). Only inside their allowed days, hours and dates.
 *
 * "Twice is once": the day / time is claimed with a conditional update
 * before anything is sent, so two server processes never both send.
 *
 * Kept free of next/server (and of the Admin Chat engine, which uses the
 * rate limiter) — this file is loaded by server.ts.
 */

import { prisma } from '@/lib/db'
import { businessTimezone } from '@/lib/ai/human-date'
import { localNow, windowCheck } from './rules'
import {
  alertOneLine,
  alertText,
  briefOneLine,
  composeBrief,
  dueForAlert,
  dueForBrief,
  previousDate,
  withinServiceWindow,
  zonedDayRange,
  type BriefStats,
} from './brief-rules'
import { writeAudit } from './audit'

let running = false

type MemberRow = Awaited<ReturnType<typeof prisma.adminChatMember.findMany>>[number]
type SettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.adminChatSettings.findUnique>>>

export async function gatherBriefStats(accountId: string, date: string, timeZone: string): Promise<BriefStats> {
  const { start, end } = zonedDayRange(date, timeZone)
  const range = { gte: start, lt: end }
  const [byChannel, newLeads, customerMessages, waitingNow, unassignedNow] = await Promise.all([
    prisma.conversation.groupBy({ by: ['channel'], where: { account_id: accountId, created_at: range }, _count: { _all: true } }),
    prisma.lead.count({ where: { account_id: accountId, created_at: range } }),
    prisma.message.count({ where: { sender_type: 'customer', created_at: range, conversation: { account_id: accountId } } }),
    prisma.conversation.count({ where: { account_id: accountId, status: 'pending' } }),
    prisma.conversation.count({ where: { account_id: accountId, status: 'open', assigned_agent_id: null } }),
  ])
  const channels: Record<string, number> = {}
  for (const row of byChannel) channels[row.channel ?? 'whatsapp'] = row._count._all
  return {
    date,
    newChats: Object.values(channels).reduce((a, b) => a + b, 0),
    byChannel: channels,
    newLeads,
    customerMessages,
    waitingNow,
    unassignedNow,
  }
}

async function firstName(userId: string): Promise<string> {
  const p = await prisma.profile.findUnique({ where: { user_id: userId }, select: { full_name: true } })
  return (p?.full_name || 'Admin').split(/\s+/)[0].slice(0, 40)
}

/** Sends to one admin on their own channel. Returns how, or why not. */
export async function sendToAdmin(
  member: MemberRow,
  settings: SettingsRow,
  text: string,
  oneLine: string,
  now: Date,
): Promise<'text' | 'template' | 'skipped_no_template' | 'skipped_no_channel'> {
  if (member.channel === 'telegram') {
    if (!member.telegram_id) return 'skipped_no_channel'
    const { botForAccount } = await import('@/lib/telegram/store')
    const { tgCall } = await import('@/lib/telegram/api')
    const { toTelegramHtml } = await import('@/lib/telegram/format')
    const bot = await botForAccount(member.account_id)
    if (!bot) return 'skipped_no_channel'
    await tgCall(bot.token, 'sendMessage', { chat_id: member.telegram_id, text: toTelegramHtml(text), parse_mode: 'HTML', protect_content: true })
    return 'text'
  }

  if (!member.phone_normalized) return 'skipped_no_channel'
  const { resolveWhatsAppConfig } = await import('@/lib/whatsapp/resolve-config')
  const { decrypt } = await import('@/lib/whatsapp/encryption')
  const { sendTextMessage, sendTemplateMessage } = await import('@/lib/whatsapp/meta-api')
  let config
  try {
    config = await resolveWhatsAppConfig({ accountId: member.account_id })
  } catch {
    return 'skipped_no_channel'
  }
  const accessToken = decrypt(config.access_token)
  if (withinServiceWindow(member.last_inbound_at, now)) {
    await sendTextMessage({ phoneNumberId: config.phone_number_id, accessToken, to: member.phone_normalized, text })
    return 'text'
  }
  // Outside WhatsApp's 24-hour window: only an approved template may go.
  if (!settings.brief_template_name) return 'skipped_no_template'
  const template = await prisma.messageTemplate.findFirst({
    where: {
      account_id: member.account_id,
      name: settings.brief_template_name,
      ...(settings.brief_template_language ? { language: settings.brief_template_language } : {}),
      status: 'APPROVED',
    },
  })
  if (!template) return 'skipped_no_template'
  await sendTemplateMessage({
    phoneNumberId: config.phone_number_id,
    accessToken,
    to: member.phone_normalized,
    templateName: template.name,
    language: template.language ?? 'en_US',
    template: template as unknown as Parameters<typeof sendTemplateMessage>[0]['template'],
    messageParams: { body: [await firstName(member.user_id), oneLine] },
    accountId: member.account_id,
  })
  return 'template'
}

export async function sweepAdminChatBriefs(now: Date = new Date()): Promise<{ briefs: number; alerts: number }> {
  if (running) return { briefs: 0, alerts: 0 }
  running = true
  let briefs = 0
  let alerts = 0
  try {
    const accounts = await prisma.adminChatSettings.findMany({ where: { enabled: true } })
    for (const settings of accounts) {
      const members = await prisma.adminChatMember.findMany({
        where: { account_id: settings.account_id, status: 'active', OR: [{ brief_enabled: true }, { alerts_enabled: true }] },
      })
      if (members.length === 0) continue
      const zone = await businessTimezone(settings.account_id)
      const local = localNow(zone, now)
      let stats: BriefStats | null = null
      let waiting: number | null = null

      for (const member of members) {
        if (!windowCheck(member, local).ok) continue
        try {
          if (dueForBrief(member, local)) {
            // Claim today's brief first — a second process finds nothing to claim.
            const claimed = await prisma.adminChatMember.updateMany({
              where: { id: member.id, OR: [{ last_brief_date: null }, { last_brief_date: { lt: new Date(`${local.date}T00:00:00Z`) } }] },
              data: { last_brief_date: new Date(`${local.date}T00:00:00Z`) },
            })
            if (claimed.count > 0) {
              stats ??= await gatherBriefStats(settings.account_id, previousDate(local.date), zone)
              const how = await sendToAdmin(member, settings, composeBrief(stats, settings.keyword), briefOneLine(stats), now)
              if (how === 'text' || how === 'template') briefs++
              await writeAudit({ accountId: settings.account_id, event: 'brief_sent', memberId: member.id, detail: { how, date: stats.date } })
            }
          }

          if (member.alerts_enabled) {
            waiting ??= await prisma.conversation.count({ where: { account_id: settings.account_id, status: 'pending' } })
            if (dueForAlert(member, waiting, settings.alert_waiting_threshold, now)) {
              const cutoff = new Date(now.getTime() - 3 * 60 * 60_000)
              const claimed = await prisma.adminChatMember.updateMany({
                where: { id: member.id, OR: [{ last_alert_at: null }, { last_alert_at: { lte: cutoff } }] },
                data: { last_alert_at: now },
              })
              if (claimed.count > 0) {
                const how = await sendToAdmin(member, settings, alertText(waiting, settings.keyword), alertOneLine(waiting), now)
                if (how === 'text' || how === 'template') alerts++
                await writeAudit({ accountId: settings.account_id, event: 'alert_sent', memberId: member.id, detail: { how, waiting } })
              }
            }
          }
        } catch (err) {
          console.error('[admin-chat] brief/alert failed for a member:', err instanceof Error ? err.message : err)
        }
      }
    }
  } finally {
    running = false
  }
  return { briefs, alerts }
}
