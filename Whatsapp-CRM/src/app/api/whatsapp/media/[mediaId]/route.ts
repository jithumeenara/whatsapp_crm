import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * Media WhatsApp has permanently expired (Graph API error code 100.33 —
 * "Object does not exist") never becomes available again on retry; it's
 * gone from Meta's servers for good. Without this, every re-render/re-open
 * of a conversation containing old media re-hits the Graph API for the
 * same known-dead ID, spamming logs and burning API calls for nothing.
 * In-memory + per-process is fine here: worst case after a restart is one
 * extra real (still-failing) Meta call per dead ID before it's re-cached.
 */
const DEAD_MEDIA_TTL_MS = 24 * 60 * 60 * 1000
const deadMediaCache = new Map<string, number>()

function isPermanentlyGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('(code 100.33)') || message.includes('does not exist')
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    const userId = session.user.id

    // Short-circuit known-dead media before touching the DB or Meta's API.
    const failedAt = deadMediaCache.get(mediaId)
    if (failedAt !== undefined) {
      if (Date.now() - failedAt < DEAD_MEDIA_TTL_MS) {
        return NextResponse.json(
          { error: 'This media has expired and is no longer available from WhatsApp.' },
          { status: 404 }
        )
      }
      deadMediaCache.delete(mediaId) // TTL elapsed — allow one more real check
    }

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account, so a teammate fetching media for a conversation in the
    // shared inbox needs the account's config, not a personal row.
    const profile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true },
    })
    const accountId = profile?.account_id
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // Fetch and decrypt WhatsApp config
    const config = await prisma.whatsAppConfig.findUnique({
      where: { account_id: accountId },
    })

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Get the download URL from Meta
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    const { mediaId } = await params
    if (isPermanentlyGone(error)) {
      // Only log the first time — every subsequent hit for this ID is
      // served from the cache above and doesn't reach this catch block.
      if (!deadMediaCache.has(mediaId)) {
        console.warn(`WhatsApp media ${mediaId} has expired (code 100.33) — caching as unavailable for 24h.`)
      }
      deadMediaCache.set(mediaId, Date.now())
      return NextResponse.json(
        { error: 'This media has expired and is no longer available from WhatsApp.' },
        { status: 404 }
      )
    }
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
