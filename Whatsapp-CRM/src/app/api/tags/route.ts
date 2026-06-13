import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

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
    const body = (await req.json()) as { name?: string; color?: string }
    const name = body.name?.trim()
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }
    const tag = await prisma.tag.create({
      data: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        color: body.color ?? "#10b981",
      },
    })
    return NextResponse.json({ tag }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
