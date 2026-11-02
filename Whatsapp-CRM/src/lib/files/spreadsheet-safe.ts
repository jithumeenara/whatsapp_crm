/**
 * Text that came from people, made safe to put in a spreadsheet export.
 *
 * A value beginning with = + - @, tab or carriage return gets a leading
 * apostrophe, so no spreadsheet program — or a CSV someone saves from the
 * file later — reads it as a formula (OWASP "CSV Injection", CWE-1236).
 * Leading spaces or tabs do not hide one (some programs trim them before
 * parsing), and neither do the full-width forms ＝ ＋ － ＠, which some
 * programs fold to their ASCII twins.
 */
const FORMULA_START = /^(?:[\t\r]|[ \t]*[=+\-@＝＋－＠])/

export function safeText(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}
