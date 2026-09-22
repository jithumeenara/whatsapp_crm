import { NextResponse, type NextRequest } from 'next/server'

/**
 * Where the browser says what the strict policy would have blocked.
 *
 * ── Why this exists ─────────────────────────────────────────────────
 *
 * The app's enforcing CSP allows `script-src 'unsafe-inline'`, which is
 * the one thing CSP is mostly for removing. It cannot simply be deleted:
 * the page loads Razorpay's checkout and Meta's JS SDK, and whether
 * either needs to run an inline script is not answerable by reading
 * this codebase. Getting it wrong means a payment page that fails to
 * open on a live CRM.
 *
 * So the strict policy is sent alongside as report-only, and every
 * browser that loads a page checks it and posts here whatever it would
 * have stopped — while stopping nothing. After a few days of ordinary
 * use, including one real payment and one Embedded Signup, the log is
 * the answer: an empty log means the strict policy is safe to enforce;
 * a full one names the exact directive and source to allow instead.
 *
 * ── Why it is public, and what that means ───────────────────────────
 *
 * The browser posts these with no session — it is the user agent
 * reporting, not the application. So this route is unauthenticated by
 * necessity, which makes it something anyone can post to. It is
 * therefore written to be useless to abuse: it stores nothing, it reads
 * a bounded number of bytes, it writes a handful of known fields to the
 * log and discards the rest, and it never reflects the input back.
 *
 * Rate limiting lives in the proxy alongside the other public doors.
 */

/** Plenty for a real report; a ceiling on anything else. */
const MAX_BYTES = 8 * 1024

/** Only what identifies a violation. Anything else is discarded. */
interface Violation {
  'document-uri'?: unknown
  'violated-directive'?: unknown
  'effective-directive'?: unknown
  'blocked-uri'?: unknown
  'script-sample'?: unknown
  'source-file'?: unknown
  'line-number'?: unknown
}

/** One short line, never the caller's text verbatim at length. */
function trim(value: unknown, max = 200): string {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return ''
  return value.slice(0, max).replace(/[\r\n]+/g, ' ')
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text()
    // A body past the ceiling is not a report. Refuse it without
    // parsing — parsing is the expensive part.
    if (raw.length > MAX_BYTES) return new NextResponse(null, { status: 413 })

    const body: unknown = JSON.parse(raw)

    // Two wire formats are in use. The old one posts
    // { "csp-report": {...} }; the Reporting API posts an array of
    // { type, body }. Both are handled because browsers disagree about
    // which to send and a report that arrives in the wrong shape is a
    // report nobody reads.
    const reports: Violation[] = Array.isArray(body)
      ? body
          .filter((r): r is { type?: string; body?: Violation } => !!r && typeof r === 'object')
          .filter((r) => r.type === undefined || r.type === 'csp-violation')
          .map((r) => r.body ?? {})
      : [((body as { 'csp-report'?: Violation })?.['csp-report'] ?? body) as Violation]

    for (const r of reports.slice(0, 10)) {
      const directive = trim(r['effective-directive'] ?? r['violated-directive'], 60)
      // Prefixed so it can be grepped out of pm2's log in one command.
      console.warn(
        '[csp-report]',
        JSON.stringify({
          directive,
          blocked: trim(r['blocked-uri'], 200),
          page: trim(r['document-uri'], 200),
          source: trim(r['source-file'], 200),
          line: trim(r['line-number'], 10),
          // The first characters of the offending script, which is what
          // identifies whose code it was. Short on purpose: it is
          // attacker-influenceable text on an unauthenticated route.
          sample: trim(r['script-sample'], 120),
        }),
      )
    }

    // 204: the browser is not waiting for anything, and a body would
    // only be something to reflect.
    return new NextResponse(null, { status: 204 })
  } catch {
    // Malformed input is the normal case for a public endpoint and is
    // not worth a log line of its own.
    return new NextResponse(null, { status: 204 })
  }
}
