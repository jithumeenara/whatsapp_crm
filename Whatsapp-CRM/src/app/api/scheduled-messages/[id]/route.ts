import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { Prisma } from "@prisma/client"

/**
 * PATCH /api/scheduled-messages/[id]
 *
 * Two shapes:
 *  - { status: 'active' | 'paused' | 'cancelled' } -- quick pause/resume/
 *    cancel, no other fields touched.
 *  - Full edit (same template_name/template_language/... shape as
 *    POST /api/scheduled-messages) -- replaces the template/schedule in
 *    place, resetting progress (sends_count, error state) and
 *    reactivating it. Editing a paused/failed/expired message this way
 *    brings it back to 'active'.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

    const existing = await prisma.scheduledMessage.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Status-only transition (pause/resume/cancel)
    const isStatusOnly = Object.keys(body).length === 1 && "status" in body
    if (isStatusOnly) {
      if (!["active", "paused", "cancelled"].includes(body.status)) {
        return NextResponse.json({ error: "status must be active, paused, or cancelled" }, { status: 400 })
      }
      if (existing.status === "completed" || existing.status === "cancelled") {
        return NextResponse.json({ error: "This scheduled message has already ended" }, { status: 400 })
      }
      const updated = await prisma.scheduledMessage.update({ where: { id }, data: { status: body.status } })
      return NextResponse.json({ item: updated })
    }

    // Full edit
    if (!body.template_name || !body.template_language) {
      return NextResponse.json({ error: "A Meta-approved template is required" }, { status: 400 })
    }
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
      nextSendAt = body.scheduled_at ? new Date(body.scheduled_at) : new Date()
    }
    if (Number.isNaN(nextSendAt.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 })
    }

    const maxSends = scheduleType === "once" ? 1 : Math.max(1, Number(body.max_sends) || 1)
    const bodyParams: string[] | undefined =
      Array.isArray(body.template_body_params) && body.template_body_params.length > 0
        ? body.template_body_params
        : undefined
    const buttonParams: Record<number, string> | undefined =
      body.template_button_params && typeof body.template_button_params === "object"
        ? body.template_button_params
        : undefined

    const updated = await prisma.scheduledMessage.update({
      where: { id },
      data: {
        content_text: body.content_text?.trim() || null,
        template_name: body.template_name,
        template_language: body.template_language,
        template_body_params: bodyParams ? (bodyParams as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        template_header_text: body.template_header_text?.trim() || null,
        template_button_params: buttonParams ? (buttonParams as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        schedule_type: scheduleType,
        interval_value: intervalValue ?? null,
        interval_unit: intervalUnit ?? null,
        stop_on_reply: scheduleType === "recurring" ? body.stop_on_reply !== false : false,
        max_sends: maxSends,
        next_send_at: nextSendAt,
        // Editing restarts progress and clears any prior failure state.
        sends_count: 0,
        error_count: 0,
        error_message: null,
        status: "active",
      },
    })

    return NextResponse.json({ item: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/scheduled-messages/[id]
 * Soft-cancels (status flip, not a row delete) so it stays visible in the
 * conversation's schedule history.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent")
    const { id } = await params

    const existing = await prisma.scheduledMessage.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await prisma.scheduledMessage.update({ where: { id }, data: { status: "cancelled" } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
