/**
 * A Telegram update, reduced to what the CRM acts on. Pure — tested on
 * plain objects (parse.test.ts).
 *
 * Only private chats with a person are taken: a group, a channel post, a
 * message from another bot or an edit is "ignored", so a bot added to a
 * group can never fill the Inbox with strangers. Telegram Business
 * messages (a business's own account, connected to the bot) are taken the
 * same way, with the connection id the reply must go back through.
 */

export interface TelegramUser {
  id: string
  firstName: string
  lastName: string | null
  username: string | null
  language: string | null
}

export type TelegramMediaKind = 'image' | 'document' | 'video' | 'audio' | 'voice' | 'sticker'

export interface TelegramMedia {
  kind: TelegramMediaKind
  fileId: string
  mimeType: string | null
  fileName: string | null
  fileSize: number | null
}

export type TelegramEvent =
  | {
      kind: 'message'
      updateId: number
      chatId: string
      messageId: number
      from: TelegramUser
      text: string
      media: TelegramMedia | null
      /** "/start <payload>" — the deep-link payload, else null. */
      startPayload: string | null
      /** The customer shared a phone number with the "Share my number" button. */
      contact: { phone: string; ownNumber: boolean } | null
      businessConnectionId: string | null
    }
  | {
      kind: 'button'
      updateId: number
      callbackQueryId: string
      chatId: string
      messageId: number | null
      from: TelegramUser
      data: string
      businessConnectionId: string | null
    }
  | {
      kind: 'business_connection'
      updateId: number
      connectionId: string
      user: TelegramUser
      enabled: boolean
    }
  | { kind: 'ignored'; updateId: number; reason: string }

type Obj = Record<string, unknown>

function obj(v: unknown): Obj | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null
}

export function parseUser(raw: unknown): TelegramUser | null {
  const u = obj(raw)
  if (!u || u.id === undefined || u.is_bot === true) return null
  return {
    id: String(u.id),
    firstName: (str(u.first_name) ?? '').slice(0, 100),
    lastName: str(u.last_name)?.slice(0, 100) ?? null,
    username: str(u.username)?.slice(0, 64) ?? null,
    language: str(u.language_code)?.slice(0, 10) ?? null,
  }
}

/** "Faisal A" / "@faisal" / "Telegram 5123" — something to call them by. */
export function displayName(u: TelegramUser): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
  if (full) return full.slice(0, 120)
  if (u.username) return `@${u.username}`
  return `Telegram ${u.id.slice(-4)}`
}

function mediaOf(m: Obj): TelegramMedia | null {
  const photos = Array.isArray(m.photo) ? (m.photo as Obj[]) : null
  if (photos && photos.length) {
    // The largest size is last.
    const p = photos[photos.length - 1]
    return { kind: 'image', fileId: String(p.file_id ?? ''), mimeType: 'image/jpeg', fileName: null, fileSize: Number(p.file_size) || null }
  }
  const pick = (key: string, kind: TelegramMediaKind): TelegramMedia | null => {
    const f = obj(m[key])
    if (!f || typeof f.file_id !== 'string') return null
    return { kind, fileId: f.file_id, mimeType: str(f.mime_type), fileName: str(f.file_name)?.slice(0, 200) ?? null, fileSize: Number(f.file_size) || null }
  }
  return pick('document', 'document') ?? pick('video', 'video') ?? pick('audio', 'audio') ?? pick('voice', 'voice') ?? pick('sticker', 'sticker')
}

/** What a media message reads as in the Inbox list. */
export function mediaLabel(kind: TelegramMediaKind): string {
  return { image: '[Photo]', document: '[Document]', video: '[Video]', audio: '[Audio]', voice: '[Voice message]', sticker: '[Sticker]' }[kind]
}

export function parseUpdate(raw: unknown): TelegramEvent {
  const u = obj(raw) ?? {}
  const updateId = Number(u.update_id) || 0

  const conn = obj(u.business_connection)
  if (conn) {
    const user = parseUser(conn.user)
    if (!user || typeof conn.id !== 'string') return { kind: 'ignored', updateId, reason: 'bad business connection' }
    return { kind: 'business_connection', updateId, connectionId: conn.id, user, enabled: conn.is_enabled !== false }
  }

  const cq = obj(u.callback_query)
  if (cq) {
    const from = parseUser(cq.from)
    const msg = obj(cq.message)
    const chat = obj(msg?.chat)
    if (!from) return { kind: 'ignored', updateId, reason: 'button from a bot' }
    if (chat && chat.type !== 'private') return { kind: 'ignored', updateId, reason: 'button in a group' }
    return {
      kind: 'button',
      updateId,
      callbackQueryId: String(cq.id ?? ''),
      chatId: chat ? String(chat.id) : from.id,
      messageId: msg && typeof msg.message_id === 'number' ? msg.message_id : null,
      from,
      data: (str(cq.data) ?? '').slice(0, 64),
      businessConnectionId: str(msg?.business_connection_id) ?? null,
    }
  }

  const business = obj(u.business_message)
  const m = obj(u.message) ?? business
  if (!m) {
    const which = Object.keys(u).find((k) => k !== 'update_id') ?? 'nothing'
    return { kind: 'ignored', updateId, reason: `not handled: ${which}` }
  }
  const chat = obj(m.chat)
  if (!chat || chat.type !== 'private') return { kind: 'ignored', updateId, reason: 'not a private chat' }
  const from = parseUser(m.from)
  if (!from) return { kind: 'ignored', updateId, reason: 'from a bot' }
  // In a business chat the business owner's own messages arrive too —
  // they are the business talking, not the customer.
  if (business && String(chat.id) !== from.id) return { kind: 'ignored', updateId, reason: 'business owner message' }

  const text = (str(m.text) ?? str(m.caption) ?? '').slice(0, 4096)
  const start = /^\/start(?:@\w+)?(?:\s+(\S{1,64}))?\s*$/.exec(text.trim())
  const c = obj(m.contact)
  const contact = c && typeof c.phone_number === 'string'
    ? { phone: c.phone_number, ownNumber: c.user_id !== undefined && String(c.user_id) === from.id }
    : null
  return {
    kind: 'message',
    updateId,
    chatId: String(chat.id),
    messageId: Number(m.message_id) || 0,
    from,
    text,
    media: mediaOf(m),
    startPayload: start ? (start[1] ?? '') : null,
    contact,
    businessConnectionId: business ? str(m.business_connection_id) : null,
  }
}
