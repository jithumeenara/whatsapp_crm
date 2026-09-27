/**
 * Sending an email from a conversation — the one place that decides the
 * subject, who it goes to, and whether it is a reply.
 *
 *  - reply (default): answers the customer's latest email, or the one
 *    chosen, in its own thread — "Re: <theirs>" — so it lands under the
 *    customer's message in their mail app as well as ours.
 *  - reply_all: the same, to everyone on that email.
 *  - new: a fresh email with a subject of its own, not threaded.
 *  - forward: that email, with a note, to other addresses.
 *
 * Everything that arrives here from a browser is treated as untrusted:
 * the subject loses line breaks (no header injection), addresses must be
 * plain addresses, files must be this account's and really be what they
 * claim, and the body only ever becomes the few tags markup.ts makes.
 */

import { prisma } from '@/lib/db'
import { sendEmail, type EmailAttachment } from '@/lib/messaging/channels/email'
import { contentMatchesType, readAccountFile } from '@/lib/files/account-files'
import { GRAPH_ATTACHMENT_MAX, connectedMailbox } from '@/lib/email/microsoft/graph'

export type EmailMode = 'reply' | 'reply_all' | 'new' | 'forward'

const MAX_SUBJECT = 250
export const MAX_RECIPIENTS = 10
export const MAX_FILES = 5
const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[a-z]{2,}$/i

/** One line, no control characters, capped — safe as a header value. */
export function cleanSubject(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT)
}

/** "Re: Re: FW: Admission" → "Admission". */
export function baseSubject(subject: string): string {
  let s = subject.trim()
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|wg)\s*:\s*/i, '')
    if (next === s) return s
    s = next
  }
}

export function replySubject(original: string | null | undefined): string | null {
  const base = original ? baseSubject(cleanSubject(original)) : ''
  return base ? `Re: ${base}` : null
}

/** Addresses from a list or a comma/semicolon/space-separated string.
 *  Throws on anything that is not a plain address, so a crafted value
 *  cannot become a second header or a display-name trick. */
export function parseAddresses(raw: unknown): string[] {
  const parts = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === 'string')
    : typeof raw === 'string'
      ? raw.split(/[,;\s]+/)
      : []
  const out: string[] = []
  for (const p of parts) {
    const a = p.trim().toLowerCase()
    if (!a) continue
    if (a.length > 254 || !ADDRESS.test(a)) throw new Error(`"${a.slice(0, 60)}" is not an email address`)
    if (!out.includes(a)) out.push(a)
  }
  if (out.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} addresses`)
  return out
}

export interface EmailMetaAttachment {
  file_id: string
  name: string
  url: string
  size: number
  mime: string
}

export interface EmailMeta {
  kind: EmailMode
  to: string[]
  cc?: string[]
  bcc?: string[]
  attachments?: EmailMetaAttachment[]
  format?: 'rich'
}

export async function sendConversationEmail(args: {
  accountId: string
  conversationId: string
  /** The customer's address. */
  to: string
  text: string
  mode?: EmailMode
  subject?: string | null
  /** Our id of the customer's email answered or forwarded; the latest if absent. */
  replyToMessageId?: string | null
  cc?: string[]
  bcc?: string[]
  /** Forward only: where it goes. */
  forwardTo?: string[]
  fileIds?: string[]
  /** Add the mailbox's signature. */
  signature?: boolean
  /** Filled into {{agent_name}} in the signature. */
  agentName?: string | null
  format?: 'rich' | 'plain'
}): Promise<{ messageId: string; subject: string; meta: EmailMeta; body: string }> {
  const mode: EmailMode = args.mode ?? 'reply'
  const given = cleanSubject(args.subject)
  const cc = args.cc ?? []
  const bcc = args.bcc ?? []

  // ── Files ──────────────────────────────────────────────────────────
  const fileIds = [...new Set(args.fileIds ?? [])]
  if (fileIds.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files per email`)
  const attachments: EmailAttachment[] = []
  const metaFiles: EmailMetaAttachment[] = []
  for (const id of fileIds) {
    const file = await readAccountFile(args.accountId, id, GRAPH_ATTACHMENT_MAX)
    if (!file) throw new Error('A file could not be attached — it is missing, over 3 MB, or flagged by the virus scan')
    if (!contentMatchesType(file.mime, file.bytes)) throw new Error(`${file.name} is not the kind of file it says it is`)
    attachments.push({ name: file.name, mime: file.mime, bytes: file.bytes })
    metaFiles.push({ file_id: file.id, name: file.name, url: file.url, size: file.size, mime: file.mime })
  }

  // ── Body, with the signature ─────────────────────────────────────────
  let body = args.text.trim()
  if (args.signature) {
    const box = await connectedMailbox(args.accountId)
    const sig = box?.signature?.trim()
    if (sig) body = `${body}\n\n${sig.replace(/\{\{\s*agent_name\s*\}\}/gi, args.agentName?.trim() || '')}`
  }

  // ── What it answers ───────────────────────────────────────────────────
  const target = mode === 'new'
    ? null
    : await prisma.message.findFirst({
        where: {
          conversation_id: args.conversationId,
          sender_type: 'customer',
          ...(args.replyToMessageId ? { id: args.replyToMessageId } : {}),
        },
        orderBy: { created_at: 'desc' },
        select: { email_subject: true, message_id: true },
      })

  let subject: string
  let to: string[]
  if (mode === 'new') {
    if (!given) throw new Error('A new email needs a subject')
    subject = given
    to = [args.to]
  } else if (mode === 'forward') {
    to = args.forwardTo ?? []
    if (to.length === 0) throw new Error('Forward to whom? Add an address')
    if (!target?.message_id) throw new Error('Choose the email to forward')
    subject = `Fwd: ${baseSubject(cleanSubject(target.email_subject ?? '')) || 'email'}`
  } else {
    // With nothing of theirs to answer, the thread's latest subject of ours.
    const lastOurs = target
      ? null
      : await prisma.message.findFirst({
          where: { conversation_id: args.conversationId, email_subject: { not: null } },
          orderBy: { created_at: 'desc' },
          select: { email_subject: true },
        })
    subject =
      given ||
      replySubject(target?.email_subject ?? lastOurs?.email_subject) ||
      cleanSubject(args.text.slice(0, 60)) ||
      'Message'
    to = [args.to]
  }

  const { messageId } = await sendEmail({
    accountId: args.accountId,
    to,
    cc,
    bcc,
    subject,
    text: body,
    format: args.format ?? 'plain',
    attachments,
    kind: mode,
    inReplyTo: mode === 'new' ? null : target?.message_id ?? null,
  })

  const meta: EmailMeta = {
    kind: mode,
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    ...(metaFiles.length ? { attachments: metaFiles } : {}),
    ...(args.format === 'rich' ? { format: 'rich' as const } : {}),
  }
  return { messageId, subject, meta, body }
}

/**
 * Sends, then writes the email into the conversation and tells open
 * screens — what the Inbox's send button and a scheduled email both need.
 */
export async function sendAndRecordConversationEmail(
  args: Parameters<typeof sendConversationEmail>[0] & { senderUserId: string },
) {
  const { ensureEmailColumns } = await import('./schema')
  const { emitToAccount } = await import('@/lib/socket')
  await ensureEmailColumns().catch(() => {})
  const agent = args.agentName
    ? null
    : await prisma.profile.findUnique({ where: { user_id: args.senderUserId }, select: { full_name: true } }).catch(() => null)
  const result = await sendConversationEmail({ ...args, agentName: args.agentName ?? agent?.full_name ?? null })

  const saved = await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: 'agent',
      sender_id: args.senderUserId,
      content_type: 'text',
      // What went out, signature included, in the composer's markup.
      content_text: result.body,
      email_subject: result.subject,
      email_meta: result.meta as unknown as object,
      message_id: result.messageId || `email_agent_${Date.now()}`,
      status: 'sent',
    },
  })
  emitToAccount(args.accountId, 'message', { eventType: 'INSERT', new: saved, old: {} })
  const conv = await prisma.conversation.update({
    where: { id: args.conversationId },
    data: { last_message_text: result.body.slice(0, 500), last_message_at: new Date() },
  })
  emitToAccount(args.accountId, 'conversation', { eventType: 'UPDATE', new: conv, old: {} })
  return saved
}
