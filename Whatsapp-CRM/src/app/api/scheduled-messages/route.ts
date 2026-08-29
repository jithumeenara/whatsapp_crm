import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { Prisma } from "@prisma/client"

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

/**
 * POST /api/scheduled-messages
 *
 * Scheduled messages must reference a Meta-approved WhatsApp template --
 * free-form text/media is rejected once the customer's 24h session window
 * closes, which a scheduled (especially recurring, multi-day) send
 * routinely runs into. Body:
 *   { conversation_id, template_name, template_language,
 *     template_body_params?: string[], template_header_text?: string,
 *     template_button_params?: Record<number,string>,
 *     content_text (rendered preview for the list UI, not sent as-is),
 *     schedule_type: 'once'|'recurring',
 *     scheduled_at (once) | interval_value+interval_unit (recurring),
 *     stop_on_reply?, max_sends? }
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const body = await req.json().catch(() => null)
    if (!body?.conversation_id) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 })
    }
    if (!body.template_name || !body.template_language) {
      return NextResponse.json({ error: "A Meta-approved template is required" }, { status: 400 })
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: body.conversation_id, account_id: ctx.accountId },
      select: { id: true, contact_id: true },
    })
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 })
    }

    // The template must actually belong to this account (and exist).
    const template = await prisma.messageTemplate.findFirst({
      where: { account_id: ctx.accountId, name: body.template_name, language: body.template_language },
      select: { id: true },
    })
    if (!template) {
      return NextResponse.json({ error: "Template not found for this account" }, { status: 404 })
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
    // Positional ({{1}}, {{2}}, …) templates send an array; named
    // ({{customer_name}}) templates send a plain object — both are valid,
    // stored as-is in the same JSON column, told apart later by shape.
    const bodyParams: string[] | Record<string, string> | undefined =
      Array.isArray(body.template_body_params) && body.template_body_params.length > 0
        ? body.template_body_params
        : (body.template_body_params && typeof body.template_body_params === "object" && Object.keys(body.template_body_params).length > 0
          ? body.template_body_params
          : undefined)
    const buttonParams: Record<number, string> | undefined =
      body.template_button_params && typeof body.template_button_params === "object"
        ? body.template_button_params
        : undefined

    const created = await prisma.scheduledMessage.create({
      data: {
        account_id: ctx.accountId,
        conversation_id: conversation.id,
        contact_id: conversation.contact_id,
        created_by: ctx.userId,
        content_text: body.content_text?.trim() || null,
        template_name: body.template_name,
        template_language: body.template_language,
        template_body_params: bodyParams ? (bodyParams as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        template_header_text: body.template_header_text?.trim() || null,
        template_button_params: buttonParams ? (buttonParams as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        // Reused (not "legacy") for a template's media-header override --
        // see the sweep, which passes this straight through as headerMediaUrl.
        media_url: body.template_header_media_url?.trim() || null,
        media_type: body.template_header_media_url?.trim() ? body.template_header_media_type || null : null,
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
