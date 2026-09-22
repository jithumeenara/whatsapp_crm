import { NextRequest, NextResponse } from 'next/server'
import { clientIpKey } from '@/lib/net/client-ip'
import { makeNonce, strictCsp, reportingEndpoints } from '@/lib/security/csp'
import { getToken } from 'next-auth/jwt'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
// Auto-logout after this long with zero real user interaction (mouse,
// keyboard, touch, scroll) anywhere in the app — enforced here, not just
// client-side, since `lastActivity` lives inside the signed JWT itself and
// is only ever refreshed via an explicit session update the client fires
// on real activity (see auth.ts's jwt callback + use-idle-timeout.ts). A
// client that stopped running JS (or a stolen cookie replayed elsewhere)
// can't extend this by itself — the check below runs on every request.
//
// It is imported rather than written here because this is the number the
// presence indicator, the flow agent picker and the conversation-release
// rule all have to agree with. See the file for what went wrong when
// each of them held its own copy.
import { IDLE_TIMEOUT_MS } from '@/lib/auth/session-timing'

// Public paths that never require a session
const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/forgot-password',
  // The browser posts CSP violation reports itself, with no session —
  // it is the user agent reporting, not the application. Behind the
  // session check these would be redirected to /login and the report
  // would be an empty log that looked like a clean result, which is the
  // worst possible outcome for something whose whole purpose is to say
  // whether the strict policy is safe. Rate limited below, and the
  // route stores nothing.
  '/api/csp-report',
])

// Paths whose prefix is always public (NextAuth internals, public API)
const PUBLIC_PREFIXES = [
  '/api/auth/',
  '/api/invitations/',
  '/api/whatsapp/webhook',
  '/api/instagram/webhook',   // Meta Instagram webhook — server-to-server, no session cookie
  '/api/facebook/webhook',    // Meta Facebook Messenger webhook — server-to-server, no session cookie
  '/api/flows/data-exchange/', // Meta WhatsApp Flows data-exchange (server-to-server, RSA-encrypted)
  // Provider-secret-authenticated inbound webhooks (SMS: MSG91/TextBee,
  // Email: SendGrid Inbound Parse, RCS: Twilio) — each has its own secret
  // embedded in the URL path or a signature header verified inside the
  // route handler itself (see /api/sms/webhook/[secret]/route.ts,
  // /api/email/webhook/[secret]/route.ts, /api/rcs/webhook/route.ts). Were
  // missing from this allowlist entirely, so every request 401'd before
  // ever reaching that in-route verification — inbound SMS/Email/RCS never
  // actually worked in production.
  '/api/sms/webhook/',
  '/api/email/webhook/',
  '/api/rcs/webhook',
  // Cron sweeps — called by an external scheduler (crontab/systemd timer),
  // never by a logged-in browser. Each has its own timing-safe secret
  // check against AUTOMATION_CRON_SECRET inside the route handler itself
  // (see chatbot/cron/route.ts) — that's what actually secures these, the
  // same pattern as the webhook endpoints above.
  '/api/chatbot/cron',
  '/api/flows/cron',
  '/api/automations/cron',
  '/api/scheduled-messages/cron',
  // The voice agent asking what prompt to use for the call it has just
  // answered. Pipecat runs on its own machine and holds no session; the
  // timing-safe VOICE_AGENT_SECRET check inside the route is what secures
  // it, same as the crons above.
  '/api/voice/',
  // The MCP endpoint. No session, by design — every request carries an
  // API key this app issued, verified in the route itself. Listing it
  // here is what lets that check be the only one, rather than a second
  // gate that a non-browser client can never pass.
  '/api/mcp',
  '/_next/',
  '/favicon',
  '/icon',   // Next.js App Router favicon generator
  '/join/',  // invitation acceptance flow
]

/**
 * The unauthenticated (or cheap-to-abuse) endpoints and what each is
 * allowed. Keyed by exact path and method so a rule cannot quietly
 * widen to cover something it was never reasoned about.
 */
const AUTH_LIMITS = [
  { path: '/api/auth/callback/credentials', method: 'POST', key: 'login', rule: RATE_LIMITS.login },
  { path: '/api/auth/register', method: 'POST', key: 'register', rule: RATE_LIMITS.register },
  { path: '/api/auth/password', method: 'POST', key: 'pwchange', rule: RATE_LIMITS.passwordChange },
  { path: '/api/auth/verify-email', method: 'GET', key: 'emailverify', rule: RATE_LIMITS.emailVerify },
  { path: '/api/csp-report', method: 'POST', key: 'cspreport', rule: RATE_LIMITS.cspReport },
] as const

/**
 * Every response leaves here carrying the strict policy, in report-only
 * form.
 *
 * ── Why the wrapper, rather than editing seven return statements ────
 *
 * The routing below has seven exits — rate limited, public, API key,
 * unauthorised, idle, redirected, allowed. A header added at some of
 * them is a header missing at the others, and the ones it would be
 * missing from are exactly the interesting ones: the login redirect,
 * the 401. So the routing decides what to return and this decides what
 * every return carries, and neither can forget the other.
 *
 * See src/lib/security/csp.ts for why the strict policy is report-only
 * and what has to happen before it can enforce.
 */
export async function proxy(req: NextRequest) {
  const nonce = makeNonce()

  // Next.js reads the nonce from the request's own CSP header and
  // stamps it on the inline scripts it emits. Without this the
  // report-only policy would flag Next's own hydration script on every
  // page and drown the real findings — the report has to be about
  // Razorpay and Meta, not about the framework.
  const forwarded = new Headers(req.headers)
  forwarded.set('x-nonce', nonce)
  forwarded.set('Content-Security-Policy', strictCsp(nonce))

  const res = await route(req, forwarded)

  // Report-only, never enforcing. The policy in next.config.ts is what
  // the browser actually obeys; this one it only checks and reports on,
  // so nothing that works today can stop working because of it.
  res.headers.set('Content-Security-Policy-Report-Only', strictCsp(nonce))
  res.headers.set('Reporting-Endpoints', reportingEndpoints())
  return res
}

async function route(req: NextRequest, forwarded: Headers) {
  const { pathname } = req.nextUrl

  // ── Throttle the unauthenticated doors before anything else ──────
  //
  // These run here rather than inside each route because this is the
  // one place every request passes through, and because a limit that
  // lives in a route is a limit somebody can forget to add to the next
  // route. The login entry was already here; the other three were not,
  // and each of them is reachable without a session.
  //
  // Note the keys are prefixed per rule. Sharing one bucket across all
  // four would let a burst of signups lock a legitimate user out of
  // signing in, which is the wrong failure.
  const limited = AUTH_LIMITS.find(
    (rule) => rule.path === pathname && rule.method === req.method,
  )
  if (limited) {
    const result = checkRateLimit(
      `${limited.key}:${clientIpKey(req.headers)}`,
      limited.rule,
    )
    if (!result.success) return rateLimitResponse(result)
  }

  // Let public routes through immediately
  if (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    // Meta WhatsApp Flows webhook — server-to-server call from Meta (RSA-encrypted, no session cookie).
    // Pattern: /api/flows/{uuid}/webhook
    /^\/api\/flows\/[^/]+\/webhook$/.test(pathname)
  ) {
    return NextResponse.next({ request: { headers: forwarded } })
  }

  // API key auth — let Bearer wcrm_ requests pass through to the route handler.
  // The route handler (requireRoleOrApiKey) performs the actual key verification
  // against the database; the middleware only skips the session check here.
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Bearer wcrm_')) {
    return NextResponse.next({ request: { headers: forwarded } })
  }

  // Inbound webhook uses its own secret token in the query string
  if (pathname === '/api/external/webhook') {
    return NextResponse.next({ request: { headers: forwarded } })
  }

  // Verify session via JWT (Edge-safe — no Prisma required)
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName:
      process.env.NODE_ENV === 'production'
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token',
  })

  if (!token?.id) {
    // API routes → 401 JSON (clients handle this)
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Page routes → redirect to login, preserving destination
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Idle timeout — lastActivity is seeded at sign-in and only moves forward
  // via an explicit client-triggered session update, so this reflects real
  // inactivity, not just "the tab is open." Missing entirely on an older
  // token (issued before this feature existed) falls back to `iat` so a
  // pre-existing session doesn't get treated as infinitely fresh.
  const lastActivity =
    typeof token.lastActivity === 'number' ? token.lastActivity : (token.iat ?? 0) * 1000
  if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
    const cookieName =
      process.env.NODE_ENV === 'production' ? '__Secure-authjs.session-token' : 'authjs.session-token'
    if (pathname.startsWith('/api/')) {
      const res = NextResponse.json({ error: 'Session expired due to inactivity' }, { status: 401 })
      res.cookies.delete(cookieName)
      return res
    }
    const loginUrl = req.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('callbackUrl', pathname)
    loginUrl.searchParams.set('reason', 'idle')
    const res = NextResponse.redirect(loginUrl)
    res.cookies.delete(cookieName)
    return res
  }

  return NextResponse.next({ request: { headers: forwarded } })
}

export const config = {
  // Run on all routes except static assets.
  //
  // `audio/` is excluded because the live voice console loads an
  // AudioWorklet module from /public/audio. Anything under /public that
  // is not an image was being matched and redirected to /login, and a
  // worklet module handed a redirect fails as an AbortError — surfacing
  // as "the microphone stopped responding", which points nowhere near an
  // auth matcher. The file carries no data and needs no session.
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|audio/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
