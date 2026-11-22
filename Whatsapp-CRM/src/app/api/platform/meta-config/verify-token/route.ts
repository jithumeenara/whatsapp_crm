import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/auth/account"
import { isPlatformOwner } from "@/lib/auth/platform-owner"
import { prisma } from "@/lib/db"
import { sealSecret } from "@/lib/whatsapp/encryption"
import { auditCtx } from "@/lib/audit"
import { auditConfigChange } from "@/lib/audit/config-change"

/**
 * POST /api/platform/meta-config/verify-token — the server owner makes a new
 * webhook verify token for the Instagram and Page webhooks.
 *
 * Generated here (32 random bytes), saved sealed in the database, and
 * returned ONCE so it can be pasted in the Meta dashboard; no API ever reads
 * it back. Making a new one replaces the old: Meta must then be given the
 * new token the next time "Verify and save" is pressed (already-verified
 * webhooks keep working — Meta only checks the token at that moment).
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("owner")
    if (!(await isPlatformOwner(ctx.userId))) {
      throw new ForbiddenError("Only the server owner can change the platform Meta App.")
    }
    const existing = await prisma.metaPlatformConfig.findUnique({ where: { id: "singleton" }, select: { id: true } })
    if (!existing) {
      return NextResponse.json({ error: "Save the Meta App (App ID and App Secret) first." }, { status: 400 })
    }

    const token = crypto.randomBytes(32).toString("hex")
    await prisma.metaPlatformConfig.update({
      where: { id: "singleton" },
      data: { webhook_verify_token: sealSecret(token), updated_by: ctx.userId },
    })
    // Which field changed — never the value.
    await auditConfigChange(auditCtx(req, ctx), "config.platform_changed", {
      area: "platform_meta_app",
      fields: ["webhook_verify_token"],
      target: { type: "config", id: "platform_meta_app" },
      meta: { regenerated: true },
    })

    const res = NextResponse.json({ verify_token: token })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (err) {
    return toErrorResponse(err)
  }
}
