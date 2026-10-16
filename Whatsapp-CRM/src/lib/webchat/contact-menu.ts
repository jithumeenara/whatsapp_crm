/**
 * The Website Bot's contact menu: the visitor clicks the chat button and
 * picks WhatsApp, Call, or the bot.
 *
 * WhatsApp numbers are the account's own connected numbers. Their phone is
 * read from Meta when the widget is saved (whatsapp-snapshot.ts) and kept
 * on the widget, so a page view never waits on Meta. Call numbers are
 * typed in. Everything here is checked again on the way out, because it
 * becomes links on somebody else's website.
 */

export const MAX_MENU_NUMBERS = 5
export const MAX_PREFILL = 300
const LABEL_MAX = 40
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MenuNumber {
  label: string
  /** Digits only, with the country code: "918590055117". */
  phone: string
}

export interface WhatsAppLink extends MenuNumber {
  config_id: string
}

export interface PublicContactMenu {
  whatsapp: MenuNumber[]
  call: MenuNumber[]
  prefill: string | null
}

/** Digits only — "+91 85900 55117", "0091-…" → "918590055117" — or null. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (/[^\d\s+().-]/.test(raw)) return null
  let digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('00')) digits = digits.replace(/^00/, '')
  return /^\d{7,15}$/.test(digits) ? digits : null
}

function label(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  return (text || fallback).slice(0, LABEL_MAX)
}

export function parseCallLinks(raw: unknown): { ok: true; links: MenuNumber[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'Call numbers must be a list.' }
  if (raw.length > MAX_MENU_NUMBERS) return { ok: false, error: `Up to ${MAX_MENU_NUMBERS} call numbers.` }
  const links: MenuNumber[] = []
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>
    const name = label(e.label, 'Call us')
    const phone = normalizePhone(e.phone)
    if (!phone) return { ok: false, error: `"${name}" is not a phone number — include the country code, like +91 85900 55117.` }
    links.push({ label: name, phone })
  }
  return { ok: true, links }
}

export function parseWhatsAppSelection(
  raw: unknown,
): { ok: true; selection: { config_id: string; label: string }[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'WhatsApp numbers must be a list.' }
  if (raw.length > MAX_MENU_NUMBERS) return { ok: false, error: `Up to ${MAX_MENU_NUMBERS} WhatsApp numbers.` }
  const selection: { config_id: string; label: string }[] = []
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>
    if (typeof e.config_id !== 'string' || !UUID.test(e.config_id)) return { ok: false, error: 'Pick WhatsApp numbers from the list.' }
    if (selection.some((s) => s.config_id === e.config_id)) continue
    selection.push({ config_id: e.config_id, label: label(e.label, 'WhatsApp') })
  }
  return { ok: true, selection }
}

/** Stored rows, re-checked: anything malformed is dropped, not served. */
function cleanNumbers(raw: unknown): MenuNumber[] {
  if (!Array.isArray(raw)) return []
  const out: MenuNumber[] = []
  for (const entry of raw.slice(0, MAX_MENU_NUMBERS)) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const phone = typeof e.phone === 'string' && /^\d{7,15}$/.test(e.phone) ? e.phone : null
    if (!phone) continue
    out.push({ label: label(e.label, 'Contact'), phone })
  }
  return out
}

/** What the visitor's browser gets; null when the button should simply
 *  open the chat, as before. */
export function publicContactMenu(widget: {
  contact_menu_enabled: boolean
  whatsapp_links: unknown
  call_links: unknown
  whatsapp_prefill: string | null
}): PublicContactMenu | null {
  if (!widget.contact_menu_enabled) return null
  const whatsapp = cleanNumbers(widget.whatsapp_links)
  const call = cleanNumbers(widget.call_links)
  if (whatsapp.length === 0 && call.length === 0) return null
  const prefill = widget.whatsapp_prefill?.trim().slice(0, MAX_PREFILL) || null
  return { whatsapp, call, prefill }
}
