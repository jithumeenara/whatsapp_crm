/**
 * Which websites a chat window may appear on.
 *
 * The business lists hostnames in Settings. They are used twice, and only
 * one of those uses is a security boundary:
 *
 *   - frame-ancestors on the chat frame. The browser enforces it: a site
 *     not on the list cannot show the window at all, whatever its script
 *     says. This is the boundary.
 *   - the Origin / Referer of requests. Anything outside a browser can
 *     send whatever it likes there, so it is a courtesy check that keeps
 *     honest mistakes out of the Inbox, never authentication.
 *
 * Pure — no imports — so the Settings screen validates with the same
 * rules the server applies.
 */

/** Longest list a widget may carry. */
export const MAX_ALLOWED_DOMAINS = 20

/**
 * One entry as somebody types it — "https://www.example.com/",
 * "Example.com", "*.example.com" — reduced to a bare lowercase hostname,
 * optionally with a leading "*." wildcard and a :port. Null when it is
 * not a hostname at all.
 */
export function normalizeDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase()
  if (!value) return null
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.replace(/[/?#].*$/, '')
  const wildcard = value.startsWith('*.')
  if (wildcard) value = value.slice(2)
  const match = /^([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?$/.exec(value)
  if (!match) return null
  const [, host, port] = match
  if (host.split('.').some((label) => !label || label.startsWith('-') || label.endsWith('-') || label.length > 63)) {
    return null
  }
  // "localhost" is fine for testing; any other bare word is a typo.
  if (!host.includes('.') && host !== 'localhost') return null
  if (port && Number(port) > 65535) return null
  return `${wildcard ? '*.' : ''}${host}${port ? `:${port}` : ''}`
}

/** Normalised, deduplicated, capped. Entries that are not hostnames are
 *  returned separately so the screen can say which ones. */
export function normalizeDomainList(raw: unknown): { domains: string[]; invalid: string[] } {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[\s,]+/)
      : []
  const domains: string[] = []
  const invalid: string[] = []
  for (const item of items) {
    if (typeof item !== 'string' || !item.trim()) continue
    const normalized = normalizeDomain(item)
    if (!normalized) invalid.push(item.trim())
    else if (!domains.includes(normalized)) domains.push(normalized)
  }
  return { domains: domains.slice(0, MAX_ALLOWED_DOMAINS), invalid }
}

/** host[:port] of an Origin or URL, lowercase; null if it is not one. */
export function hostOf(urlOrOrigin: string | null | undefined): string | null {
  if (!urlOrOrigin) return null
  try {
    const url = new URL(urlOrOrigin)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Whether a page at `host` may show the window.
 *
 * "example.com" also covers "www.example.com", because nobody listing
 * their site means to exclude its www form. "*.example.com" covers every
 * subdomain and the bare domain. A port on the entry must match exactly;
 * an entry without one matches any port.
 */
export function isHostAllowed(host: string | null, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true
  if (!host) return false
  const [hostname, port] = host.split(':')
  return allowed.some((entry) => {
    const wildcard = entry.startsWith('*.')
    const [entryHost, entryPort] = (wildcard ? entry.slice(2) : entry).split(':')
    if (entryPort && entryPort !== (port ?? '')) return false
    if (hostname === entryHost || hostname === `www.${entryHost}`) return true
    return wildcard && hostname.endsWith(`.${entryHost}`)
  })
}

/**
 * The frame-ancestors source list for a widget's allowed domains — the
 * browser-enforced half. Both schemes are listed: a site moving to https
 * should not lose its chat window, and "http:" alone would allow only
 * the insecure one.
 */
export function frameAncestors(allowed: readonly string[]): string {
  if (allowed.length === 0) return '*'
  const sources: string[] = []
  for (const entry of allowed) {
    const wildcard = entry.startsWith('*.')
    const base = wildcard ? entry.slice(2) : entry
    const hosts = wildcard ? [base, `*.${base}`] : [base, `www.${base}`]
    for (const host of hosts) {
      for (const scheme of ['https', 'http']) {
        const source = `${scheme}://${host}`
        if (!sources.includes(source)) sources.push(source)
      }
    }
  }
  return sources.join(' ')
}
