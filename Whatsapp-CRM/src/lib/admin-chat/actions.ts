/**
 * Admin Chat actions — proposed by the assistant, done only after a
 * confirmation.
 *
 *   propose  the assistant calls a propose_* tool; the request is checked
 *            (the person, tag, agent or template exists in this account,
 *            today's limits) and saved as 'proposed' with a 4-digit code.
 *            Nothing has changed yet.
 *   confirm  "YES <code>" within 5 minutes. Follow-up, tag, assign and lead
 *            are done then. A template to a customer and a broadcast draft
 *            wait for the web as well (Settings → Admin Chat → Waiting for
 *            approval, with an authenticator code); a broadcast for more
 *            than 50 people needs a different owner/admin to approve it.
 *   undo     "UNDO" within 10 minutes for a tag, an assignment or a
 *            follow-up.
 *
 * Every step runs with the requesting admin's account id; a record named
 * by the model is always looked up in this account, never used as given.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { addTagsToContact, removeTagsFromContact } from '@/lib/contacts/tag-events'
import { sendableContactWhere } from '@/lib/broadcasts/sendable'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { sendPushToUser } from '@/lib/push'
import { emitToAccount } from '@/lib/socket'
import { businessTimezone } from '@/lib/ai/human-date'
import { localNow } from './rules'
import { zonedDayRange, templateVariableCount } from './brief-rules'
import {
  approvalRule,
  CONFIRM_MINUTES,
  DAILY_ACTIONS_PER_MEMBER,
  DAILY_BROADCAST_RECIPIENTS_PER_ACCOUNT,
  DAILY_TEMPLATE_SENDS_PER_ACCOUNT,
  hashConfirmCode,
  isUndoable,
  localDateTime,
  newConfirmCode,
  UNDO_MINUTES,
  WEB_APPROVAL_MINUTES,
  type ActionKind,
} from './action-rules'
import { writeAudit } from './audit'
import { notifyAdmins } from './notify'

export interface ActionContext {
  accountId: string
  memberId: string
  userId: string
  sessionId: string | null
}

export type ProposeResult = { ok: true; actionId: string; code: string; summary: string } | { ok: false; error: string }

type Args = Record<string, unknown>
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function label(c: { name: string | null; phone: string }): string {
  return c.name && c.name !== c.phone ? c.name : `…${c.phone.replace(/\D/g, '').slice(-4)}`
}

function human(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d)
}

async function startOfToday(accountId: string): Promise<{ since: Date; zone: string }> {
  const zone = await businessTimezone(accountId)
  return { since: zonedDayRange(localNow(zone).date, zone).start, zone }
}

async function contactByPhone(accountId: string, phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8) return null
  const c = await findExistingContact(accountId, digits)
  return c ? { id: c.id, name: c.name ?? null, phone: c.phone } : null
}

// ── Propose ─────────────────────────────────────────────────────────────

export async function proposeAction(ctx: ActionContext, kind: ActionKind, args: Args): Promise<ProposeResult> {
  const { since, zone } = await startOfToday(ctx.accountId)
  const usedToday = await prisma.adminChatAction.count({
    where: { member_id: ctx.memberId, status: { in: ['done', 'awaiting_web'] }, created_at: { gte: since } },
  })
  if (usedToday >= DAILY_ACTIONS_PER_MEMBER) return { ok: false, error: `The daily limit of ${DAILY_ACTIONS_PER_MEMBER} actions from Admin Chat is reached.` }

  let payload: Record<string, unknown>
  let summary: string
  let recipients: number | null = null

  switch (kind) {
    case 'add_follow_up': {
      const contact = await contactByPhone(ctx.accountId, str(args.phone))
      if (!contact) return { ok: false, error: 'No contact with that number.' }
      const title = str(args.title, 120)
      if (!title) return { ok: false, error: 'Say what the follow-up is for.' }
      const due = localDateTime(str(args.when, 30), zone)
      if (!due) return { ok: false, error: 'Give the date and time as YYYY-MM-DD HH:MM.' }
      if (due.getTime() < Date.now() - 60 * 60_000) return { ok: false, error: 'That time has already passed.' }
      payload = { contact_id: contact.id, title, note: str(args.note, 500) || null, due_at: due.toISOString() }
      summary = `Follow-up for ${label(contact)}: "${title}" on ${human(due, zone)}`
      break
    }
    case 'add_tag': {
      const contact = await contactByPhone(ctx.accountId, str(args.phone))
      if (!contact) return { ok: false, error: 'No contact with that number.' }
      const name = str(args.tag, 60)
      const tag = name ? await prisma.tag.findFirst({ where: { account_id: ctx.accountId, name: { equals: name, mode: 'insensitive' } } }) : null
      if (!tag) {
        const some = await prisma.tag.findMany({ where: { account_id: ctx.accountId }, select: { name: true }, take: 15, orderBy: { name: 'asc' } })
        return { ok: false, error: `No tag called "${name}". Tags: ${some.map((t) => t.name).join(', ') || 'none yet'}. New tags are made in the CRM.` }
      }
      const has = await prisma.contactTag.findFirst({ where: { contact_id: contact.id, tag_id: tag.id } })
      if (has) return { ok: false, error: `${label(contact)} already has the tag "${tag.name}".` }
      payload = { contact_id: contact.id, tag_id: tag.id }
      summary = `Tag ${label(contact)} as "${tag.name}"`
      break
    }
    case 'assign_chat': {
      const contact = await contactByPhone(ctx.accountId, str(args.phone))
      if (!contact) return { ok: false, error: 'No contact with that number.' }
      const conversation = await prisma.conversation.findFirst({
        where: { account_id: ctx.accountId, contact_id: contact.id, status: { not: 'closed' } },
        orderBy: { last_message_at: 'desc' },
        select: { id: true, channel: true, assigned_agent_id: true },
      })
      if (!conversation) return { ok: false, error: `${label(contact)} has no open chat to assign.` }
      const who = str(args.agent, 80)
      const team = await prisma.profile.findMany({
        where: { account_id: ctx.accountId, account_role: { in: ['owner', 'admin', 'supervisor', 'agent'] }, full_name: { contains: who, mode: 'insensitive' } },
        select: { user_id: true, full_name: true },
        take: 5,
      })
      if (!who || team.length === 0) return { ok: false, error: `No team member called "${who}".` }
      if (team.length > 1) return { ok: false, error: `More than one match: ${team.map((t) => t.full_name).join(', ')}. Say the full name.` }
      if (conversation.assigned_agent_id === team[0].user_id) return { ok: false, error: `That chat is already with ${team[0].full_name}.` }
      payload = { conversation_id: conversation.id, agent_user_id: team[0].user_id, previous_agent_id: conversation.assigned_agent_id }
      summary = `Assign ${label(contact)}'s ${conversation.channel ?? 'WhatsApp'} chat to ${team[0].full_name}`
      break
    }
    case 'create_lead': {
      const raw = str(args.phone, 30)
      const sanitized = sanitizePhoneForMeta(raw)
      if (!isValidE164(sanitized)) return { ok: false, error: 'Give the number with the country code, e.g. 919847012345.' }
      const contact = await contactByPhone(ctx.accountId, sanitized)
      if (contact) {
        const open = await prisma.lead.findFirst({ where: { account_id: ctx.accountId, contact_id: contact.id, status: { not: 'closed' } }, select: { id: true } })
        if (open) return { ok: false, error: `${label(contact)} already has an open lead.` }
      }
      const name = str(args.name, 120)
      payload = { phone: sanitized, name: name || null, note: str(args.note, 500) || null }
      summary = `New lead: ${contact ? label(contact) : name || `…${sanitized.slice(-4)}`}${payload.note ? ` — "${payload.note}"` : ''}`
      break
    }
    case 'send_template': {
      const sanitized = sanitizePhoneForMeta(str(args.phone, 30))
      if (!isValidE164(sanitized)) return { ok: false, error: 'Give the number with the country code, e.g. 919847012345.' }
      const name = str(args.template, 120)
      const template = await prisma.messageTemplate.findFirst({ where: { account_id: ctx.accountId, name: { equals: name, mode: 'insensitive' }, status: 'APPROVED' } })
      if (!template) return { ok: false, error: `No approved template called "${name}".` }
      const values = Array.isArray(args.values) ? args.values.map((v) => str(v, 200)) : []
      const needed = templateVariableCount(template.body_text)
      if (values.length !== needed) return { ok: false, error: `That template needs ${needed} value${needed === 1 ? '' : 's'}; got ${values.length}.` }
      if (values.some((v) => !v || v.includes(','))) return { ok: false, error: 'Each value must be filled in and must not contain a comma.' }
      const sent = await prisma.adminChatAction.count({ where: { account_id: ctx.accountId, kind: 'send_template', status: { in: ['done', 'awaiting_web'] }, created_at: { gte: since } } })
      if (sent >= DAILY_TEMPLATE_SENDS_PER_ACCOUNT) return { ok: false, error: `The daily limit of ${DAILY_TEMPLATE_SENDS_PER_ACCOUNT} template messages from Admin Chat is reached.` }
      const contact = await contactByPhone(ctx.accountId, sanitized)
      if (contact) {
        const c = await prisma.contact.findUnique({ where: { id: contact.id }, select: { opt_in_status: true, blocked_at: true } })
        if (c?.opt_in_status === 'opted_out' || c?.blocked_at) return { ok: false, error: 'That person has opted out or is blocked.' }
      }
      payload = { phone: sanitized, template_name: template.name, language: template.language ?? 'en_US', values }
      summary = `Send the "${template.name}" template to ${contact ? label(contact) : `…${sanitized.slice(-4)}`}`
      break
    }
    case 'prepare_broadcast': {
      const tagName = str(args.tag, 60)
      const tag = tagName ? await prisma.tag.findFirst({ where: { account_id: ctx.accountId, name: { equals: tagName, mode: 'insensitive' } } }) : null
      if (!tag) return { ok: false, error: `No tag called "${tagName}".` }
      const name = str(args.template, 120)
      const template = await prisma.messageTemplate.findFirst({ where: { account_id: ctx.accountId, name: { equals: name, mode: 'insensitive' }, status: 'APPROVED' } })
      if (!template) return { ok: false, error: `No approved template called "${name}".` }
      if (templateVariableCount(template.body_text) > 0) return { ok: false, error: 'From Admin Chat, a broadcast can use a template without variables. Prepare this one on the Broadcasts page.' }
      recipients = await prisma.contact.count({ where: { ...sendableContactWhere(ctx.accountId), tags: { some: { tag_id: tag.id } } } })
      if (recipients === 0) return { ok: false, error: `Nobody with the tag "${tag.name}" can receive a broadcast.` }
      const already = await prisma.adminChatAction.aggregate({
        where: { account_id: ctx.accountId, kind: 'prepare_broadcast', status: { in: ['done', 'awaiting_web'] }, created_at: { gte: since } },
        _sum: { recipients: true },
      })
      if ((already._sum.recipients ?? 0) + recipients > DAILY_BROADCAST_RECIPIENTS_PER_ACCOUNT) {
        return { ok: false, error: `That would pass the daily limit of ${DAILY_BROADCAST_RECIPIENTS_PER_ACCOUNT} broadcast recipients from Admin Chat.` }
      }
      payload = { tag_id: tag.id, tag_name: tag.name, template_name: template.name, language: template.language ?? 'en_US' }
      summary = `Prepare a broadcast draft: "${template.name}" to ${recipients} people tagged "${tag.name}"`
      break
    }
    default:
      return { ok: false, error: 'Unknown action.' }
  }

  // One open proposal at a time: an older one can no longer be confirmed.
  await prisma.adminChatAction.updateMany({ where: { member_id: ctx.memberId, status: 'proposed' }, data: { status: 'expired' } })
  const row = await prisma.adminChatAction.create({
    data: {
      account_id: ctx.accountId,
      member_id: ctx.memberId,
      session_id: ctx.sessionId,
      requested_by: ctx.userId,
      kind,
      payload: payload as Prisma.InputJsonValue,
      summary,
      recipients,
      needs_other_approver: approvalRule(kind, recipients) === 'web_other',
      expires_at: new Date(Date.now() + CONFIRM_MINUTES * 60_000),
    },
  })
  const code = newConfirmCode()
  await prisma.adminChatAction.update({ where: { id: row.id }, data: { confirm_code_hash: hashConfirmCode(row.id, code) } })
  void writeAudit({ accountId: ctx.accountId, event: 'action_proposed', memberId: ctx.memberId, sessionId: ctx.sessionId, detail: { kind, summary } })
  return { ok: true, actionId: row.id, code, summary }
}

// ── Confirm / reject / undo (from the chat) ─────────────────────────────

export async function confirmFromChat(ctx: ActionContext, code: string): Promise<string> {
  const action = await prisma.adminChatAction.findFirst({
    where: { member_id: ctx.memberId, status: 'proposed', expires_at: { gt: new Date() } },
    orderBy: { created_at: 'desc' },
  })
  if (!action || !action.confirm_code_hash) return 'Nothing is waiting for a YES. Ask again.'
  if (hashConfirmCode(action.id, code) !== action.confirm_code_hash) {
    // One wrong code cancels it — a 4-digit code is never there to be guessed.
    await prisma.adminChatAction.updateMany({ where: { id: action.id, status: 'proposed' }, data: { status: 'rejected', confirm_code_hash: null } })
    void writeAudit({ accountId: ctx.accountId, event: 'action_rejected', memberId: ctx.memberId, sessionId: ctx.sessionId, detail: { reason: 'wrong_code' } })
    return 'That code does not match, so the request is cancelled and nothing was changed. Ask again for a new code.'
  }

  const rule = approvalRule(action.kind as ActionKind, action.recipients)
  if (rule === 'chat') {
    const done = await executeAction(action.id, ctx.userId, ['proposed'])
    if (!done.ok) return `❌ ${done.error}`
    return `✅ Done: ${action.summary}.${isUndoable(action.kind as ActionKind) ? ` Reply *UNDO* within ${UNDO_MINUTES} minutes to put it back.` : ''}`
  }

  const moved = await prisma.adminChatAction.updateMany({
    where: { id: action.id, status: 'proposed' },
    data: { status: 'awaiting_web', confirm_code_hash: null, expires_at: new Date(Date.now() + WEB_APPROVAL_MINUTES * 60_000) },
  })
  if (moved.count === 0) return 'That proposal was already handled.'
  void writeAudit({ accountId: ctx.accountId, event: 'action_awaiting_web', memberId: ctx.memberId, sessionId: ctx.sessionId, detail: { kind: action.kind, summary: action.summary } })
  void notifyAdmins({
    accountId: ctx.accountId,
    exceptUserId: rule === 'web_other' ? ctx.userId : null,
    title: rule === 'web_other' ? 'Admin Chat: approval needed' : 'Admin Chat: confirm in the CRM',
    body: action.summary,
  })
  return rule === 'web_other'
    ? `🔐 ${action.summary}.\nThis reaches more than 50 people, so *another owner or admin* must approve it in the CRM: Settings → Admin Chat → Waiting for approval (within ${WEB_APPROVAL_MINUTES} minutes). They have been told.`
    : `🔐 ${action.summary}.\nConfirm it in the CRM with your authenticator code: Settings → Admin Chat → Waiting for approval (within ${WEB_APPROVAL_MINUTES} minutes).`
}

export async function rejectFromChat(ctx: ActionContext): Promise<string> {
  const r = await prisma.adminChatAction.updateMany({ where: { member_id: ctx.memberId, status: 'proposed' }, data: { status: 'rejected' } })
  if (r.count === 0) return 'Nothing was waiting.'
  void writeAudit({ accountId: ctx.accountId, event: 'action_rejected', memberId: ctx.memberId, sessionId: ctx.sessionId })
  return 'Cancelled — nothing was changed.'
}

export async function undoFromChat(ctx: ActionContext): Promise<string> {
  const action = await prisma.adminChatAction.findFirst({
    where: { member_id: ctx.memberId, status: 'done', done_at: { gte: new Date(Date.now() - UNDO_MINUTES * 60_000) } },
    orderBy: { done_at: 'desc' },
  })
  if (!action || !isUndoable(action.kind as ActionKind)) return `Nothing to undo from the last ${UNDO_MINUTES} minutes.`
  // Claim it first — two UNDOs never put it back twice.
  const claimed = await prisma.adminChatAction.updateMany({ where: { id: action.id, status: 'done' }, data: { status: 'undone' } })
  if (claimed.count === 0) return 'Already undone.'
  const p = action.payload as Record<string, string | null>
  const res = (action.result ?? {}) as Record<string, string | null>
  try {
    if (action.kind === 'add_tag' && p.contact_id && p.tag_id) {
      await removeTagsFromContact({ accountId: action.account_id, contactId: p.contact_id, tagIds: [p.tag_id], source: 'admin_chat' })
    } else if (action.kind === 'assign_chat' && p.conversation_id) {
      // Only if nobody has moved it since.
      await prisma.conversation.updateMany({
        where: { id: p.conversation_id, account_id: action.account_id, assigned_agent_id: p.agent_user_id },
        data: { assigned_agent_id: p.previous_agent_id ?? null },
      })
    } else if (action.kind === 'add_follow_up' && res.follow_up_id) {
      await prisma.followUp.deleteMany({ where: { id: res.follow_up_id, account_id: action.account_id, status: 'pending' } })
    }
  } catch (err) {
    console.error('[admin-chat] undo failed:', err)
    await prisma.adminChatAction.update({ where: { id: action.id }, data: { status: 'done' } })
    return 'Could not undo it — change it in the CRM.'
  }
  void writeAudit({ accountId: action.account_id, event: 'action_undone', memberId: ctx.memberId, sessionId: ctx.sessionId, detail: { kind: action.kind, summary: action.summary } })
  return `↩️ Undone: ${action.summary}.`
}

// ── Do it ───────────────────────────────────────────────────────────────

async function contactForSend(accountId: string, userId: string, phone: string, name: string | null) {
  const existing = await findExistingContact(accountId, phone)
  if (existing) return existing
  try {
    const created = await prisma.contact.create({
      data: { account_id: accountId, user_id: userId, phone, phone_normalized: phone, name: name || phone, opt_in_source: 'admin_chat', opt_in_at: new Date() },
    })
    emitToAccount(accountId, 'contact', { eventType: 'INSERT', new: created, old: {} })
    return created
  } catch (err) {
    if (isUniqueViolation(err)) {
      const again = await findExistingContact(accountId, phone)
      if (again) return again
    }
    throw err
  }
}

/**
 * Runs an action once. `from` lists the states it may be run from; the row
 * is claimed with a conditional update first, so a double tap or two
 * approvers at once run it a single time.
 */
export async function executeAction(actionId: string, actorUserId: string, from: Array<'proposed' | 'awaiting_web'>): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const claimed = await prisma.adminChatAction.updateMany({
    where: { id: actionId, status: { in: from }, expires_at: { gt: new Date() } },
    data: { status: 'done', done_at: new Date(), approved_by: actorUserId, confirm_code_hash: null },
  })
  if (claimed.count === 0) return { ok: false, error: 'This action has expired or was already handled.' }
  const action = await prisma.adminChatAction.findUniqueOrThrow({ where: { id: actionId } })
  const p = action.payload as Record<string, unknown>
  const accountId = action.account_id
  let result: Record<string, unknown> = {}

  try {
    switch (action.kind as ActionKind) {
      case 'add_follow_up': {
        const f = await prisma.followUp.create({
          data: {
            account_id: accountId,
            user_id: action.requested_by,
            contact_id: String(p.contact_id),
            title: String(p.title),
            note: (p.note as string | null) ?? null,
            due_at: new Date(String(p.due_at)),
            assigned_to: action.requested_by,
          },
          select: { id: true },
        })
        result = { follow_up_id: f.id }
        break
      }
      case 'add_tag': {
        const added = await addTagsToContact({ accountId, contactId: String(p.contact_id), tagIds: [String(p.tag_id)], source: 'admin_chat' })
        result = { added }
        break
      }
      case 'assign_chat': {
        const conversation = await prisma.conversation.findFirst({ where: { id: String(p.conversation_id), account_id: accountId } })
        if (!conversation) throw new Error('The chat no longer exists.')
        const updated = await prisma.conversation.update({ where: { id: conversation.id }, data: { assigned_agent_id: String(p.agent_user_id) } })
        emitToAccount(accountId, 'conversation', { eventType: 'UPDATE', new: updated, old: {} })
        void sendPushToUser(String(p.agent_user_id), { title: 'Chat assigned to you', body: action.summary, tag: `conv-${conversation.id}`, data: { url: `/inbox?c=${conversation.id}` } }).catch(() => {})
        result = { conversation_id: conversation.id }
        break
      }
      case 'create_lead': {
        const contact = await contactForSend(accountId, action.requested_by, String(p.phone), (p.name as string | null) ?? null)
        const lead = await prisma.lead.create({
          data: { account_id: accountId, user_id: action.requested_by, contact_id: contact.id, title: (p.name as string | null) || contact.name || contact.phone, source: 'admin_chat', status: 'new' },
          select: { id: true },
        })
        await prisma.leadActivity
          .create({ data: { account_id: accountId, lead_id: lead.id, contact_id: contact.id, type: 'created', title: 'Lead created from Admin Chat', description: (p.note as string | null) ?? null } })
          .catch(() => {})
        result = { lead_id: lead.id }
        break
      }
      case 'send_template': {
        const contact = await contactForSend(accountId, action.requested_by, String(p.phone), null)
        const { resolveWhatsAppConfig } = await import('@/lib/whatsapp/resolve-config')
        const config = await resolveWhatsAppConfig({ accountId })
        let conversation = await prisma.conversation.findFirst({ where: { account_id: accountId, contact_id: contact.id, channel: 'whatsapp', whatsapp_config_id: config.id } })
        if (!conversation) {
          try {
            conversation = await prisma.conversation.create({ data: { account_id: accountId, user_id: action.requested_by, contact_id: contact.id, channel: 'whatsapp', whatsapp_config_id: config.id } })
          } catch (err) {
            if (!isUniqueViolation(err)) throw err
            conversation = await prisma.conversation.findFirst({ where: { account_id: accountId, contact_id: contact.id, channel: 'whatsapp', whatsapp_config_id: config.id } })
          }
        }
        if (!conversation) throw new Error('Could not open a chat with that number.')
        const { engineSendTemplate } = await import('@/lib/flows/meta-send')
        const values = Array.isArray(p.values) ? (p.values as string[]) : []
        const sent = await engineSendTemplate({
          accountId,
          userId: action.requested_by,
          conversationId: conversation.id,
          contactId: contact.id,
          templateName: String(p.template_name),
          languageCode: String(p.language ?? 'en_US'),
          ...(values.length ? { bodyParams: values.join(',') } : {}),
        })
        result = { conversation_id: conversation.id, message_id: sent.whatsapp_message_id }
        break
      }
      case 'prepare_broadcast': {
        const b = await prisma.broadcast.create({
          data: {
            account_id: accountId,
            user_id: action.requested_by,
            name: `Admin Chat — ${String(p.tag_name)} — ${new Date().toISOString().slice(0, 10)}`,
            template_name: String(p.template_name),
            template_language: String(p.language ?? 'en_US'),
            template_variables: {},
            audience_filter: { type: 'tags', tagIds: [String(p.tag_id)] } as Prisma.InputJsonValue,
            status: 'draft',
            total_recipients: action.recipients ?? 0,
            sent_count: 0,
            delivered_count: 0,
            read_count: 0,
            replied_count: 0,
            failed_count: 0,
          },
          select: { id: true },
        })
        result = { broadcast_id: b.id }
        break
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[admin-chat] action failed:', message)
    await prisma.adminChatAction.update({ where: { id: action.id }, data: { status: 'failed', error: message.slice(0, 500) } })
    void writeAudit({ accountId, event: 'action_failed', memberId: action.member_id, sessionId: action.session_id, actorUserId, detail: { kind: action.kind, error: message.slice(0, 200) } })
    return { ok: false, error: `It did not work: ${message.slice(0, 200)}` }
  }

  await prisma.adminChatAction.update({ where: { id: action.id }, data: { result: result as Prisma.InputJsonValue } })
  void writeAudit({ accountId, event: 'action_done', memberId: action.member_id, sessionId: action.session_id, actorUserId, detail: { kind: action.kind, summary: action.summary } })
  void notifyAdmins({ accountId, exceptUserId: actorUserId, title: 'Admin Chat: action done', body: action.summary })
  return { ok: true, summary: action.summary }
}
