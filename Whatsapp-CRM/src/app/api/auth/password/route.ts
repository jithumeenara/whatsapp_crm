import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"

const MIN_PASSWORD = 8

/**
 * POST /api/auth/password
 * Change the current user's password.
 * Requires current_password to verify identity before hashing the new one.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer")
    const body = (await req.json()) as {
      current_password?: string
      new_password?: string
    }

    const current = body.current_password
    const next = body.new_password

    if (!current || !next) {
      return NextResponse.json(
        { error: "current_password and new_password are required" },
        { status: 400 },
      )
    }
    if (next.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD} characters` },
        { status: 400 },
      )
    }

    // Verify current password
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { password_hash: true },
    })

    if (!user?.password_hash) {
      return NextResponse.json(
        { error: "Cannot change password for this account type" },
        { status: 400 },
      )
    }

    const valid = await bcrypt.compare(current, user.password_hash)
    if (!valid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 },
      )
    }

    const hash = await bcrypt.hash(next, 12)
    await prisma.user.update({
      where: { id: ctx.userId },
      data: { password_hash: hash },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
