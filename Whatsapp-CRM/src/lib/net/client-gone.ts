/**
 * Telling "the caller hung up" apart from "we have a bug".
 *
 * ── Why this distinction has to exist ───────────────────────────────
 *
 * A browser abandons requests constantly and legitimately: the agent
 * clicks a second contact before the first thread has loaded, a phone
 * loses signal mid-reply, somebody closes a tab. Node reports each of
 * these by emitting an error on the request — and when nothing is
 * listening for it, that error reaches `process.on('uncaughtException')`.
 *
 * The production log showed exactly that:
 *
 *     [uncaughtException] Error: aborted
 *         at abortIncoming (node:_http_server:796:17)
 *       code: 'ECONNRESET'
 *
 * Two things are wrong with that. The smaller one is noise — a normal
 * click looks like a crash, so the log stops being worth reading and a
 * real fault hides among the aborts.
 *
 * The larger one is that `uncaughtException` is the wrong destination.
 * Node's own guidance is that after an uncaught exception the process
 * state can no longer be trusted, because whatever was half-done stays
 * half-done. This app's handler logs and carries on, which is the only
 * survivable choice while ordinary disconnects arrive there — it cannot
 * exit on something that happens whenever a customer's signal drops.
 * So the handler has to be lenient, which means a genuine bug gets the
 * same shrug as a dropped connection.
 *
 * Naming the disconnects is what breaks that deadlock. Once they are
 * handled where they happen, the catch-all sees only surprises, and a
 * surprise can be treated like one.
 */

/**
 * Error codes that mean the other end is gone.
 *
 * Deliberately a short, closed list. A broad match — anything whose
 * message contains "aborted", say — would eventually swallow a real
 * fault that happened to be worded similarly, and a swallowed fault in
 * a CRM is a message that silently never sent.
 */
const CLIENT_GONE_CODES: ReadonlySet<string> = new Set([
  // The peer reset the connection. By far the most common: a tab
  // closing, a navigation, a mobile handover between towers.
  'ECONNRESET',
  // The connection was aborted before it was fully established.
  'ECONNABORTED',
  // We were writing to a socket nobody is reading any more.
  'EPIPE',
  // A stream ended before it said it would — the same event seen from
  // the stream layer rather than the socket.
  'ERR_STREAM_PREMATURE_CLOSE',
])

/**
 * True when this error is a caller who left, and not a defect.
 *
 * Reads `code` rather than the message, because the code is what Node
 * sets deliberately and the message is prose that changes between
 * versions.
 */
export function isClientGone(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' && CLIENT_GONE_CODES.has(code)
}
