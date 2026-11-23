/**
 * Is this a phone number? Is this an email address?
 *
 * Shared by the contact forms and the contact APIs, so the screen and the
 * server refuse the same things. Nothing checked either before: a contact
 * could be saved with "email:someone@x.com" or "abc" as its phone, and a
 * WhatsApp send to it failed later, far from where it was typed.
 *
 * Pure — no imports — so it runs in the browser as well.
 */

/** Email-only contacts carry "email:<address>" in `phone`, because the
 *  column cannot be empty and is the contact's identity. Not a number:
 *  it is never shown, called or validated as one. */
export function isEmailPlaceholderPhone(phone: string | null | undefined): boolean {
  return typeof phone === 'string' && phone.startsWith('email:')
}

/** Any contact whose `phone` is not a phone number: email-only contacts
 *  ("email:<address>") and website chat visitors ("web:<visitor id>",
 *  migration 130) and Telegram users who have not shared a number
 *  ("tg:<telegram id>", migration 140). Use this, not a prefix check, wherever a number is
 *  shown, dialled, messaged or exported. */
export function isPlaceholderPhone(phone: string | null | undefined): boolean {
  return typeof phone === 'string' && (phone.startsWith('email:') || phone.startsWith('web:') || phone.startsWith('tg:'))
}

type PlatformIds = { phone?: string | null; facebook_id?: string | null; instagram_id?: string | null }

/**
 * A Messenger / Instagram contact keeps its Meta id in the phone field —
 * not a number anyone can call. True when the phone is that id, or longer
 * than any real number (E.164 allows at most 15 digits).
 */
export function isPlatformIdPhone(contact: PlatformIds | null | undefined): boolean {
  const p = contact?.phone
  if (!p || !/^\d+$/.test(p)) return false
  return p.length > 15 || p === contact?.facebook_id || p === contact?.instagram_id
}

/** "Messenger ID" / "Instagram ID" for such a contact. */
export function platformIdLabel(contact: PlatformIds | null | undefined): string {
  if (contact?.phone && contact.phone === contact.instagram_id) return 'Instagram ID'
  if (contact?.phone && contact.phone === contact.facebook_id) return 'Messenger ID'
  return 'Messenger / Instagram ID'
}

/**
 * The number to call or put on a registration: the contact's own phone
 * when it is one, otherwise the alternate a website visitor typed in
 * (src/lib/contacts/update-field.ts). Null when there is neither.
 */
export function usablePhone(contact: { phone?: string | null; alternate_phone?: string | null; facebook_id?: string | null; instagram_id?: string | null } | null | undefined): string | null {
  if (!contact) return null
  if (contact.phone && !isPlaceholderPhone(contact.phone) && !isPlatformIdPhone(contact)) return contact.phone
  return contact.alternate_phone?.trim() || null
}

export type Checked = { ok: true; value: string } | { ok: false; error: string }

/**
 * A phone number as people type it — "+91 98765 43210", "(0484) 123-4567",
 * "919876543210" — reduced to +digits or digits, and accepted when it has
 * 7 to 15 digits (E.164's range) and does not start with 0 after any +.
 */
export function checkPhone(raw: string): Checked {
  const typed = raw.trim()
  if (!typed) return { ok: false, error: 'Enter a phone number.' }
  if (/[^\d+\s\-().]/.test(typed)) {
    return { ok: false, error: 'A phone number can only have digits, spaces, +, - and brackets.' }
  }
  const plus = typed.startsWith('+')
  const digits = typed.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) {
    return { ok: false, error: 'A phone number has 7 to 15 digits, with the country code — e.g. +91 98765 43210.' }
  }
  if (plus && digits.startsWith('0')) {
    return { ok: false, error: 'After +, the country code cannot start with 0.' }
  }
  return { ok: true, value: plus ? `+${digits}` : digits }
}

/** An email address, trimmed and lowercased (rule 8 — case never makes
 *  two addresses different). */
export function checkEmail(raw: string): Checked {
  const typed = raw.trim().toLowerCase()
  if (!typed) return { ok: false, error: 'Enter an email address.' }
  if (typed.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(typed) || typed.includes('..')) {
    return { ok: false, error: 'That is not a valid email address — e.g. name@example.com.' }
  }
  return { ok: true, value: typed }
}
