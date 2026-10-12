/**
 * What a website visitor is allowed to see of a message.
 *
 * An allow-list, not a strip-list. A message row carries the assistant's
 * sources and confidence (ai_meta), who sent it internally, translation
 * scratch work — and `system` rows are the handover notes the assistant
 * writes for staff, which say why it gave up on this very customer.
 * Anything not named below never leaves the server, so a column added
 * next year is private until somebody decides otherwise.
 *
 * Pure, so the rule is testable without a database.
 */

export type VisitorSender = 'visitor' | 'agent' | 'bot'

export interface VisitorButton {
  id: string
  title: string
}

export interface VisitorMessage {
  id: string
  sender: VisitorSender
  text: string
  /** Only https links reach the window. */
  media_url: string | null
  media_type: 'image' | 'file' | null
  media_name: string | null
  buttons: VisitorButton[]
  link: { label: string; url: string } | null
  created_at: string
}

export interface MessageRowLike {
  id: string
  sender_type: string
  content_type?: string | null
  content_text: string | null
  media_url?: string | null
  media_mime_type?: string | null
  media_filename?: string | null
  web_meta?: unknown
  deleted_at?: Date | string | null
  created_at: Date | string
}

const SENDERS: Record<string, VisitorSender> = {
  customer: 'visitor',
  agent: 'agent',
  bot: 'bot',
}

/** Longest single message the window will render. */
export const MAX_VISITOR_TEXT = 4000

export function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function cleanButtons(raw: unknown): VisitorButton[] {
  if (!Array.isArray(raw)) return []
  const out: VisitorButton[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { id, title } = item as { id?: unknown; title?: unknown }
    if (typeof id !== 'string' || typeof title !== 'string' || !id || !title.trim()) continue
    out.push({ id: id.slice(0, 256), title: title.trim().slice(0, 80) })
    if (out.length === 10) break
  }
  return out
}

function cleanLink(raw: unknown): VisitorMessage['link'] {
  if (!raw || typeof raw !== 'object') return null
  const { label, url } = raw as { label?: unknown; url?: unknown }
  if (!isSafeHttpsUrl(url)) return null
  return { label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : 'Open link', url }
}

/** Null for anything the visitor must not see. */
export function toVisitorMessage(row: MessageRowLike): VisitorMessage | null {
  const sender = SENDERS[row.sender_type]
  if (!sender) return null
  if (row.deleted_at) return null

  const meta = (row.web_meta && typeof row.web_meta === 'object' ? row.web_meta : {}) as {
    buttons?: unknown
    link?: unknown
  }
  const mediaUrl = isSafeHttpsUrl(row.media_url) ? row.media_url : null
  const text = (row.content_text ?? '').slice(0, MAX_VISITOR_TEXT)
  if (!text && !mediaUrl) return null

  return {
    id: row.id,
    sender,
    text,
    media_url: mediaUrl,
    media_type: mediaUrl ? (row.media_mime_type?.startsWith('image/') || row.content_type === 'image' ? 'image' : 'file') : null,
    media_name: mediaUrl ? (row.media_filename ?? null) : null,
    buttons: cleanButtons(meta.buttons),
    link: cleanLink(meta.link),
    created_at: new Date(row.created_at).toISOString(),
  }
}

/**
 * A visitor's message as typed: trimmed, control characters removed
 * (newlines and tabs kept), length-capped. Null when nothing is left.
 * Rendering is always as text, never HTML, on both sides — this only
 * keeps the stored row tidy.
 */
export function cleanVisitorText(raw: unknown, max = 2000): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
  if (!text) return null
  return text.length > max ? null : text
}
