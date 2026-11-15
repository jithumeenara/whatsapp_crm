/**
 * Scheduled reports — run every 5 minutes from server.ts (phase F1).
 *
 * For each schedule that is due (business time zone, its hour, up to three
 * hours late), the send is claimed first with a conditional update on
 * last_sent_key, so two server processes never both send ("twice is once").
 * Then the report is built for the whole team and sent to each recipient
 * who still may see it (supervisors and above; owners and admins for money):
 *
 * - on their Admin Chat (WhatsApp or Telegram), through sendToAdmin: a
 *   plain message inside WhatsApp's 24-hour window, else the approved
 *   utility template with one line (Meta has charged utility templates even
 *   in-window since 1 Oct 2026, so the free plain message is tried first);
 * - by email to their login address, with the PDF attached.
 *
 * Kept free of next/server and the rate limiter: server.ts loads this.
 */

import { prisma } from '@/lib/db'
import { businessTimezone } from '@/lib/ai/human-date'
import { localNow, windowCheck } from '@/lib/admin-chat/rules'
import { hasMinRole, type AccountRole } from '@/lib/auth/roles'
import { resolveQuery } from '../doc/period-query'
import { findReport } from '../doc/registry'
import type { ReportDoc } from '../doc/types'
import { dueKey, oneLine, periodFor, recipientMayGet, summaryText } from './rules'

let running = false
const MAX_PER_SWEEP = 200

type Row = Awaited<ReturnType<typeof prisma.scheduledReport.findMany>>[number]

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
}

export async function sweepScheduledReports(now: Date = new Date()): Promise<{ sent: number }> {
  if (running) return { sent: 0 }
  running = true
  try {
    const rows = await prisma.scheduledReport.findMany({ where: { enabled: true }, take: MAX_PER_SWEEP, orderBy: { created_at: 'asc' } })
    const zones = new Map<string, string>()
    let sent = 0
    for (const row of rows) {
      let tz = zones.get(row.account_id)
      if (!tz) { tz = await businessTimezone(row.account_id).catch(() => 'Asia/Kolkata'); zones.set(row.account_id, tz) }
      const key = dueKey(row, localNow(tz, now))
      if (!key) continue
      const claimed = await prisma.scheduledReport.updateMany({
        where: { id: row.id, enabled: true, OR: [{ last_sent_key: null }, { last_sent_key: { not: key } }] },
        data: { last_sent_key: key, last_sent_at: now },
      })
      if (claimed.count === 0) continue
      const result = await sendScheduledReport(row, now, tz).catch((err) => {
        console.error('[scheduled-reports] send failed:', row.id, err instanceof Error ? err.message : err)
        return 'Could not send this time; it will try again at the next due time.'
      })
      await prisma.scheduledReport.update({ where: { id: row.id }, data: { last_result: result.slice(0, 500) } }).catch(() => {})
      sent += 1
    }
    return { sent }
  } finally {
    running = false
  }
}

/** Builds and sends one schedule now. Returns a short result for the screen. */
export async function sendScheduledReport(row: Row, now: Date, tz: string): Promise<string> {
  const def = findReport(row.report_key)
  if (!def) return 'This report no longer exists.'
  const people = await prisma.profile.findMany({
    where: { account_id: row.account_id, user_id: { in: row.recipient_ids } },
    select: { user_id: true, account_role: true, user: { select: { email: true } } },
  })
  const allowed = people.filter((p) => recipientMayGet(row.report_key, p.account_role as AccountRole))
  if (!allowed.length) return 'Nobody on the list may see this report any more.'

  const q = resolveQuery({ period: periodFor(row.frequency), compare: 'previous' }, now, tz)
  if (!q) return 'Could not work out the period.'
  // Money cards only when every recipient may see money.
  const canSeeMoney = allowed.every((p) => hasMinRole(p.account_role as AccountRole, 'admin'))
  const doc = await def.build({ accountId: row.account_id, userId: null, role: 'owner', tz, now, q, subject: null }, { canSeeMoney })
  const link = `${appBase()}${def.path}?period=${q.kind}&compare=previous`

  const outcome = { chat: 0, email: 0, skipped: 0 }
  if (row.by_chat) await sendByChat(row, allowed.map((p) => p.user_id), doc, link, now, tz, outcome)
  if (row.by_email) await sendByEmail(row, allowed.map((p) => p.user?.email).filter((e): e is string => !!e), doc, link, now, outcome)
  const parts = [
    outcome.chat ? `${outcome.chat} by WhatsApp/Telegram` : null,
    outcome.email ? `${outcome.email} by email` : null,
    outcome.skipped ? `${outcome.skipped} skipped (no Admin Chat, outside their hours, or no template)` : null,
  ].filter(Boolean)
  return parts.length ? `Sent: ${parts.join(', ')}.` : 'Nothing was sent: check Admin Chat and email settings.'
}

async function sendByChat(row: Row, userIds: string[], doc: ReportDoc, link: string, now: Date, tz: string, out: { chat: number; skipped: number }) {
  const [settings, members] = await Promise.all([
    prisma.adminChatSettings.findUnique({ where: { account_id: row.account_id } }),
    prisma.adminChatMember.findMany({ where: { account_id: row.account_id, user_id: { in: userIds }, status: 'active', verified_at: { not: null } } }),
  ])
  if (!settings) { out.skipped += userIds.length; return }
  const { sendToAdmin } = await import('@/lib/admin-chat/brief-sweep')
  const local = localNow(tz, now)
  const text = summaryText(doc, link)
  const line = oneLine(doc)
  const reached = new Set<string>()
  for (const m of members) {
    if (!windowCheck(m, local).ok) continue
    try {
      const how = await sendToAdmin(m, settings, text, line, now)
      if (how === 'text' || how === 'template') { out.chat += 1; reached.add(m.user_id) }
    } catch (err) {
      console.error('[scheduled-reports] chat send failed:', err instanceof Error ? err.message : err)
    }
  }
  out.skipped += userIds.filter((u) => !reached.has(u)).length
}

async function sendByEmail(row: Row, emails: string[], doc: ReportDoc, link: string, now: Date, out: { email: number; skipped: number }) {
  if (!emails.length) return
  const [{ sendEmail }, { loadDocBusiness }, { docToPdf }, { tryAcquirePdfSlot }] = await Promise.all([
    import('@/lib/messaging/channels/email'),
    import('../doc/business'),
    import('../doc/pdf'),
    import('../pdf/build-slots'),
  ])
  let pdf: Buffer | null = null
  const release = tryAcquirePdfSlot()
  if (release) {
    try {
      const { business, language } = await loadDocBusiness(row.account_id)
      pdf = await docToPdf({ doc, business, language, generatedAt: now })
    } catch (err) {
      console.error('[scheduled-reports] pdf failed:', err instanceof Error ? err.message : err)
    } finally {
      release()
    }
  }
  const text = `${summaryText(doc, link).replace(/\*/g, '')}\n\n${pdf ? 'The full report is attached as a PDF.' : ''}`
  for (const to of emails) {
    try {
      await sendEmail({
        accountId: row.account_id,
        to,
        subject: `${doc.title}: ${doc.period.firstDay === doc.period.lastDay ? doc.period.firstDay : `${doc.period.firstDay} to ${doc.period.lastDay}`}`,
        text,
        attachments: pdf ? [{ name: `${doc.key}-report-${doc.period.firstDay}.pdf`, mime: 'application/pdf', bytes: pdf }] : [],
      })
      out.email += 1
    } catch (err) {
      out.skipped += 1
      console.error('[scheduled-reports] email failed:', err instanceof Error ? err.message : err)
    }
  }
}
