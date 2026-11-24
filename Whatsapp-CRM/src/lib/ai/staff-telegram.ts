/**
 * Important alerts to the team on Telegram, as well as WhatsApp.
 *
 * Telegram has no 24-hour window and no per-message charge, so an alert
 * always arrives as plain text — WhatsApp outside its window needs an
 * approved, paid template, and without one the alert is simply not sent.
 *
 * Who hears it, and what (the same rules Admin Chat itself applies, so a
 * Telegram link never shows more than Admin Chat would):
 *  - owners and admins who linked Admin Chat on Telegram, verified, active,
 *    with alerts on — and STILL owner/admin of this account (a removed or
 *    demoted member's old link no longer receives anything);
 *  - only inside the member's allowed days and hours;
 *  - scope 'reports' ("no personal details"): told a customer needs a
 *    person, without name, number or message; scope 'lookup': the number
 *    masked; scope 'actions': the full alert.
 * Never throws: an alert must not break the handover it reports.
 */
import { prisma } from '@/lib/db'
import { hasMinRole, isAccountRole } from '@/lib/auth/roles'
import { businessTimezone } from '@/lib/ai/human-date'
import { localNow, windowCheck } from '@/lib/admin-chat/rules'

export interface StaffAlert {
  who: string
  phone: string
  quote: string
  reason: string
}

/** "919847012345" → "9198••••2345": enough to recognise, not to call. */
export function maskPhoneForAlert(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length < 6) return '••••'
  return `${d.slice(0, 4)}${'•'.repeat(Math.max(2, d.length - 8))}${d.slice(-4)}`
}

/** The alert text a member of this scope may see. */
export function alertTextFor(scope: string, a: StaffAlert): string {
  if (scope === 'reports') {
    return ['🔔 A customer needs a person.', '', `Reason: ${a.reason}`, '', 'Open the Inbox in the CRM to see who it is.'].join('\n')
  }
  const phone = scope === 'actions' ? a.phone : maskPhoneForAlert(a.phone)
  const who = scope === 'actions' || a.who !== a.phone ? a.who : phone
  return ['🔔 A customer needs a person.', '', `From: ${who}`, `Number: ${phone}`, `Reason: ${a.reason}`, '', `They said: "${a.quote}"`].join('\n')
}

/** Who would get a Telegram alert, for the settings screen. Counts only. */
export interface TelegramAlertReach {
  /** Settings → Admin Chat is switched on. */
  admin_chat_on: boolean
  /** A Telegram bot is connected (Settings → Channels). */
  bot_connected: boolean
  /** Owners/admins linked on Telegram with alerts on. */
  recipients: number
  /** Of those, inside their allowed days and hours right now. */
  reachable_now: number
}

export async function telegramAlertReach(accountId: string, now: Date = new Date()): Promise<TelegramAlertReach> {
  const settings = await prisma.adminChatSettings.findUnique({ where: { account_id: accountId }, select: { enabled: true } })
  const { botForAccount } = await import('@/lib/telegram/store')
  const bot = await botForAccount(accountId).catch(() => null)
  const { all, allowed } = await alertMembers(accountId, now)
  return { admin_chat_on: Boolean(settings?.enabled), bot_connected: Boolean(bot), recipients: all.length, reachable_now: allowed.length }
}

/** Linked, verified, active Telegram members with alerts on who are still
 *  owner/admin here (all), and those inside their window now (allowed). */
async function alertMembers(accountId: string, now: Date) {
  const members = await prisma.adminChatMember.findMany({
    where: {
      account_id: accountId,
      channel: 'telegram',
      status: 'active',
      alerts_enabled: true,
      telegram_id: { not: null },
      verified_at: { not: null },
    },
    select: {
      telegram_id: true, user_id: true, scope: true,
      valid_from: true, valid_until: true, allowed_days: true, start_minute: true, end_minute: true,
    },
  })
  if (members.length === 0) return { all: [], allowed: [] }
  // Still an owner/admin of THIS account — the rule Admin Chat checks on
  // every question (engine.ts stillAdmin). A removed member is moved to a
  // holding account; a demoted one keeps the account but not the role.
  const profiles = await prisma.profile.findMany({
    where: { user_id: { in: [...new Set(members.map((m) => m.user_id))] } },
    select: { user_id: true, account_id: true, account_role: true },
  })
  const admins = new Set(
    profiles
      .filter((p) => p.account_id === accountId && isAccountRole(p.account_role) && hasMinRole(p.account_role, 'admin'))
      .map((p) => p.user_id),
  )
  const all = members.filter((m) => admins.has(m.user_id))
  const local = localNow(await businessTimezone(accountId), now)
  return { all, allowed: all.filter((m) => windowCheck(m, local).ok) }
}

export async function sendTelegramStaffAlert(accountId: string, alert: StaffAlert, now: Date = new Date()): Promise<number> {
  try {
    const settings = await prisma.adminChatSettings.findUnique({ where: { account_id: accountId }, select: { enabled: true } })
    if (!settings?.enabled) return 0
    const { allowed } = await alertMembers(accountId, now)
    if (allowed.length === 0) return 0

    const { botForAccount } = await import('@/lib/telegram/store')
    const bot = await botForAccount(accountId)
    if (!bot) return 0
    const { tgCall } = await import('@/lib/telegram/api')
    const { toTelegramHtml } = await import('@/lib/telegram/format')
    let sent = 0
    for (const m of allowed) {
      try {
        await tgCall(bot.token, 'sendMessage', { chat_id: m.telegram_id, text: toTelegramHtml(alertTextFor(m.scope, alert)), parse_mode: 'HTML', protect_content: true })
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
