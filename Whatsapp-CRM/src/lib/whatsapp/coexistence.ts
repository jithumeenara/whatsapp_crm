/**
 * WhatsApp Coexistence — the business keeps the WhatsApp Business app on
 * its phone AND uses the number in the CRM (Meta: "onboarding business app
 * users"). docs/plans/whatsapp-multi-number-coexistence-plan.md.
 *
 * Three webhook fields only a coexistence number sends:
 *  - smb_message_echoes — a message the business sent from the phone app
 *    (or a linked device): shown in the Inbox as sent by a person.
 *  - history            — up to 6 months of past 1:1 chats, once, after
 *    the business agreed on the phone. Chunks arrive out of order.
 *  - smb_app_state_sync — the phone's contacts (add / edit / remove).
 *
 * Meta never resends these, so each payload is stored first
 * (whatsapp_history_chunks, migration 183) and turned into messages after.
 * None of it ever starts an AI reply, an automation, a flow or a 24-hour
 * window, and none of it counts as unread: it already happened.
 *
 * The one-time sync request (POST /{phone_number_id}/smb_app_data, contacts
 * then history) must be made within 24 hours of onboarding and works once —
 * requestCoexistenceSync records that it was made so it is never repeated.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { META_API_BASE } from '@/lib/whatsapp/meta-api'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { emitToAccount } from '@/lib/socket'

export const COEXISTENCE_FIELDS = new Set(['smb_message_echoes', 'history', 'smb_app_state_sync'])

export function isCoexistenceField(field: string): boolean {
  return COEXISTENCE_FIELDS.has(field)
}

/** Meta's code for "history sharing is turned off by the business". */
export const HISTORY_DECLINED_CODE = 2593109

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker'])

type Json = Record<string, unknown>
const rec = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const str = (v: unknown, max = 4096): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null)
const digits = (v: unknown): string => (typeof v === 'string' ? v.replace(/\D/g, '') : '')

// ── The one-time sync request ────────────────────────────────────────────

async function smbAppData(phoneNumberId: string, accessToken: string, syncType: 'smb_app_state_sync' | 'history'): Promise<{ requestId: string | null; error: string | null }> {
  try {
    const res = await fetch(`${META_API_BASE}/${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
    })
    const data = (await res.json().catch(() => ({}))) as { request_id?: string; error?: { message?: string; code?: number } }
    if (!res.ok || data.error) {
      const code = data.error?.code ? ` (code ${data.error.code})` : ''
      return { requestId: null, error: `${(data.error?.message ?? `HTTP ${res.status}`).slice(0, 300)}${code}` }
    }
    return { requestId: str(data.request_id, 200), error: null }
  } catch (err) {
    return { requestId: null, error: err instanceof Error ? err.message.slice(0, 300) : 'network error' }
  }
}

/**
 * Ask Meta for the phone's contacts, then its chat history. Made once per
 * number: a second call is refused by Meta and would only confuse support,
 * so the row is claimed first (INSERT … ON CONFLICT DO NOTHING) and only
 * the request that created it calls Meta. Never throws.
 */
export async function requestCoexistenceSync(args: { configId: string; accountId: string; phoneNumberId: string; accessToken: string }): Promise<{ requested: boolean }> {
  try {
    const claimed = await prisma.$queryRaw<Array<{ whatsapp_config_id: string }>>(Prisma.sql`
      INSERT INTO whatsapp_coexistence_syncs (whatsapp_config_id, account_id)
      VALUES (${args.configId}::uuid, ${args.accountId}::uuid)
      ON CONFLICT (whatsapp_config_id) DO NOTHING
      RETURNING whatsapp_config_id`)
    if (claimed.length === 0) return { requested: false }
    // Contacts first, then history — the order Meta documents.
    const contacts = await smbAppData(args.phoneNumberId, args.accessToken, 'smb_app_state_sync')
    const history = await smbAppData(args.phoneNumberId, args.accessToken, 'history')
    await prisma.$executeRaw(Prisma.sql`
      UPDATE whatsapp_coexistence_syncs SET
        contacts_request_id = ${contacts.requestId}, contacts_error = ${contacts.error},
        history_request_id = ${history.requestId}, history_error = ${history.error},
        history_status = ${history.error ? 'failed' : 'pending'}, updated_at = now()
      WHERE whatsapp_config_id = ${args.configId}::uuid`)
    if (contacts.error || history.error) console.warn('[coexistence] sync request:', { contacts: contacts.error, history: history.error })
    return { requested: true }
  } catch (err) {
    console.error('[coexistence] sync request not recorded:', err instanceof Error ? err.message : err)
    return { requested: false }
  }
}

export interface CoexistenceSyncState {
  onboarded_at: string
  history_status: string
  history_progress: number
  history_messages: number
  contacts_synced: number
  history_error: string | null
  contacts_error: string | null
}

export async function coexistenceSyncState(configId: string, accountId: string): Promise<CoexistenceSyncState | null> {
  try {
    const rows = await prisma.$queryRaw<Array<CoexistenceSyncState & { onboarded_at: Date }>>(Prisma.sql`
      SELECT onboarded_at, history_status, history_progress, history_messages, contacts_synced, history_error, contacts_error
      FROM whatsapp_coexistence_syncs
      WHERE whatsapp_config_id = ${configId}::uuid AND account_id = ${accountId}::uuid`)
    const r = rows[0]
    return r ? { ...r, onboarded_at: new Date(r.onboarded_at).toISOString() } : null
  } catch {
    return null
  }
}

// ── Webhook: store first ─────────────────────────────────────────────────

interface ConfigRef { id: string; account_id: string; user_id: string; phone_number_id: string }

async function configFor(phoneNumberId: string | null): Promise<ConfigRef | null> {
  if (!phoneNumberId) return null
  const rows = await prisma.whatsAppConfig.findMany({
    where: { phone_number_id: phoneNumberId },
    select: { id: true, account_id: true, user_id: true, phone_number_id: true },
    take: 2,
  })
  // A number we cannot place on exactly one business changes nothing.
  return rows.length === 1 ? rows[0] : null
}

/** Called by the WhatsApp webhook (after the signature check) for the three coexistence fields. */
export async function handleCoexistenceChange(field: string, value: unknown): Promise<void> {
  if (!isCoexistenceField(field)) return
  const config = await configFor(str(rec(rec(value).metadata).phone_number_id, 64))
  if (!config) {
    console.warn(`[coexistence] ${field} for a number not connected here — dropped`)
    return
  }
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO whatsapp_history_chunks (whatsapp_config_id, account_id, field, payload)
      VALUES (${config.id}::uuid, ${config.account_id}::uuid, ${field}, ${JSON.stringify(value)}::jsonb)`)
  } catch (err) {
    // No table yet (migration 183): process straight away rather than lose it.
    console.error('[coexistence] chunk not stored, processing directly:', err instanceof Error ? err.message : err)
    await processChange(config, field, value).catch((e) => console.error('[coexistence] direct processing failed:', e instanceof Error ? e.message : e))
    return
  }
  void processPendingChunks(config.id)
}

// ── Processing ───────────────────────────────────────────────────────────

const running = new Set<string>()

/** Works through this number's stored chunks, oldest first; one runner per number. */
export async function processPendingChunks(configId: string): Promise<void> {
  if (running.has(configId)) return
  running.add(configId)
  try {
    const config = await prisma.whatsAppConfig.findUnique({ where: { id: configId }, select: { id: true, account_id: true, user_id: true, phone_number_id: true } })
    if (!config) return
    for (let round = 0; round < 200; round++) {
      const chunks = await prisma.$queryRaw<Array<{ id: string; field: string; payload: unknown }>>(Prisma.sql`
        SELECT id, field, payload FROM whatsapp_history_chunks
        WHERE whatsapp_config_id = ${configId}::uuid AND processed_at IS NULL
        ORDER BY received_at LIMIT 10`)
      if (chunks.length === 0) break
      for (const c of chunks) {
        let error: string | null = null
        try {
          await processChange(config, c.field, c.payload)
        } catch (err) {
          error = err instanceof Error ? err.message.slice(0, 500) : 'failed'
          console.error('[coexistence] chunk failed:', error)
        }
        // Once turned into messages the raw chats are not kept twice: the
        // payload is emptied, unless it failed and someone may need to look.
        await prisma.$executeRaw(Prisma.sql`
          UPDATE whatsapp_history_chunks
          SET processed_at = now(), error = ${error},
              payload = CASE WHEN ${error}::text IS NULL THEN '{}'::jsonb ELSE payload END
          WHERE id = ${c.id}::uuid`)
      }
    }
  } catch (err) {
    console.error('[coexistence] processing stopped:', err instanceof Error ? err.message : err)
  } finally {
    running.delete(configId)
  }
}

async function processChange(config: ConfigRef, field: string, value: unknown): Promise<void> {
  const v = rec(value)
  if (field === 'smb_message_echoes') {
    for (const m of arr(v.message_echoes)) await saveEcho(config, rec(m))
  } else if (field === 'history') {
    await saveHistory(config, v)
  } else if (field === 'smb_app_state_sync') {
    let synced = 0
    for (const s of arr(v.state_sync)) synced += (await saveContactSync(config, rec(s))) ? 1 : 0
    if (synced > 0) await bumpSync(config.id, Prisma.sql`contacts_synced = contacts_synced + ${synced}`)
  }
}

async function bumpSync(configId: string, set: Prisma.Sql): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`UPDATE whatsapp_coexistence_syncs SET ${set}, updated_at = now() WHERE whatsapp_config_id = ${configId}::uuid`).catch(() => {})
}

/** Text, media and a caption from one WhatsApp message object. */
export function messageContent(m: Json): { contentType: string; text: string | null; mediaUrl: string | null; mime: string | null; filename: string | null } {
  const type = str(m.type, 40) ?? 'text'
  if (type === 'text') return { contentType: 'text', text: str(rec(m.text).body), mediaUrl: null, mime: null, filename: null }
  if (MEDIA_TYPES.has(type)) {
    const media = rec(m[type])
    const id = str(media.id, 128)
    const safeId = id && /^[A-Za-z0-9_.-]{1,128}$/.test(id) ? id : null
    return {
      contentType: type === 'sticker' ? 'image' : type,
      text: str(media.caption) ?? (type === 'document' ? str(media.filename, 255) : null),
      // The same on-demand proxy inbound media uses; Meta's media ids last 7 days.
      mediaUrl: safeId ? `/api/whatsapp/media/${safeId}` : null,
      mime: str(media.mime_type, 100),
      filename: type === 'document' ? str(media.filename, 255) : null,
    }
  }
  if (type === 'media_placeholder') return { contentType: 'text', text: '[Photo or file — older than 14 days, open WhatsApp on the phone to see it]', mediaUrl: null, mime: null, filename: null }
  return { contentType: 'text', text: `[${type}]`, mediaUrl: null, mime: null, filename: null }
}

async function contactFor(config: ConfigRef, phone: string, name: string | null) {
  const found = await findExistingContact(config.account_id, phone)
  if (found) return found
  try {
    return await prisma.contact.create({
      data: {
        account_id: config.account_id,
        user_id: config.user_id,
        phone,
        phone_normalized: phone,
        name: name || phone,
        // Imported from the business's own phone: not an opt-in.
        opt_in_status: 'unknown',
        opt_in_source: 'whatsapp_business_app',
      },
    })
  } catch (err) {
    if (isUniqueViolation(err)) return findExistingContact(config.account_id, phone)
    throw err
  }
}

async function conversationFor(config: ConfigRef, contactId: string) {
  const where = { account_id: config.account_id, contact_id: contactId, channel: 'whatsapp', whatsapp_config_id: config.id }
  const existing = await prisma.conversation.findFirst({ where })
  if (existing) return existing
  try {
    return await prisma.conversation.create({ data: { ...where, user_id: config.user_id } })
  } catch (err) {
    if (isUniqueViolation(err)) return prisma.conversation.findFirst({ where })
    throw err
  }
}

/** Saves one message once (wamid). Returns true when a new row was written. */
async function saveMessage(args: {
  config: ConfigRef
  conversationId: string
  wamid: string
  fromBusiness: boolean
  source: 'phone_app' | 'phone_app_history'
  content: ReturnType<typeof messageContent>
  at: Date
  status: string
  emit: boolean
}): Promise<boolean> {
  const existing = await prisma.message.findFirst({ where: { conversation_id: args.conversationId, message_id: args.wamid }, select: { id: true, media_url: true } })
  if (existing) {
    // History sends a media placeholder first and the media after (last 14 days).
    if (!existing.media_url && args.content.mediaUrl) {
      await prisma.message.update({
        where: { id: existing.id },
        data: { content_type: args.content.contentType, media_url: args.content.mediaUrl, media_mime_type: args.content.mime, media_filename: args.content.filename, content_text: args.content.text },
      })
    }
    return false
  }
  const saved = await prisma.message.create({
    data: {
      conversation_id: args.conversationId,
      sender_type: args.fromBusiness ? 'agent' : 'customer',
      sender_id: null,
      bot_source: args.fromBusiness ? args.source : null,
      content_type: args.content.contentType,
      content_text: args.content.text,
      media_url: args.content.mediaUrl,
      media_mime_type: args.content.mime,
      media_filename: args.content.filename,
      message_id: args.wamid,
      status: args.status,
      created_at: args.at,
    },
  })
  if (args.emit) emitToAccount(args.config.account_id, 'message', { eventType: 'INSERT', new: saved, old: {} })
  return true
}

/** The thread's last message moves only forward; nothing here is unread. */
async function touchConversation(config: ConfigRef, conversationId: string, text: string, at: Date, emit: boolean): Promise<void> {
  const updated = await prisma.conversation.updateMany({
    where: { id: conversationId, account_id: config.account_id, OR: [{ last_message_at: null }, { last_message_at: { lt: at } }] },
    data: { last_message_text: text.slice(0, 500), last_message_at: at },
  })
  if (emit && updated.count > 0) {
    const conv = await prisma.conversation.findUnique({ where: { id: conversationId } })
    if (conv) emitToAccount(config.account_id, 'conversation', { eventType: 'UPDATE', new: conv, old: {} })
  }
}

function tsToDate(v: unknown): Date {
  const n = Number(v)
  const d = Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date()
  return d.getTime() > Date.now() + 60_000 ? new Date() : d
}

/** A message the business sent from the phone app. */
async function saveEcho(config: ConfigRef, m: Json): Promise<void> {
  const wamid = str(m.id, 255)
  const phone = digits(m.to)
  if (!wamid) return
  const type = str(m.type, 40)
  if (type === 'revoke' || type === 'edit') {
    const original = str(rec(m[type]).original_message_id, 255)
    if (!original) return
    const target = await prisma.message.findFirst({
      where: { message_id: original, conversation: { account_id: config.account_id, whatsapp_config_id: config.id } },
      select: { id: true, conversation_id: true },
    })
    if (!target) return
    const updated = type === 'revoke'
      ? await prisma.message.update({ where: { id: target.id }, data: { deleted_at: new Date() } })
      : await prisma.message.update({ where: { id: target.id }, data: { content_text: messageContent(rec(rec(m.edit).message)).text } })
    emitToAccount(config.account_id, 'message', { eventType: 'UPDATE', new: updated, old: {} })
    return
  }
  // A customer known only by username (BSUID) has no number yet — kept for
  // the identity work in phase 3, not guessed.
  if (phone.length < 8) {
    console.warn('[coexistence] echo without a phone number (username-only contact) — skipped')
    return
  }
  const contact = await contactFor(config, phone, null)
  if (!contact) return
  const conv = await conversationFor(config, contact.id)
  if (!conv) return
  const content = messageContent(m)
  const at = tsToDate(m.timestamp)
  const isNew = await saveMessage({ config, conversationId: conv.id, wamid, fromBusiness: true, source: 'phone_app', content, at, status: 'sent', emit: true })
  if (isNew) await touchConversation(config, conv.id, content.text ?? `[${content.contentType}]`, at, true)
}

/** One `history` webhook: progress, a decline, or threads of past messages. */
async function saveHistory(config: ConfigRef, v: Json): Promise<void> {
  const business = digits(rec(v.metadata).display_phone_number)
  let saved = 0
  for (const h of arr(v.history)) {
    const item = rec(h)
    const errors = arr(item.errors).map(rec)
    if (errors.some((e) => Number(e.code) === HISTORY_DECLINED_CODE)) {
      await bumpSync(config.id, Prisma.sql`history_status = 'declined'`)
      continue
    }
    const progress = Math.max(0, Math.min(100, Math.round(Number(rec(item.metadata).progress) || 0)))
    for (const t of arr(item.threads)) {
      const thread = rec(t)
      const phone = digits(thread.id) || digits(rec(thread.context).wa_id)
      if (phone.length < 8) continue
      const contact = await contactFor(config, phone, null)
      if (!contact) continue
      const conv = await conversationFor(config, contact.id)
      if (!conv) continue
      let lastAt: Date | null = null
      let lastText = ''
      for (const raw of arr(thread.messages)) {
        const m = rec(raw)
        const wamid = str(m.id, 255)
        if (!wamid) continue
        const fromBusiness = business.length > 0 && digits(m.from) === business
        const content = messageContent(m)
        const at = tsToDate(m.timestamp)
        const status = (str(rec(m.history_context).status, 20) ?? (fromBusiness ? 'sent' : 'delivered')).toLowerCase()
        if (await saveMessage({ config, conversationId: conv.id, wamid, fromBusiness, source: 'phone_app_history', content, at, status, emit: false })) saved++
        if (!lastAt || at > lastAt) { lastAt = at; lastText = content.text ?? `[${content.contentType}]` }
      }
      if (lastAt) await touchConversation(config, conv.id, lastText, lastAt, false)
    }
    // Media that follows a placeholder comes as messages / message_echoes.
    for (const raw of [...arr(item.messages), ...arr(item.message_echoes)]) {
      const m = rec(raw)
      const wamid = str(m.id, 255)
      if (!wamid) continue
      const target = await prisma.message.findFirst({
        where: { message_id: wamid, conversation: { account_id: config.account_id, whatsapp_config_id: config.id } },
        select: { id: true, conversation_id: true },
      })
      if (target) await saveMessage({ config, conversationId: target.conversation_id, wamid, fromBusiness: false, source: 'phone_app_history', content: messageContent(m), at: tsToDate(m.timestamp), status: 'delivered', emit: false })
    }
    await bumpSync(config.id, Prisma.sql`
      history_progress = GREATEST(history_progress, ${progress}),
      history_messages = history_messages + ${saved},
      history_status = CASE WHEN history_status = 'declined' THEN 'declined' WHEN ${progress} >= 100 THEN 'done' ELSE 'importing' END`)
    saved = 0
  }
}

/** A contact added or edited in the phone's address book. Removal deletes nothing. */
async function saveContactSync(config: ConfigRef, s: Json): Promise<boolean> {
  if (str(s.type, 20) !== 'contact' || str(s.action, 20) !== 'add') return false
  const c = rec(s.contact)
  const phone = digits(c.phone_number)
  if (phone.length < 8) return false
  const name = str(c.full_name, 200) ?? str(c.first_name, 200)
  const existing = await findExistingContact(config.account_id, phone)
  if (existing) {
    // Only fill a name that is missing or just the number — never overwrite a real one.
    const looksLikePhone = !existing.name || /^[+\d\s\-().]+$/.test(String(existing.name).trim())
    if (name && looksLikePhone) await prisma.contact.update({ where: { id: existing.id }, data: { name } }).catch(() => {})
    return true
  }
  return Boolean(await contactFor(config, phone, name))
}
