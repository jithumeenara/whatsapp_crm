/**
 * A chatbot variable's name, as {{vars.<name>}} can read it: letters,
 * digits and _ only. People type "Course Name" or "reg-no"; the template
 * reader only matches [a-zA-Z0-9_], so a name with a space or a dash was
 * saved and then silently never filled in anywhere.
 */

const RESERVED = new Set(['trigger_message', 'trigger_type', 'trigger_channel', 'sheet_status', 'sheet_found', 'row_found'])

/** "Course Name" → "course_name"; "" when nothing usable is left. */
export function toVarKey(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export function isValidVarKey(key: string): boolean {
  return /^[a-zA-Z0-9_]{1,40}$/.test(key)
}

/** A name the chatbot fills in itself — overwriting it would be confusing. */
export function isReservedVarKey(key: string): boolean {
  return RESERVED.has(key) || /^(sheet|row|flow)_/.test(key)
}
