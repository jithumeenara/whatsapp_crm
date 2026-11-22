import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
import { audit, auditCtx } from "@/lib/audit"

export async function GET() {
  try {
    const ctx = await requireRole("viewer")
    const tags = await prisma.tag.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { created_at: "asc" },
    })
    return NextResponse.json({ tags })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const body = ((await req.json().catch(() => null)) ?? {}) as { name?: unknown; color?: unknown }
    // Plain text only, 1–40 characters, no hidden characters.
    const name = typeof body.name === "string" ? body.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : ""
    if (!name) {
      return NextResponse.json({ error: "Give the tag a name." }, { status: 400 })
    }
    if ([...name].length > 40) {
      return NextResponse.json({ error: "A tag name can be at most 40 characters." }, { status: 400 })
    }
    // Several screens put the colour straight into CSS: only #rrggbb is
    // ever stored, anything else becomes the default.
    const color = typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color.toLowerCase() : "#10b981"
    // The same name (any case) is the same tag: no duplicates.
    const existing = await prisma.tag.findFirst({
      where: { account_id: ctx.accountId, name: { equals: name, mode: "insensitive" } },
    })
    if (existing) return NextResponse.json({ tag: existing }, { status: 200 })
    const tag = await prisma.tag.create({
      data: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        color,
      },
    })
    await audit(auditCtx(req, ctx), { action: "record.created", target: { type: "tag", id: tag.id, label: tag.name }, after: { name: tag.name, color: tag.color } })
    return NextResponse.json({ tag }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
