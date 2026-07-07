import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

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

  return NextResponse.next()
}

export const config = {
  // Run on all routes except static assets
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
