import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { botForAccount } from '@/lib/telegram/store'
import { fileDownloadUrl, TelegramApiError } from '@/lib/telegram/api'

/**
 * A photo or file a customer sent on Telegram, for the Inbox.
 *
 * Telegram's own file address carries the bot token, so it never reaches
 * a browser: the file is fetched here and passed through. Only messages
 * of the caller's own account.
 */

export const dynamic = 'force-dynamic'

/** What Telegram gives a bot to download. */
const MAX_FILE = 20 * 1024 * 1024

export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { messageId } = await params
    if (!/^[0-9a-f-]{36}$/i.test(messageId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const message = await prisma.message.findFirst({
      where: { id: messageId, conversation: { account_id: ctx.accountId, channel: 'telegram' } },
      select: { telegram_meta: true, media_mime_type: true, media_filename: true },
    })
    const fileId = (message?.telegram_meta as { file_id?: unknown } | null)?.file_id
    if (!message || typeof fileId !== 'string') return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const bot = await botForAccount(ctx.accountId)
    if (!bot) return NextResponse.json({ error: 'Telegram is not connected, so this file cannot be opened.' }, { status: 409 })

    let file: { url: string; size: number | null }
    try {
      file = await fileDownloadUrl(bot.token, fileId)
    } catch (err) {
      console.error('[telegram media] getFile failed:', err)
      const msg = err instanceof TelegramApiError ? err.message : 'Could not get the file from Telegram.'
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    if (file.size && file.size > MAX_FILE) {
      return NextResponse.json({ error: 'This file is larger than 20 MB — Telegram does not give it to bots. Ask the customer to send it another way.' }, { status: 413 })
    }

    const upstream = await fetch(file.url, { signal: AbortSignal.timeout(60_000) }).catch(() => null)
    if (!upstream?.ok || !upstream.body) {
      return NextResponse.json({ error: 'Could not download the file from Telegram.' }, { status: 502 })
    }
    const type = message.media_mime_type || upstream.headers.get('content-type') || 'application/octet-stream'
    const name = (message.media_filename || 'file').replace(/["\r\n]/g, '')
    return new Response(upstream.body, {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `inline; filename="${encodeURIComponent(name)}"`,
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
        ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length')! } : {}),
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
