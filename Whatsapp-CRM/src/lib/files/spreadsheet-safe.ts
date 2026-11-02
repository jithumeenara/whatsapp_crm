/**
 * Text that came from people, made safe to put in a spreadsheet export.
 *
 * A value beginning with = + - @, tab or carriage return gets a leading
 * apostrophe, so no spreadsheet program — or a CSV someone saves from the
 * file later — reads it as a formula (OWASP "CSV Injection", CWE-1236).
 */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}
