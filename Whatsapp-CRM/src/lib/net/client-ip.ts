/**
 * Who is actually talking to us.
 *
 * ── Why this is not as simple as reading a header ───────────────────
 *
 * Every rate limit in this app is keyed by client IP, and so is every
 * "signed in from" row a user sees on their Sessions screen. Both are
 * only as good as the answer here, and the obvious answer is wrong.
 *
 * The app sits behind nginx, configured like this:
 *
 *     proxy_set_header X-Real-IP        $remote_addr;
 *     proxy_set_header X-Forwarded-For  $proxy_add_x_forwarded_for;
 *
 * `$proxy_add_x_forwarded_for` expands to "<whatever the client sent>,
 * <the real peer address>". The part the client sent comes FIRST. So
 * reading `xff.split(',')[0]` — which is what every call site in this
 * app used to do — returns a value the caller chose for themselves.
 *
 * That is not a cosmetic bug. It means anyone can send
 *
 *     X-Forwarded-For: 203.0.113.<random>
 *
 * on each request and appear as a new client every time, which defeats
 * the login limiter, the MFA limiter and the invitation limiters
 * completely: unlimited password guesses and unlimited TOTP guesses,
 * with a different forged address in the log for each one.
 *
 * ── What is trustworthy ─────────────────────────────────────────────
 *
 * `X-Real-IP`. nginx *sets* it rather than appending to it, so whatever
 * a client puts there is overwritten before the app ever sees it. It is
 * the address nginx accepted the connection from, and a caller cannot
 * change it.
 *
 * `X-Forwarded-For` is still useful, but only from the right end: the
 * LAST entry is the one our own nginx appended. Everything before it is
 * hearsay from the client. So the fallback reads the last element, not
 * the first.
 *
 * ── The limit of all this ───────────────────────────────────────────
 *
 * Every word above assumes the request came through nginx. If the Node
 * server's port is reachable from the internet directly, an attacker
 * talks to it without a proxy and every header here is theirs to write,
 * including X-Real-IP. Binding the app to localhost and keeping the
 * port closed at the firewall is what makes this module meaningful —
 * no amount of parsing can substitute for it.
 */

/** A header bag — `Request.headers`, `NextRequest.headers`, both fit. */
interface HeaderReader {
  get(name: string): string | null
}

/**
 * The client's address, or null when there is no trustworthy answer.
 *
 * Callers that need a rate-limit key should use {@link clientIpKey},
 * which never returns null — an absent address must still be limited,
 * not waved through.
 */
export function clientIp(headers: HeaderReader): string | null {
  // Set by nginx, not appended to. A caller cannot forge this.
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real

  // No X-Real-IP: read the last hop, which is the entry our own proxy
  // added. Never the first — that is the caller's own text.
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean)
    const nearest = hops[hops.length - 1]
    if (nearest) return nearest
  }

  return null
}

/**
 * The same address, as a rate-limit bucket key.
 *
 * An unknown address collapses to one shared bucket rather than an
 * exemption. That is deliberate: if the proxy is ever misconfigured,
 * the failure should be "everyone shares one limit", which is annoying,
 * and never "nobody is limited", which is a door left open.
 */
export function clientIpKey(headers: HeaderReader): string {
  return clientIp(headers) ?? 'unknown'
}
