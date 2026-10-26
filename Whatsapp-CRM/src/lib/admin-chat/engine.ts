/**
 * Admin Chat — what happens when a message arrives on WhatsApp or Telegram.
 *
 * Called first, before contacts, chatbots or the customer assistant.
 * Returns true when the message was Admin Chat's (it is then answered here
 * and nowhere else — no contact, lead or conversation is made); false hands
 * it on to the normal customer flow untouched. Anything that is not an
 * enrolled, active admin is handed on, so a stranger who sends the keyword
 * learns nothing.
 *
 * Steps for an enrolled admin:
 *   keyword → (inside allowed days/hours/dates, not locked, MFA on)
 *           → "send your authenticator code" (3 minutes)
 *   code    → their own login TOTP; each code once; 5 wrong → 15-min lock
 *           → session open: questions answered by the read-only tools
 *   STOP / 15 min idle / 60 min in all / end of the allowed hours → closed
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/whatsapp/encryption'
import { matchTotpStep } from '@/lib/auth/totp'
import { hasMinRole, isAccountRole } from '@/lib/auth/roles'
import { phonesMatch } from '@/lib/whatsapp/phone-utils'
import { checkRateLimit } from '@/lib/rate-limit'
import { businessTimezone } from '@/lib/ai/human-date'
import { answerAdminQuestion, AdminAnswerError, PERSONAL_DATA_TOOLS } from '@/lib/ai/insights/answer'
import { TOOL_NAMES } from '@/lib/ai/insights/tools'
import {
  CODE_MINUTES,
  MAX_FAILURES,
  describeWindow,
  hashCode,
  isKeyword,
  isStop,
  localNow,
  lockAfterFailure,
  maskSensitive,
  parseVerifyCode,
  sessionExpiry,
  windowCheck,
} from './rules'
import { writeAudit } from './audit'
import { notifyAdmins } from './notify'
import { MAX_SPOKEN_CHARS, speakForAdmin, transcribeForAdmin } from './voice'
import { parseActionReply } from './action-rules'
import { confirmFromChat, rejectFromChat, undoFromChat } from './actions'
import { actionToolsFor } from './action-tools'

export type AdminChannel = 'whatsapp' | 'telegram'

export interface AdminChatInbound {
  accountId: string
  channel: AdminChannel
  /** WhatsApp: the sender's number (digits). Telegram: the sender's user id. */
  senderKey: string
  text: string
  /** The platform's message id — a re-delivered webhook is answered once. */
  messageKey: string
  reply: (text: string) => Promise<void>
  /** Telegram: delete the message the admin typed their code in. */
  forgetCodeMessage?: () => Promise<void>
  /** A voice note: loads its bytes only when it turns out to be a question
   *  in an open session (a customer's voice note is never downloaded here). */
  audio?: () => Promise<{ buffer: Buffer; mimeType: string }>
  /** Sends an MP3 back as a voice/audio message on the same channel. */
  replyVoice?: (mp3: Buffer) => Promise<void>
}

const MAX_REPLY = 3500
const HISTORY_TURNS = 6
const CHANNEL_NAME: Record<AdminChannel, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram' }

const WINDOW_TEXT: Record<string, string> = {
  not_started: 'Your Admin Chat access has not started yet.',
  expired: 'Your Admin Chat access has ended. Ask the owner to extend it in the CRM.',
  day: 'Admin Chat is not open today.',
  hours: 'Admin Chat is not open at this hour.',
}

type Member = Awaited<ReturnType<typeof findMember>>

async function findMember(accountId: string, channel: AdminChannel, senderKey: string) {
  if (channel === 'telegram') {
    return prisma.adminChatMember.findFirst({ where: { account_id: accountId, channel, status: 'active', telegram_id: senderKey } })
  }
  const digits = senderKey.replace(/\D/g, '')
  if (digits.length < 8) return null
  const rows = await prisma.adminChatMember.findMany({
    where: { account_id: accountId, channel, status: 'active', phone_normalized: { endsWith: digits.slice(-8) } },
  })
  return rows.find((r) => r.phone_normalized && phonesMatch(r.phone_normalized, digits)) ?? null
}

/** A webhook delivered twice is answered once. False when already handled. */
async function claim(accountId: string, messageKey: string): Promise<boolean> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO admin_chat_seen (account_id, message_key) VALUES (${accountId}::uuid, ${messageKey})
    ON CONFLICT DO NOTHING`
  return inserted > 0
}

/** Still an owner/admin of this account (a removed member is moved out). */
async function stillAdmin(accountId: string, userId: string): Promise<{ ok: boolean; name: string; totpSecret: string | null }> {
  const [profile, user] = await Promise.all([
    prisma.profile.findUnique({ where: { user_id: userId }, select: { account_id: true, account_role: true, full_name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { mfa_method: true, totp_secret: true, email: true } }),
  ])
  const ok = Boolean(profile && profile.account_id === accountId && isAccountRole(profile.account_role) && hasMinRole(profile.account_role, 'admin'))
  return {
    ok,
    name: profile?.full_name || user?.email || 'An admin',
    totpSecret: user?.mfa_method === 'totp' && user.totp_secret ? user.totp_secret : null,
  }
}

async function endSession(sessionId: string, reason: string) {
  await prisma.adminChatSession.updateMany({
    where: { id: sessionId, state: { not: 'ended' } },
    data: { state: 'ended', ended_at: new Date(), end_reason: reason, history: [] },
  })
}

export async function handleAdminChatInbound(m: AdminChatInbound): Promise<boolean> {
  const text = (m.text ?? '').trim()
  if ((!text && !m.audio) || text.length > 2000) return false
  const settings = await prisma.adminChatSettings.findUnique({ where: { account_id: m.accountId } })
  if (!settings?.enabled) return false

  // ── Enrolment: the one-time code shown on the web, sent from the phone /
  //    Telegram account being added.
  const verifyCode = text ? parseVerifyCode(text) : null
  if (verifyCode) return handleVerify(m, verifyCode)

  const member = await findMember(m.accountId, m.channel, m.senderKey)
  if (!member) return false
  // Their last message to the business: WhatsApp lets briefs and alerts go
  // as plain text for 24 hours after it (brief-sweep.ts).
  void prisma.adminChatMember.update({ where: { id: member.id }, data: { last_inbound_at: new Date() } }).catch(() => {})

  // Each admin can stop their own briefs or alerts at any time.
  const optOut = text.trim().toUpperCase().replace(/\s+/g, ' ')
  if (optOut === 'BRIEF OFF' || optOut === 'ALERTS OFF') {
    if (!(await claim(m.accountId, m.messageKey))) return true
    const briefs = optOut === 'BRIEF OFF'
    await prisma.adminChatMember.update({ where: { id: member.id }, data: briefs ? { brief_enabled: false } : { alerts_enabled: false } })
    void writeAudit({ accountId: m.accountId, event: briefs ? 'brief_off' : 'alerts_off', memberId: member.id })
    await m.reply(briefs ? '🔕 Daily briefs stopped. The owner can switch them on again in the CRM.' : '🔕 Alerts stopped. The owner can switch them on again in the CRM.')
    return true
  }

  const now = new Date()
  let session = await prisma.adminChatSession.findFirst({
    where: { account_id: m.accountId, member_id: member.id, state: { not: 'ended' } },
    orderBy: { created_at: 'desc' },
  })
  let endedNotice: string | null = null
  if (session) {
    const expired = sessionExpiry(session, settings, now)
    if (expired) {
      await endSession(session.id, expired)
      void writeAudit({ accountId: m.accountId, event: 'session_ended', memberId: member.id, sessionId: session.id, detail: { reason: expired } })
      endedNotice =
        expired === 'code_timeout'
          ? 'The code request timed out.'
          : expired === 'idle'
            ? `Your Admin Chat session ended after ${settings.idle_minutes} minutes without a message.`
            : `Your Admin Chat session reached its ${settings.max_minutes}-minute limit and ended.`
      session = null
    }
  }

  if (!session) {
    // A voice note outside a session is an ordinary message.
    if (!text) return false
    if (!isKeyword(text, settings.keyword)) {
      if (!endedNotice) return false // just a message; the normal flow takes it
      if (!(await claim(m.accountId, m.messageKey))) return true
      await m.reply(`🔒 ${endedNotice} Send *${settings.keyword}* to start again.`)
      return true
    }
    if (!(await claim(m.accountId, m.messageKey))) return true
    return startSession(m, member, settings.keyword)
  }

  if (!(await claim(m.accountId, m.messageKey))) return true

  // A voice note in a session: heard first, then handled like typing.
  let question = text
  let viaVoice = false
  if (!text && m.audio) {
    if (session.state === 'awaiting_code') {
      await m.reply('Type the 6-digit code from your authenticator app — codes are not taken by voice.')
      return true
    }
    const audio = await m.audio().catch((err) => {
      console.error('[admin-chat] voice download failed:', err instanceof Error ? err.message : err)
      return null
    })
    const heard = audio ? await transcribeForAdmin(m.accountId, audio) : null
    if (!heard) {
      await m.reply('🎙️ Could not make out that voice note — please type the question.')
      return true
    }
    question = heard
    viaVoice = true
  }

  if (isStop(question)) {
    await endSession(session.id, 'stop')
    void writeAudit({ accountId: m.accountId, event: 'session_ended', memberId: member.id, sessionId: session.id, detail: { reason: 'stop' } })
    await m.reply('🔒 Admin Chat closed.')
    return true
  }

  if (session.state === 'awaiting_code') return checkCode(m, member, session.id)

  // YES <code> / NO / UNDO for an action — only for admins allowed actions,
  // and only typed (a code is never taken by voice).
  const actionReply = member.scope === 'actions' && !viaVoice ? parseActionReply(question) : null
  if (actionReply) {
    const zone = await businessTimezone(m.accountId)
    const window = windowCheck(member, localNow(zone, new Date()))
    const who = await stillAdmin(m.accountId, member.user_id)
    if (!window.ok || !who.ok) {
      await endSession(session.id, window.ok ? 'not_admin' : 'window')
      await m.reply('🔒 Session closed — nothing was changed.')
      return true
    }
    const ctx = { accountId: m.accountId, memberId: member.id, userId: member.user_id, sessionId: session.id }
    const text =
      actionReply.kind === 'yes' ? await confirmFromChat(ctx, actionReply.code) : actionReply.kind === 'no' ? await rejectFromChat(ctx) : await undoFromChat(ctx)
    await prisma.adminChatSession.update({ where: { id: session.id }, data: { last_activity_at: new Date() } })
    await m.reply(text)
    return true
  }
  return answer(m, member, session, question, viaVoice)
}

async function handleVerify(m: AdminChatInbound, code: string): Promise<boolean> {
  // Guessing codes is slow: 5 tries per sender per 15 minutes.
  const limit = checkRateLimit(`admin-chat-verify:${m.accountId}:${m.senderKey}`, { limit: 5, windowMs: 15 * 60_000 })
  if (!limit.success) return false
  // And across all senders: many Telegram accounts each guessing five
  // times would otherwise multiply the guesses at a pending code.
  const accountLimit = checkRateLimit(`admin-chat-verify-account:${m.accountId}`, { limit: 30, windowMs: 15 * 60_000 })
  if (!accountLimit.success) return false
  const pending = await prisma.adminChatMember.findMany({
    where: {
      account_id: m.accountId,
      channel: m.channel,
      status: 'pending',
      verify_code_hash: hashCode(code),
      verify_expires_at: { gt: new Date() },
    },
  })
  const target =
    m.channel === 'whatsapp'
      ? pending.find((p) => p.phone_normalized && phonesMatch(p.phone_normalized, m.senderKey.replace(/\D/g, '')))
      : pending[0]
  // A wrong code, or the right code from the wrong number: handed on, nothing said.
  if (!target) return false
  if (!(await claim(m.accountId, m.messageKey))) return true

  const done = await prisma.adminChatMember.updateMany({
    where: { id: target.id, status: 'pending' },
    data: {
      status: 'active',
      verified_at: new Date(),
      last_inbound_at: new Date(),
      verify_code_hash: null,
      verify_expires_at: null,
      ...(m.channel === 'telegram' ? { telegram_id: m.senderKey } : {}),
    },
  })
  if (done.count === 0) return true
  const keyword = (await prisma.adminChatSettings.findUnique({ where: { account_id: m.accountId }, select: { keyword: true } }))?.keyword ?? 'ADMIN'
  void writeAudit({ accountId: m.accountId, event: 'member_verified', memberId: target.id, detail: { channel: m.channel } })
  const who = await stillAdmin(m.accountId, target.user_id)
  void notifyAdmins({
    accountId: m.accountId,
    exceptUserId: null,
    title: 'Admin Chat: number verified',
    body: `${who.name} can now use Admin Chat on ${CHANNEL_NAME[m.channel]}.`,
  })
  await m.reply(`✅ Verified. To ask about the business, send *${keyword}* — then the 6-digit code from your authenticator app.`)
  return true
}

async function startSession(m: AdminChatInbound, member: NonNullable<Member>, keyword: string): Promise<boolean> {
  const now = new Date()
  if (member.locked_until && member.locked_until > now) {
    await m.reply('🔒 Too many wrong codes. Admin Chat is locked for a few minutes — try again later.')
    return true
  }
  const zone = await businessTimezone(m.accountId)
  const window = windowCheck(member, localNow(zone, now))
  if (!window.ok) {
    void writeAudit({ accountId: m.accountId, event: 'refused', memberId: member.id, detail: { reason: window.reason } })
    await m.reply(`🔒 ${WINDOW_TEXT[window.reason]}\nAllowed: ${describeWindow(member)} (${zone}).`)
    return true
  }
  const who = await stillAdmin(m.accountId, member.user_id)
  if (!who.ok) {
    void writeAudit({ accountId: m.accountId, event: 'refused', memberId: member.id, detail: { reason: 'not_admin' } })
    await m.reply('🔒 Admin Chat needs an owner or admin login in the CRM.')
    return true
  }
  if (!who.totpSecret) {
    await m.reply('🔒 Turn on the authenticator app for your CRM login first (Profile → Security), then send ' + keyword + ' again.')
    return true
  }
  const session = await prisma.adminChatSession.create({
    data: {
      account_id: m.accountId,
      member_id: member.id,
      channel: m.channel,
      state: 'awaiting_code',
      code_expires_at: new Date(now.getTime() + CODE_MINUTES * 60_000),
    },
  })
  void writeAudit({ accountId: m.accountId, event: 'code_requested', memberId: member.id, sessionId: session.id })
  await m.reply(`🔐 Send the 6-digit code from your authenticator app (within ${CODE_MINUTES} minutes). Send STOP to cancel.`)
  return true
}

async function checkCode(m: AdminChatInbound, member: NonNullable<Member>, sessionId: string): Promise<boolean> {
  const code = m.text.replace(/\s/g, '')
  if (!/^\d{6}$/.test(code)) {
    await m.reply('Send the 6-digit code from your authenticator app, or STOP.')
    return true
  }
  // Wipe the code from the chat whatever the outcome (Telegram).
  await m.forgetCodeMessage?.().catch(() => {})

  const now = new Date()
  const fresh = await prisma.adminChatMember.findUnique({ where: { id: member.id } })
  if (!fresh || fresh.status !== 'active') return true
  if (fresh.locked_until && fresh.locked_until > now) {
    await m.reply('🔒 Too many wrong codes. Admin Chat is locked for a few minutes — try again later.')
    return true
  }
  const who = await stillAdmin(m.accountId, member.user_id)
  const lastStep = fresh.last_totp_step !== null ? Number(fresh.last_totp_step) : null
  const step = who.ok && who.totpSecret ? matchTotpStep(decrypt(who.totpSecret), code, now, lastStep) : null

  if (step === null) {
    const failures = fresh.failed_attempts + 1
    const lockUntil = lockAfterFailure(failures, now)
    await prisma.adminChatMember.update({
      where: { id: member.id },
      data: { failed_attempts: lockUntil ? 0 : failures, locked_until: lockUntil ?? fresh.locked_until },
    })
    void writeAudit({ accountId: m.accountId, event: 'code_failed', memberId: member.id, sessionId, detail: { failures } })
    if (lockUntil) {
      await endSession(sessionId, 'locked')
      void writeAudit({ accountId: m.accountId, event: 'locked', memberId: member.id, sessionId })
      void notifyAdmins({ accountId: m.accountId, exceptUserId: null, title: 'Admin Chat locked', body: `${who.name}: ${MAX_FAILURES} wrong codes on ${CHANNEL_NAME[m.channel]}. Locked for 15 minutes.` })
      await m.reply('🔒 Wrong code. Too many tries — Admin Chat is locked for 15 minutes, and the owner has been told.')
    } else {
      await m.reply(`❌ Wrong or already used code. ${MAX_FAILURES - failures} ${MAX_FAILURES - failures === 1 ? 'try' : 'tries'} left.`)
    }
    return true
  }

  // Each code once: only a newer time step may be stored (two messages at
  // once with the same code — the second finds nothing to update).
  const took = await prisma.adminChatMember.updateMany({
    where: { id: member.id, OR: [{ last_totp_step: null }, { last_totp_step: { lt: BigInt(step) } }] },
    data: { last_totp_step: BigInt(step), failed_attempts: 0, locked_until: null },
  })
  if (took.count === 0) {
    await m.reply('❌ That code was already used. Wait for the next one.')
    return true
  }
  await prisma.adminChatSession.update({ where: { id: sessionId }, data: { state: 'active', started_at: now, last_activity_at: now, code_expires_at: null } })
  const settings = await prisma.adminChatSettings.findUnique({ where: { account_id: m.accountId } })
  void writeAudit({ accountId: m.accountId, event: 'session_started', memberId: member.id, sessionId, detail: { channel: m.channel } })
  void notifyAdmins({
    accountId: m.accountId,
    exceptUserId: member.user_id,
    title: 'Admin Chat session started',
    body: `${who.name} opened Admin Chat on ${CHANNEL_NAME[m.channel]}.`,
  })
  const scopeLine = member.scope === 'lookup' ? 'counts, reports and finding a customer (numbers are masked)' : 'counts and reports (no personal details)'
  await m.reply(
    `✅ *Admin Chat open.* Ask about leads, enquiries, chats, registrations — ${scopeLine}.\n` +
      `Closes after ${settings?.idle_minutes ?? 15} min without a message or ${settings?.max_minutes ?? 60} min in all. Send *STOP* to close now.`,
  )
  return true
}

async function answer(
  m: AdminChatInbound,
  member: NonNullable<Member>,
  session: { id: string; history: Prisma.JsonValue; questions: number },
  question: string,
  viaVoice: boolean,
): Promise<boolean> {
  const now = new Date()
  // The allowed hours end a session too, not just the start.
  const zone = await businessTimezone(m.accountId)
  const window = windowCheck(member, localNow(zone, now))
  const who = await stillAdmin(m.accountId, member.user_id)
  if (!window.ok || !who.ok) {
    await endSession(session.id, window.ok ? 'not_admin' : 'window')
    void writeAudit({ accountId: m.accountId, event: 'session_ended', memberId: member.id, sessionId: session.id, detail: { reason: window.ok ? 'not_admin' : window.reason } })
    await m.reply(`🔒 ${window.ok ? 'Admin Chat needs an owner or admin login in the CRM.' : WINDOW_TEXT[window.reason]} Session closed.`)
    return true
  }
  const limit = checkRateLimit(`admin-chat-q:${member.id}`, { limit: 30, windowMs: 60 * 60_000 })
  if (!limit.success) {
    await m.reply('⏳ That is a lot of questions this hour — try again in a little while.')
    return true
  }

  const history = (Array.isArray(session.history) ? session.history : []) as Array<{ role: 'user' | 'model'; text: string }>
  const allowedTools = member.scope === 'reports' ? TOOL_NAMES.filter((t) => !(PERSONAL_DATA_TOOLS as readonly string[]).includes(t)) : TOOL_NAMES
  const actionTools = member.scope === 'actions' ? actionToolsFor({ accountId: m.accountId, memberId: member.id, userId: member.user_id, sessionId: session.id }) : null
  const extraInstruction = [
    `This conversation is in ${CHANNEL_NAME[m.channel]}, on the admin's phone. Write for a chat: no tables and no Markdown headings; short lines; *bold* for key numbers; at most 10 list items, then say how many more there are and that the full list is in the CRM.`,
    'Answer only about this business and its CRM data. For anything else, say this chat is only for the business’s CRM.',
    member.scope === 'reports'
      ? 'This admin may see counts and summaries only — no names, numbers or details of individual people.'
      : 'Never write out full phone numbers, emails, ID or bank numbers — they are masked before sending anyway.',
    ...(actionTools
      ? ['When the admin asks you to DO something (follow-up, tag, assign a chat, create a lead, send a template, prepare a broadcast), call the matching propose_ tool once. It only proposes; say plainly what will happen. Never claim it is done.']
      : ['This admin cannot change anything from the chat; if asked to, say it must be done in the CRM.']),
    'Reply in the language the admin wrote in (Malayalam or English).',
    ...(viaVoice ? [`The admin asked by voice and will also hear the answer: keep it under ${MAX_SPOKEN_CHARS} characters, in plain sentences, no lists of numbers.`] : []),
  ].join('\n')

  let reply: string
  let tools: string[] = []
  try {
    const result = await answerAdminQuestion({
      accountId: m.accountId,
      message: question,
      history,
      allowedTools,
      extraInstruction,
      feature: 'admin_chat',
      ...(actionTools ? { extraTools: actionTools } : {}),
    })
    reply = result.reply
    tools = result.toolsUsed
  } catch (err) {
    console.error('[admin-chat] answer failed:', err instanceof Error ? err.message : err)
    reply = err instanceof AdminAnswerError ? err.message : 'Could not answer just now — try again.'
  }
  reply = maskSensitive(reply).replace(/^#{1,6}\s+/gm, '')
  if (reply.length > MAX_REPLY) reply = `${reply.slice(0, MAX_REPLY)}…\n(cut short — open the CRM for the rest)`
  // The confirmation line comes from here, not the model: the code is never
  // in the model's hands, and the summary is exactly what will run.
  const proposal = actionTools?.proposals[0]
  if (proposal) reply = `${reply}\n\n👉 *${maskSensitive(proposal.summary)}*\nReply *YES ${proposal.code}* to do it, or *NO*. (5 minutes)`

  const nextHistory = [...history, { role: 'user' as const, text: maskSensitive(question).slice(0, 500) }, { role: 'model' as const, text: reply.slice(0, 1500) }].slice(-HISTORY_TURNS * 2)
  await prisma.adminChatSession.update({
    where: { id: session.id },
    data: { last_activity_at: new Date(), questions: { increment: 1 }, history: nextHistory as unknown as Prisma.InputJsonValue },
  })
  void writeAudit({
    accountId: m.accountId,
    event: 'question',
    memberId: member.id,
    sessionId: session.id,
    detail: { question: maskSensitive(question).slice(0, 300), tools, reply_chars: reply.length, ...(viaVoice ? { voice: true } : {}) },
  })
  await m.reply(viaVoice ? `🎙️ _${maskSensitive(question).slice(0, 300)}_\n\n${reply}` : reply)
  if (viaVoice && m.replyVoice) {
    const mp3 = await speakForAdmin(m.accountId, reply)
    if (mp3) await m.replyVoice(mp3).catch((err) => console.error('[admin-chat] voice reply failed:', err instanceof Error ? err.message : err))
  }
  return true
}
