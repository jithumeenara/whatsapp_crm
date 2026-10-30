import { isIP } from 'node:net'
import { isBlockedAddress } from '@/lib/net/safe-fetch'

/**
 * A fast, synchronous first look at a URL somebody typed — the custom AI
 * provider's base_url, a knowledge-base website — before the server
 * fetches it.
 *
 * This is NOT the control. The control is `safeFetch` in
 * `@/lib/net/safe-fetch`, which every such request now goes through: it
 * checks the address the socket actually connects to (so DNS rebinding
 * and a public name with a private A record are both refused) and
 * re-checks every redirect hop. This function only refuses what can be
 * refused without DNS, so a bad base_url fails with a clear message at
 * once rather than at the first customer reply.
 *
 * It used to be the only check, and had two holes beyond the ones its
 * comment admitted: the URL parser keeps IPv6 hosts in brackets
 * ("[::1]"), which no comparison here matched, and IPv4 written inside
 * IPv6 ("[::ffff:169.254.169.254]") was never looked at. The address
 * rules now come from the central client, so there is one list.
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

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('base_url cannot point at localhost.')
  }

  if (isIP(host) && isBlockedAddress(host)) {
    throw new Error('base_url cannot point at a private/internal address.')
  }
}

/**
 * The URL's own port, plus the usual two, for safeFetch's allow-list. A
 * self-hosted model server or a webhook receiver on :8000 is ordinary;
 * the address check still applies whatever the port.
 */
export function portsFor(rawUrl: string): number[] {
  const ports = [80, 443]
  try {
    const p = Number(new URL(rawUrl).port)
    if (p > 0 && !ports.includes(p)) ports.push(p)
  } catch {
    // safeFetch reports the bad URL itself
  }
  return ports
}
