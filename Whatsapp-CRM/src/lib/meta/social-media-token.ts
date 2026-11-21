/**
 * A short-lived public link to ONE uploaded picture or video, for Instagram
 * to fetch while publishing (Instagram takes media only by URL, and our own
 * /api/files needs a login).
 *
 * The link is signed with a key derived for this purpose alone, names one
 * file inside the workspace's own upload folder, and expires after 30
 * minutes. The serving route re-checks everything (signature, expiry,
 * folder, real type from the bytes) — the token is never trusted alone.
 * Free of next/server: the publishing job imports it.
 */

import crypto from 'crypto'

export const MEDIA_TOKEN_TTL_MS = 30 * 60_000
export const MEDIA_ROUTE = '/api/social/media/'

/** Picture / video types Meta can publish, by file extension. */
export const PUBLISHABLE_TYPES: Record<string, { mime: string; kind: 'image' | 'video' }> = {
  jpg: { mime: 'image/jpeg', kind: 'image' },
  jpeg: { mime: 'image/jpeg', kind: 'image' },
  png: { mime: 'image/png', kind: 'image' },
  mp4: { mime: 'video/mp4', kind: 'video' },
  mov: { mime: 'video/quicktime', kind: 'video' },
}

export function publishableType(link: string): { mime: string; kind: 'image' | 'video' } | null {
  const ext = link.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  return PUBLISHABLE_TYPES[ext] ?? null
}

function key(): Buffer {
  const value = process.env.NEXTAUTH_SECRET ?? process.env.ENCRYPTION_KEY
  if (!value) throw new Error('No signing secret is configured.')
  return crypto.createHash('sha256').update(`${value}:social-publish-media`).digest()
}

interface MediaToken { a: string; l: string; e: number }

/** Our upload link (/api/files/account-<id>/...) only. */
const UPLOAD_LINK = /^\/api\/files\/account-[0-9a-f-]{36}\/[^?#]{1,300}$/i

export function signMediaToken(accountId: string, link: string, now = Date.now()): string {
  if (!UPLOAD_LINK.test(link) || !link.startsWith(`/api/files/account-${accountId}/`)) throw new Error('Not this workspace\'s upload.')
  const encoded = Buffer.from(JSON.stringify({ a: accountId, l: link, e: now + MEDIA_TOKEN_TTL_MS } satisfies MediaToken)).toString('base64url')
  const signature = crypto.createHmac('sha256', key()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

/** Null for anything that fails, without saying which check failed. */
export function verifyMediaToken(token: unknown, now = Date.now()): { accountId: string; link: string } | null {
  try {
    if (typeof token !== 'string' || token.length > 1500) return null
    const [encoded, signature, extra] = token.split('.')
    if (!encoded || !signature || extra !== undefined) return null
    const expected = crypto.createHmac('sha256', key()).update(encoded).digest('base64url')
    const a = Buffer.from(signature)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    const body = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MediaToken
    if (typeof body.e !== 'number' || body.e < now) return null
    if (typeof body.a !== 'string' || typeof body.l !== 'string') return null
    if (!UPLOAD_LINK.test(body.l) || !body.l.startsWith(`/api/files/account-${body.a}/`)) return null
    return { accountId: body.a, link: body.l }
  } catch {
    return null
  }
}

/** This server's public https address (Meta must reach it), or null. */
export function publicOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || ''
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/** The full public URL for Instagram to fetch, or null without https. */
export function publicMediaUrl(accountId: string, link: string, now = Date.now()): string | null {
  const origin = publicOrigin()
  if (!origin) return null
  return `${origin}${MEDIA_ROUTE}${signMediaToken(accountId, link, now)}`
}
