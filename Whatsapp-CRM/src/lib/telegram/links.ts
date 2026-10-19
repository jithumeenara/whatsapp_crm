/**
 * Start links and buttons — pure (links.test.ts).
 *
 * A start link (t.me/<bot>?start=<payload>) lets a known customer — a
 * WhatsApp contact, a registration — open the bot already recognised: the
 * payload names their contact, signed so nobody can make one for somebody
 * else's record. Telegram allows 64 characters of [A-Za-z0-9_-].
 */

import crypto from 'crypto'

const B64URL = /^[A-Za-z0-9_-]+$/

function mac(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(`tg-start:${body}`).digest('base64url').slice(0, 16)
}

/** "c" + the contact id without dashes + a 16-character signature: 49 characters. */
export function signStartPayload(contactId: string, secret: string): string {
  const hex = contactId.replace(/-/g, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('not a contact id')
  return `c${hex}${mac(secret, hex)}`
}

/** The contact id a payload names, or null when it is not one this account signed. */
export function verifyStartPayload(payload: string, secret: string): string | null {
  if (!payload || payload.length !== 49 || !B64URL.test(payload) || payload[0] !== 'c') return null
  const hex = payload.slice(1, 33)
  const sig = payload.slice(33)
  if (!/^[0-9a-f]{32}$/.test(hex)) return null
  const want = mac(secret, hex)
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function startLink(botUsername: string, payload?: string): string {
  return `https://t.me/${botUsername}${payload ? `?start=${payload}` : ''}`
}

export interface ButtonSpec {
  id: string
  title: string
}

/**
 * Chatbot buttons as Telegram's inline keyboard, one per row. A reply id
 * longer than Telegram's 64 bytes travels as "x:" + its hash; the message
 * keeps the full list (telegram_meta.buttons) to turn it back.
 */
export function inlineKeyboard(buttons: readonly ButtonSpec[]): { keyboard: Array<Array<{ text: string; callback_data: string }>>; meta: Array<{ id: string; title: string; cb: string }> } {
  const meta = buttons
    .filter((b) => b.id && b.title)
    .slice(0, 10)
    .map((b) => ({ id: b.id, title: b.title.slice(0, 64), cb: Buffer.byteLength(b.id) <= 64 ? b.id : `x:${crypto.createHash('sha1').update(b.id).digest('hex').slice(0, 24)}` }))
  return { keyboard: meta.map((b) => [{ text: b.title, callback_data: b.cb }]), meta }
}

/** The reply id a pressed button stands for, from the buttons that were sent. */
export function buttonFor(data: string, sent: ReadonlyArray<{ id: string; title: string; cb: string }>): { id: string; title: string } | null {
  const hit = sent.find((b) => b.cb === data)
  if (hit) return { id: hit.id, title: hit.title }
  return data.startsWith('x:') ? null : { id: data, title: data }
}

/** The keyboard asking for the customer's own number. Telegram sends back
 *  their account's verified number, not something they type. */
export const SHARE_NUMBER_KEYBOARD = {
  keyboard: [[{ text: '📱 Share my number', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
}
