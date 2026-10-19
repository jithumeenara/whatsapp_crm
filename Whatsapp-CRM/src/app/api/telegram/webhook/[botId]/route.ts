import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { botById } from '@/lib/telegram/store'
import { handleTelegramUpdate } from '@/lib/telegram/inbound'

/**
 * Telegram → CRM. One address per bot (/api/telegram/webhook/<bot id>),
 * set by Settings → Channels → Telegram with a random secret that
 * Telegram sends back in X-Telegram-Bot-Api-Secret-Token. Public (no
 * login) — so the secret is checked before anything is read, and only
 * POST exists here: a GET answers 405 and shows nothing.
 *
 * Answers 200 at once and works after, like the Meta webhooks: Telegram
 * re-sends an update it waited too long for, and the dedupe on the
 * message id makes a re-send harmless anyway.
 */

export const dynamic = 'force-dynamic'

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export async function POST(req: Request, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params
  const bot = await botById(botId).catch((err) => {
    console.error('[telegram webhook] bot lookup failed:', err)
    return null
  })
  const secret = req.headers.get('x-telegram-bot-api-secret-token') ?? ''
  if (!bot || !secret || !sameSecret(secret, bot.webhookSecret)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let update: unknown
  try {
    const raw = await req.text()
    if (raw.length > 1_000_000) return NextResponse.json({ ok: true })
    update = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: true })
  }

  handleTelegramUpdate(bot, update).catch((err) => console.error('[telegram webhook] update failed:', err))
  return NextResponse.json({ ok: true })
}
