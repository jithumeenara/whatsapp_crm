import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import { checkRateLimit } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { getMe, setWebhook, deleteWebhook, TelegramApiError } from '@/lib/telegram/api'
import { startLink } from '@/lib/telegram/links'
import { AI_AUTO_REPLY_SOURCE } from '@/lib/ai/auto-reply'

/**
 * Settings → Channels → Telegram. Admins only.
 *
 * GET     the bot (never its token), the last 30 days, whether the
 *         assistant answers Telegram, and Telegram Business connections.
 * POST    { token } connect (or replace) the bot: checked with getMe,
 *         stored encrypted, webhook pointed at this site with a fresh
 *         secret. { reconnect: true } re-points the webhook only.
 * PUT     { ai_auto_reply: boolean } add or remove 'telegram' from the
 *         channels the assistant answers.
 * DELETE  disconnect: the webhook is removed and the bot switched off.
 *         Chats and contacts stay.
 */

export const dynamic = 'force-dynamic'

const DAY = 24 * 60 * 60 * 1000
/** BotFather's token shape: <bot id>:<35-ish characters>. */
const TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/

function channelsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : ['whatsapp']
}

function webhookUrl(origin: string, botId: string): string {
  return `${origin}/api/telegram/webhook/${botId}`
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const since = new Date(Date.now() - 30 * DAY)
    const [bot, aiConfig, chats, aiReplies, waiting] = await Promise.all([
      prisma.telegramBot.findUnique({ where: { account_id: ctx.accountId } }),
      prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId }, select: { ai_auto_reply_enabled: true, ai_auto_reply_channels: true } }),
      prisma.conversation.count({ where: { account_id: ctx.accountId, channel: 'telegram', last_message_at: { gte: since } } }),
      prisma.message.count({ where: { bot_source: AI_AUTO_REPLY_SOURCE, created_at: { gte: since }, conversation: { account_id: ctx.accountId, channel: 'telegram' } } }),
      prisma.conversation.count({ where: { account_id: ctx.accountId, channel: 'telegram', status: 'pending' } }),
    ])
    const connected = Boolean(bot && bot.status !== 'disconnected')
    const business = (Array.isArray(bot?.business_connections) ? bot!.business_connections : []) as Array<{ id?: string; user_name?: string; enabled?: boolean; connected_at?: string }>
    return NextResponse.json({
      connected,
      bot: connected && bot
        ? {
            username: bot.username,
            display_name: bot.display_name,
            status: bot.status,
            last_error: bot.last_error,
            last_update_at: bot.last_update_at,
            connected_at: bot.updated_at,
            link: startLink(bot.username),
          }
        : null,
      business: business.map((b) => ({ user_name: b.user_name ?? '', enabled: Boolean(b.enabled), connected_at: b.connected_at ?? null })),
      ai: {
        assistant_on: Boolean(aiConfig?.ai_auto_reply_enabled),
        configured: Boolean(aiConfig),
        answers_telegram: channelsOf(aiConfig?.ai_auto_reply_channels).includes('telegram'),
      },
      totals: { chats_30d: chats, ai_replies_30d: aiReplies, waiting_for_team: waiting },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`telegram-connect:${ctx.accountId}`, { limit: 10, windowMs: 10 * 60 * 1000 })
    if (!limit.success) return NextResponse.json({ error: 'Too many tries. Wait a few minutes and try again.' }, { status: 429 })

    const origin = publicOrigin(req)
    if (!origin.startsWith('https://')) {
      return NextResponse.json({ error: 'Telegram only delivers to an https address. Open the CRM at its https address and try again.' }, { status: 400 })
    }
    const body = (await req.json().catch(() => ({}))) as { token?: unknown; reconnect?: unknown }

    // Re-point the webhook (the site moved, or Telegram reported an error).
    if (body.reconnect === true) {
      const row = await prisma.telegramBot.findUnique({ where: { account_id: ctx.accountId } })
      if (!row || row.status === 'disconnected') return NextResponse.json({ error: 'Telegram is not connected.' }, { status: 400 })
      const secret = crypto.randomBytes(32).toString('hex')
      try {
        await setWebhook(decrypt(row.token_enc), webhookUrl(origin, row.id), secret)
      } catch (err) {
        console.error('[telegram config] reconnect failed:', err)
        const msg = err instanceof TelegramApiError ? err.message : 'Could not reach Telegram.'
        await prisma.telegramBot.update({ where: { id: row.id }, data: { status: 'error', last_error: msg } })
        return NextResponse.json({ error: msg }, { status: 502 })
      }
      await prisma.telegramBot.update({ where: { id: row.id }, data: { webhook_secret: secret, status: 'connected', last_error: null } })
      return NextResponse.json({ ok: true })
    }

    const token = typeof body.token === 'string' ? body.token.trim() : ''
    if (!TOKEN.test(token)) {
      return NextResponse.json({ error: 'That does not look like a bot token. It looks like 1234567890:AAH… — copy it from @BotFather.' }, { status: 400 })
    }

    let me: Awaited<ReturnType<typeof getMe>>
    try {
      me = await getMe(token)
    } catch (err) {
      console.error('[telegram config] getMe failed:', err)
      return NextResponse.json({ error: err instanceof TelegramApiError ? err.message : 'Could not reach Telegram.' }, { status: 400 })
    }

    // One bot answers one workspace — its webhook can only point at one place.
    const elsewhere = await prisma.telegramBot.findFirst({
      where: { bot_user_id: String(me.id), account_id: { not: ctx.accountId }, status: { not: 'disconnected' } },
      select: { id: true },
    })
    if (elsewhere) {
      return NextResponse.json({ error: `@${me.username} is already connected to another workspace. Make a new bot in @BotFather for this one.` }, { status: 409 })
    }

    const secret = crypto.randomBytes(32).toString('hex')
    const fields = {
      user_id: ctx.userId,
      bot_user_id: String(me.id),
      username: me.username,
      display_name: me.first_name?.slice(0, 120) ?? null,
      token_enc: encrypt(token),
      webhook_secret: secret,
      status: 'error',
      last_error: 'Connecting…',
    }
    const row = await prisma.telegramBot.upsert({
      where: { account_id: ctx.accountId },
      create: { account_id: ctx.accountId, ...fields },
      update: { ...fields, business_connections: [] },
    })
    try {
      await setWebhook(token, webhookUrl(origin, row.id), secret)
    } catch (err) {
      console.error('[telegram config] setWebhook failed:', err)
      const msg = err instanceof TelegramApiError ? err.message : 'Could not reach Telegram.'
      await prisma.telegramBot.update({ where: { id: row.id }, data: { last_error: msg } })
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    await prisma.telegramBot.update({ where: { id: row.id }, data: { status: 'connected', last_error: null } })
    return NextResponse.json({ ok: true, username: me.username })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => ({}))) as { ai_auto_reply?: unknown }
    if (typeof body.ai_auto_reply !== 'boolean') {
      return NextResponse.json({ error: 'ai_auto_reply must be true or false.' }, { status: 400 })
    }
    const config = await prisma.aiConfig.findUnique({ where: { account_id: ctx.accountId }, select: { id: true, ai_auto_reply_channels: true } })
    if (!config) return NextResponse.json({ error: 'Set up the AI assistant first (AI settings).' }, { status: 400 })
    const channels = channelsOf(config.ai_auto_reply_channels).filter((c) => c !== 'telegram')
    if (body.ai_auto_reply) channels.push('telegram')
    await prisma.aiConfig.update({ where: { id: config.id }, data: { ai_auto_reply_channels: channels } })
    return NextResponse.json({ answers_telegram: body.ai_auto_reply })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const row = await prisma.telegramBot.findUnique({ where: { account_id: ctx.accountId } })
    if (!row) return NextResponse.json({ ok: true })
    // Best effort: a revoked token cannot remove its webhook, and the
    // secret check refuses a disconnected bot's updates anyway.
    await deleteWebhook(decrypt(row.token_enc)).catch((err) => console.warn('[telegram config] deleteWebhook failed:', err instanceof Error ? err.message : err))
    await prisma.telegramBot.update({ where: { id: row.id }, data: { status: 'disconnected', last_error: null } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
