import { NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

/**
 * GET /api/profiles
 *
 * Returns all profiles (team members) for the current account,
 * ordered by full_name. Used by the inbox assign-agent dropdown.
 */
export async function GET() {
  try {
    const ctx = await requireRole("viewer")

    const profiles = await prisma.profile.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { full_name: "asc" },
      select: {
        id: true,
        user_id: true,
        full_name: true,
        email: true,
        avatar_url: true,
        account_role: true,
      },
    })

    return NextResponse.json({ profiles })
  } catch (err) {
    return toErrorResponse(err)
  }
}
