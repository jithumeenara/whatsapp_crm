import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import type { Prisma } from "@prisma/client"

/**
 * GET /api/scheduled-messages?conversation_id=...
 * Lists scheduled messages for one conversation (active + paused + recent
 * completed/cancelled), newest first.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer")
    const conversationId = req.nextUrl.searchParams.get("conversation_id")
    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 })
    }

    const items = await prisma.scheduledMessage.findMany({
      where: { account_id: ctx.accountId, conversation_id: conversationId },
      orderBy: { created_at: "desc" },
    })
    return NextResponse.json({ items })
  } catch (err) {
    return toErrorResponse(err)
  }
}

interface ScheduledButtonInput { id: string; title: string }

/**
 * POST /api/scheduled-messages
 * Body: { conversation_id, content_text?, media_url?, media_type?,
 *   buttons?, schedule_type: 'once'|'recurring', scheduled_at (once) |
 *   interval_value+interval_unit (recurring), stop_on_reply?, max_sends? }
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const body = await req.json().catch(() => null)
    if (!body?.conversation_id) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 })
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: body.conversation_id, account_id: ctx.accountId },
      select: { id: true, contact_id: true },
    })
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }

    const contentText: string | undefined = body.content_text?.trim() || undefined
    const mediaUrl: string | undefined = body.media_url || undefined
    const buttons: ScheduledButtonInput[] | undefined =
      Array.isArray(body.buttons) && body.buttons.length > 0 ? body.buttons.slice(0, 3) : undefined

    if (!contentText && !mediaUrl) {
      return NextResponse.json({ error: "Message needs text or media" }, { status: 400 })
    }
    if (buttons && !contentText) {
      return NextResponse.json({ error: "Button messages need body text" }, { status: 400 })
    }

    const scheduleType = body.schedule_type === "recurring" ? "recurring" : "once"
    let nextSendAt: Date
    let intervalValue: number | undefined
    let intervalUnit: string | undefined

    if (scheduleType === "once") {
      if (!body.scheduled_at) return NextResponse.json({ error: "scheduled_at is required" }, { status: 400 })
      nextSendAt = new Date(body.scheduled_at)
    } else {
      intervalValue = Number(body.interval_value)
      intervalUnit = body.interval_unit
      if (!intervalValue || intervalValue < 1 || !["minutes", "hours", "days"].includes(intervalUnit ?? "")) {
        return NextResponse.json({ error: "Valid interval_value + interval_unit are required" }, { status: 400 })
      }
      // First send is either an explicit start time, or "right away" (now).
      nextSendAt = body.scheduled_at ? new Date(body.scheduled_at) : new Date()
    }
    if (Number.isNaN(nextSendAt.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 })
    }

    const maxSends = scheduleType === "once" ? 1 : Math.max(1, Number(body.max_sends) || 1)

    const created = await prisma.scheduledMessage.create({
      data: {
        account_id: ctx.accountId,
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
        created_by: ctx.userId,
        content_text: contentText ?? null,
        media_url: mediaUrl ?? null,
        media_type: body.media_type ?? null,
        buttons: buttons ? (buttons as unknown as Prisma.InputJsonValue) : undefined,
        schedule_type: scheduleType,
        interval_value: intervalValue ?? null,
        interval_unit: intervalUnit ?? null,
        stop_on_reply: scheduleType === "recurring" ? body.stop_on_reply !== false : false,
        max_sends: maxSends,
        next_send_at: nextSendAt,
      },
    })

    return NextResponse.json({ item: created }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
