import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"

/**
 * PATCH /api/profile
 * Update display name and/or avatar URL for the current user's profile.
 * Avatar upload itself goes through /api/upload; this endpoint just saves
 * the resulting URL (or null to remove).
 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer")
    const body = (await req.json()) as {
      full_name?: string
      avatar_url?: string | null
    }

    const data: Record<string, unknown> = {}
    if (typeof body.full_name === "string") {
      const name = body.full_name.trim()
      if (!name) {
        return NextResponse.json(
          { error: "full_name cannot be empty" },
          { status: 400 },
        )
      }
      data.full_name = name
    }
    if ("avatar_url" in body) {
      data.avatar_url = body.avatar_url ?? null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const profile = await prisma.profile.update({
      where: { user_id: ctx.userId },
      data,
      select: {
        id: true,
        full_name: true,
        email: true,
        avatar_url: true,
        account_id: true,
        account_role: true,
      },
    })

    return NextResponse.json({ profile })
  } catch (err) {
    return toErrorResponse(err)
  }
}
