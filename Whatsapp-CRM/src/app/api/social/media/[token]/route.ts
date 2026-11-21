import { readFile, stat } from 'fs/promises'
import { uploadPathFor } from '@/lib/whatsapp/media-ref'
import { contentMatchesType } from '@/lib/files/account-files'
import { publishableType, verifyMediaToken } from '@/lib/meta/social-media-token'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * GET /api/social/media/<token> — PUBLIC (no session), for Meta's servers to
 * fetch one picture / video while publishing to Instagram.
 *
 * Everything is checked here, not trusted from the token alone: signature
 * and 30-minute expiry; the file must be inside that workspace's own upload
 * folder (old shared-folder files are refused); only JPEG / PNG / MP4 / MOV,
 * with the real type checked from the bytes; at most 100 MB. GET only (no
 * other method is exported). Nothing about the workspace is in the reply.
 */

const MAX_BYTES = 100 * 1024 * 1024

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const limit = checkRateLimit(`social-media:${token.slice(-24)}`, { limit: 30, windowMs: 60_000 })
  if (!limit.success) return new Response('Too many requests', { status: 429 })

  const ticket = verifyMediaToken(token)
  if (!ticket) return notFound()
  const type = publishableType(ticket.link)
  if (!type) return notFound()

  let filePath: string
  try {
    filePath = uploadPathFor(ticket.link, ticket.accountId)
  } catch {
    return notFound()
  }
  try {
    const info = await stat(filePath)
    if (!info.isFile() || info.size === 0 || info.size > MAX_BYTES) return notFound()
    const bytes = await readFile(filePath)
    if (!contentMatchesType(type.mime, bytes)) return notFound()
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': type.mime,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'",
      },
    })
  } catch {
    return notFound()
  }
}
