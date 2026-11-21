/**
 * Important alerts to the team on Telegram, as well as WhatsApp.
 *
 * Telegram has no 24-hour window and no per-message charge, so an alert
 * always arrives as plain text — WhatsApp outside its window needs an
 * approved, paid template, and without one the alert is simply not sent.
 *
 * Who hears it: owners and admins who linked Admin Chat on Telegram
 * (Settings → Admin Chat), are active, inside their access dates, and
 * switched alerts on. Never throws: an alert must not break the handover
 * it reports.
 */
import { prisma } from '@/lib/db'

export async function sendTelegramStaffAlert(accountId: string, text: string, now: Date = new Date()): Promise<number> {
  try {
    const settings = await prisma.adminChatSettings.findUnique({ where: { account_id: accountId }, select: { enabled: true } })
    if (!settings?.enabled) return 0
    const today = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z')
    const members = await prisma.adminChatMember.findMany({
      where: {
        account_id: accountId,
        channel: 'telegram',
        status: 'active',
        alerts_enabled: true,
        telegram_id: { not: null },
        valid_from: { lte: today },
        valid_until: { gte: today },
      },
      select: { telegram_id: true },
    })
    if (members.length === 0) return 0
    const { botForAccount } = await import('@/lib/telegram/store')
    const bot = await botForAccount(accountId)
    if (!bot) return 0
    const { tgCall } = await import('@/lib/telegram/api')
    const { toTelegramHtml } = await import('@/lib/telegram/format')
    let sent = 0
    for (const m of members) {
      try {
        await tgCall(bot.token, 'sendMessage', { chat_id: m.telegram_id, text: toTelegramHtml(text), parse_mode: 'HTML', protect_content: true })
        sent++
      } catch (err) {
        console.error('[staff-telegram] send failed:', err instanceof Error ? err.message : err)
      }
    }
    return sent
  } catch (err) {
    console.error('[staff-telegram] failed:', err instanceof Error ? err.message : err)
    return 0
  }
}
