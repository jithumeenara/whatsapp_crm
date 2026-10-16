import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import { newPublicKey } from '@/lib/webchat/tokens'
import { installSnippet } from '@/lib/webchat/settings'
import { buildWidgetPatch } from '@/lib/webchat/widget-patch'
import type { Prisma } from '@prisma/client'
import { AI_AUTO_REPLY_SOURCE } from '@/lib/ai/auto-reply'

/**
 * Settings → Channels → Website Bot. Admins only; not under the public /api/webchat/.
 *
 * GET   every widget with its install snippet and the last 30 days, plus
 *       whether the assistant answers website chats.
 * POST  a new widget (body: any of the editable fields).
 * PUT   { ai_auto_reply: boolean } — add or remove 'website' from the
 *       channels the assistant answers. The assistant's own on/off switch
 *       stays on the Chatbots page; this only says which channels.
 */

export const dynamic = 'force-dynamic'

const DAY = 24 * 60 * 60 * 1000

function channelsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : ['whatsapp']
}

export async function GET(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const origin = publicOrigin(req)
    const since = new Date(Date.now() - 30 * DAY)

    const [widgets, aiConfig, aiReplies, waiting] = await Promise.all([
      prisma.webChatWidget.findMany({ where: { account_id: ctx.accountId }, orderBy: { created_at: 'asc' } }),
      prisma.aiConfig.findUnique({
        where: { account_id: ctx.accountId },
        select: { ai_auto_reply_enabled: true, ai_auto_reply_channels: true },
      }),
      prisma.message.count({
        where: {
          bot_source: AI_AUTO_REPLY_SOURCE,
          created_at: { gte: since },
          conversation: { account_id: ctx.accountId, channel: 'website' },
        },
      }),
      prisma.conversation.count({ where: { account_id: ctx.accountId, channel: 'website', status: 'pending' } }),
    ])

    const stats = await Promise.all(
      widgets.map(async (w) => {
        const [visitors, chats] = await Promise.all([
          prisma.webChatSession.count({ where: { widget_id: w.id, created_at: { gte: since } } }),
          prisma.webChatSession.count({ where: { widget_id: w.id, created_at: { gte: since }, conversation_id: { not: null } } }),
        ])
        return { visitors_30d: visitors, chats_30d: chats }
      }),
    )

    return NextResponse.json({
      origin,
      ai: {
        assistant_on: Boolean(aiConfig?.ai_auto_reply_enabled),
        configured: Boolean(aiConfig),
        answers_website: channelsOf(aiConfig?.ai_auto_reply_channels).includes('website'),
      },
      totals: { ai_replies_30d: aiReplies, waiting_for_team: waiting },
      widgets: widgets.map((w, i) => ({
        id: w.id,
        public_key: w.public_key,
        enabled: w.enabled,
        name: w.name,
        title: w.title,
        welcome_message: w.welcome_message,
        primary_color: w.primary_color,
        color_style: w.color_style,
        secondary_color: w.secondary_color,
        launcher_animation: w.launcher_animation,
        contact_menu_enabled: w.contact_menu_enabled,
        whatsapp_links: w.whatsapp_links,
        call_links: w.call_links,
        whatsapp_prefill: w.whatsapp_prefill,
        position: w.position,
        logo_url: w.logo_url,
        allowed_domains: w.allowed_domains,
        allow_handoff: w.allow_handoff,
        daily_ai_limit: w.daily_ai_limit,
        last_seen_at: w.last_seen_at?.toISOString() ?? null,
        last_seen_origin: w.last_seen_origin,
        snippet: installSnippet(origin, w.public_key),
        ...stats[i],
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const parsed = await buildWidgetPatch(ctx.accountId, body)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const count = await prisma.webChatWidget.count({ where: { account_id: ctx.accountId } })
    if (count >= 20) return NextResponse.json({ error: 'An account can have up to 20 chat widgets.' }, { status: 400 })

    const widget = await prisma.webChatWidget.create({
      data: { account_id: ctx.accountId, user_id: ctx.userId, public_key: newPublicKey(), name: 'Website Bot', ...(parsed.patch as Record<string, unknown>) } as Prisma.WebChatWidgetUncheckedCreateInput,
    })
    return NextResponse.json({ id: widget.id }, { status: 201 })
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
    const config = await prisma.aiConfig.findUnique({
      where: { account_id: ctx.accountId },
      select: { id: true, ai_auto_reply_channels: true },
    })
    if (!config) {
      return NextResponse.json({ error: 'Set up the AI assistant first (AI settings).' }, { status: 400 })
    }
    const channels = channelsOf(config.ai_auto_reply_channels).filter((c) => c !== 'website')
    if (body.ai_auto_reply) channels.push('website')
    await prisma.aiConfig.update({ where: { id: config.id }, data: { ai_auto_reply_channels: channels } })
    return NextResponse.json({ answers_website: body.ai_auto_reply })
  } catch (err) {
    return toErrorResponse(err)
  }
}
