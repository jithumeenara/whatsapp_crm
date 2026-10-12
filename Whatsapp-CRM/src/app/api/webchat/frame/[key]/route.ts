import { isPublicKeyShape } from '@/lib/webchat/tokens'
import { loadEnabledWidget } from '@/lib/webchat/session'
import { frameAncestors, hostOf, isHostAllowed } from '@/lib/webchat/domains'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import { WEBCHAT_LIMITS, ipKey, limit } from '@/lib/webchat/http'

/**
 * GET /api/webchat/frame/:key — the chat window itself, as a page inside
 * an iframe on the business's website. Public.
 *
 * ── Why a frame ───────────────────────────────────────────────────────
 *
 * The visitor's session token lives in this frame's storage, on this
 * app's origin. Script on the host page — the business's own, or any
 * plugin it runs, compromised or not — cannot read it, nor the
 * conversation. And the frame-ancestors header below is the one domain
 * check a browser enforces: a site that is not on the widget's list
 * cannot show this page at all.
 *
 * Plain HTML and two static files (public/webchat/), not a React page:
 * it loads on every visitor's first click, on other people's websites,
 * often on a phone, and needs none of the app.
 */

export const dynamic = 'force-dynamic'

function page(body: string, status: number, headers: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
}

function csp(ancestors: string, origin: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    'img-src https: data:',
    // Same-origin XHR and the socket; ws(s) of this host is covered by
    // 'self' in CSP3, the explicit entries are for older engines.
    `connect-src 'self' ${origin.replace(/^http/, 'ws')}`,
    // 'self' too, for the live preview in Settings.
    `frame-ancestors ${ancestors === '*' || ancestors === "'none'" ? ancestors : `'self' ${ancestors}`}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}

const NOT_AVAILABLE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Chat unavailable</title></head>
<body style="font-family:system-ui,sans-serif;color:#475569;padding:24px">This chat is not available here.</body></html>`

export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const limited = limit(`frame:${ipKey(req)}`, WEBCHAT_LIMITS.configPerIp)
  if (limited) return limited

  const origin = publicOrigin(req)
  const { key } = await params
  if (!isPublicKeyShape(key)) return page(NOT_AVAILABLE, 404, { 'Content-Security-Policy': csp("'none'", origin) })
  const widget = await loadEnabledWidget(key)
  if (!widget) return page(NOT_AVAILABLE, 404, { 'Content-Security-Policy': csp("'none'", origin) })

  // The Referer of a framed page is the page framing it. Not proof of
  // anything — frame-ancestors is the check — but it lets a wrong site
  // get a plain "not available" instead of a broken frame.
  const referer = req.headers.get('referer')
  const refererHost = hostOf(referer)
  if (refererHost && refererHost !== hostOf(origin) && !isHostAllowed(refererHost, widget.allowed_domains)) {
    return page(NOT_AVAILABLE, 403, { 'Content-Security-Policy': csp("'none'", origin) })
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Chat</title>
<link rel="stylesheet" href="/webchat/frame.css">
</head>
<body>
<div id="app" data-key="${key}"></div>
<script src="/socket.io/socket.io.min.js"></script>
<script src="/webchat/format.js"></script>
<script src="/webchat/frame.js"></script>
</body>
</html>`

  return page(html, 200, {
    'Content-Security-Policy': csp(frameAncestors(widget.allowed_domains), origin),
    'Referrer-Policy': 'no-referrer',
  })
}
