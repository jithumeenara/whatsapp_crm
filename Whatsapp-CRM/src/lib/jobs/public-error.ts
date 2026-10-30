/**
 * The words a catch-all may send back to the person who clicked.
 *
 * Many routes deliberately pass an error's message through: "This table
 * has no rows yet", "Gemini rejected the API key", "Write the template
 * first" are written for the user and are the most useful thing to show.
 * The same catch also receives library and database errors, whose text
 * names tables, columns, constraints, internal hosts and file paths —
 * nothing a user can act on, and a map for somebody probing (AGENTS.md
 * security rule 9). Those are logged and replaced with `fallback`.
 */

const INTERNAL = [
  /prisma/i,
  /invalid `[^`]*` invocation/i,
  /\b(constraint|relation|column|violates|duplicate key|syntax error at)\b/i,
  /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|ENOENT|EACCES)\b/,
  /(^|\s)(\/[\w.-]+){2,}/, // an absolute file path
  /\bat [\w.<>]+ \(/, // a stack frame
  /\b(TypeError|ReferenceError|RangeError|SyntaxError)\b/,
  /cannot read propert/i,
  /is not a function/i,
  /\bundefined\b|\bnull\b/,
]

export function publicErrorMessage(err: unknown, fallback: string, logTag?: string): string {
  const name = err instanceof Error ? err.name : ''
  const message = err instanceof Error ? err.message : ''
  const internal =
    !message ||
    message.length > 300 ||
    name.startsWith('Prisma') ||
    ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError'].includes(name) ||
    INTERNAL.some((re) => re.test(message))
  if (internal) {
    console.error(logTag ? `[${logTag}]` : '[error]', err)
    return fallback
  }
  return message
}
