/**
 * The second lock against cross-site request forgery.
 *
 * The first is the session cookie's SameSite=Lax: a browser does not send
 * it with a POST that another site starts. This one does not depend on
 * cookie rules or browser versions: a signed-in request that changes
 * something must come from this app's own pages. Browsers say where a
 * request came from in `Origin` and `Sec-Fetch-Site`, which a page on
 * another site cannot forge.
 *
 * Requests without those headers (a server calling a webhook, curl, the
 * mobile app with an API key) are not browsers acting for a signed-in
 * person and are not affected. Pure: no imports, safe for the proxy.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

/** True when a signed-in, state-changing request was started by another site. */
export function isCrossSiteWrite(args: {
  method: string
  origin: string | null
  secFetchSite: string | null
  /** The host the request was made to (Host / X-Forwarded-Host). */
  requestHost: string | null
  /** NEXT_PUBLIC_APP_URL, whose host is also this app. */
  appUrl?: string | null
}): boolean {
  if (SAFE_METHODS.has(args.method.toUpperCase())) return false
  // Sec-Fetch-Site is worked out by the browser itself from the page and
  // the address it calls, so it does not depend on what Host header nginx
  // passes on (both servers proxy to localhost:3000). When a browser sends
  // it, it alone decides; the Origin comparison below is only for older
  // browsers that do not.
  const site = (args.secFetchSite ?? '').toLowerCase().trim()
  if (site === 'cross-site') return true
  // same-origin (our own page) and none (typed address, bookmark) pass.
  if (site === 'same-origin' || site === 'none') return false
  // 'same-site' is a sibling subdomain (a marketing site beside the CRM),
  // which the Lax cookie does not stop: only allowed when its Origin is
  // this app (www / bare domain), checked below like an older browser.
  if (args.origin === null || args.origin === undefined || args.origin === '') return site === 'same-site'
  if (args.origin === 'null') return true
  const from = hostOf(args.origin)
  if (!from) return true
  const own = new Set<string>()
  const req = (args.requestHost ?? '').toLowerCase().trim()
  if (req) own.add(req)
  const app = hostOf(args.appUrl)
  if (app) {
    own.add(app)
    // www and the bare domain are the same app (nginx sends one to the other).
    own.add(app.startsWith('www.') ? app.slice(4) : `www.${app}`)
  }
  return !own.has(from)
}
