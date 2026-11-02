import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
import { audit, auditCtx } from "@/lib/audit"

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin")
    const { id } = await params
    // Verify ownership — tag must belong to the caller's account
    const tag = await prisma.tag.findFirst({
      where: { id, account_id: ctx.accountId },
    })
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    }
    await prisma.tag.delete({ where: { id } })
    await audit(auditCtx(req, ctx), { action: "record.deleted", target: { type: "tag", id, label: tag.name } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/tags/[id] — may the AI add this tag by meaning (admins).
 * { ai_mode: 'off'|'suggest'|'auto', ai_description, ai_avoid, ai_examples: string[] }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin")
    const { id } = await params
    const tag = await prisma.tag.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, name: true, ai_mode: true, ai_description: true, ai_avoid: true, ai_examples: true },
    })
    if (!tag) return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const mode = body.ai_mode
    if (mode !== "off" && mode !== "suggest" && mode !== "auto") {
      return NextResponse.json({ error: "Choose Off, Suggest or Add automatically." }, { status: 400 })
    }
    const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")
    const description = text(body.ai_description, 500)
    if (mode !== "off" && description.length < 5) {
      return NextResponse.json({ error: "Say when this tag applies, so the AI knows what it means." }, { status: 400 })
    }
    const examples = Array.isArray(body.ai_examples)
      ? [...new Set(body.ai_examples.map((e) => text(e, 80)).filter(Boolean))].slice(0, 10)
      : []
    const updated = await prisma.tag.update({
      where: { id },
      data: { ai_mode: mode, ai_description: description || null, ai_avoid: text(body.ai_avoid, 300) || null, ai_examples: examples },
    })
    await audit(auditCtx(req, ctx), {
      action: "record.updated",
      target: { type: "tag", id, label: tag.name },
      before: tag as unknown as Record<string, unknown>,
      after: { ai_mode: mode, ai_description: description || null, ai_avoid: text(body.ai_avoid, 300) || null, ai_examples: examples },
    })
    return NextResponse.json({ tag: updated })
  } catch (err) {
    return toErrorResponse(err)
  }
}
