/**
 * Blocks the "custom" AI provider's user-supplied base_url (and any other
 * provider's baseUrl override) from pointing at internal infrastructure —
 * a live SSRF risk, since this app's own server process makes the
 * outbound request and echoes the response (or its error message) back
 * to whichever authenticated user configured/tested it. Cloud metadata
 * endpoints (169.254.169.254 for AWS/GCP/Azure instance credentials) and
 * private/loopback ranges are the highest-value targets for this class
 * of bug.
 *
 * Deliberately scoped: this blocks the obvious cases (literal private/
 * loopback/link-local IPs, non-http(s) schemes, bare `localhost`). It
 * does NOT resolve-then-pin the hostname, so a DNS-rebinding attack
 * (a public hostname that resolves to a private IP at request time)
 * would still get through — full protection needs a custom fetch
 * dispatcher that validates the resolved IP, not just the literal
 * string, which isn't implemented here. Combined with the role gates
 * added alongside this (only account owners can set a custom base_url
 * at all), this raises the bar without claiming to fully close it.
 */
export function assertSafeAiBaseUrl(rawUrl: string): void {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('base_url is not a valid URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('base_url must use http or https.')
  }

  const host = url.hostname.toLowerCase()

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('base_url cannot point at localhost.')
  }

  // IPv6 loopback / link-local / unique-local.
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    throw new Error('base_url cannot point at a private/internal address.')
  }

  // IPv4 literal — check private/loopback/link-local ranges, including
  // 169.254.169.254 (AWS/GCP/Azure instance metadata — the classic SSRF
  // payload target).
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    const isPrivate =
      a === 127 || // loopback
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) || // 169.254.0.0/16 (link-local + cloud metadata)
      a === 0
    if (isPrivate) {
      throw new Error('base_url cannot point at a private/internal address.')
    }
  }
}
