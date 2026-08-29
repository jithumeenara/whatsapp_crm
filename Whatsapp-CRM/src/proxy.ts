import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

// Auto-logout after this long with zero real user interaction (mouse,
// keyboard, touch, scroll) anywhere in the app — enforced here, not just
// client-side, since `lastActivity` lives inside the signed JWT itself and
// is only ever refreshed via an explicit session update the client fires
// on real activity (see auth.ts's jwt callback + use-idle-timeout.ts). A
// client that stopped running JS (or a stolen cookie replayed elsewhere)
// can't extend this by itself — the check below runs on every request.
const IDLE_TIMEOUT_MS = 10 * 60_000

// Public paths that never require a session
const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/forgot-password',
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
  '/_next/',
  '/favicon',
  '/icon',   // Next.js App Router favicon generator
  '/join/',  // invitation acceptance flow
]

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Rate-limit login attempts before anything else
  if (pathname === '/api/auth/callback/credentials' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown'
    const result = checkRateLimit(`login:${ip}`, RATE_LIMITS.login)
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
    return NextResponse.next()
  }

  // API key auth — let Bearer wcrm_ requests pass through to the route handler.
  // The route handler (requireRoleOrApiKey) performs the actual key verification
  // against the database; the middleware only skips the session check here.
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Bearer wcrm_')) {
    return NextResponse.next()
  }

  // Inbound webhook uses its own secret token in the query string
  if (pathname === '/api/external/webhook') {
    return NextResponse.next()
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

  return NextResponse.next()
}

export const config = {
  // Run on all routes except static assets
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
