import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const ctx = await requireRole("viewer")
    const fields = await prisma.customField.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { field_name: "asc" },
    })
    return NextResponse.json({ fields })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireRole("agent")
    const body = await req.json()
    const field_name = (body.field_name ?? "").trim()
    const field_type = (body.field_type ?? "text").trim()
    if (!field_name) {
      return NextResponse.json({ error: "field_name is required" }, { status: 400 })
    }
    const allowed = ["text", "textarea", "number", "date", "url"]
    if (!allowed.includes(field_type)) {
      return NextResponse.json({ error: "Invalid field_type" }, { status: 400 })
    }
    const field = await prisma.customField.create({
      data: { account_id: ctx.accountId, user_id: ctx.userId, field_name, field_type },
    })
    return NextResponse.json({ field }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
