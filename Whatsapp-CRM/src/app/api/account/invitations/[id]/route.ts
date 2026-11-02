// ============================================================
// DELETE /api/account/invitations/[id]
//
// Admin+. Revokes a pending invitation by id. We scope the
// delete to the caller's account so cross-account attempts
// silently 404.
//
// Hard delete — once revoked, the invite is dead forever.
// ============================================================

import { NextResponse } from "next/server";
import { audit, auditCtx } from "@/lib/audit";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:inviteRevoke:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Scope to the caller's account so cross-account attempts surface
    // as 404 rather than leaking existence.
    const existing = await prisma.accountInvitation.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, role: true, label: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 },
      );
    }

    await prisma.accountInvitation.delete({ where: { id } });
    await audit(auditCtx(_request, ctx), {
      action: "member.invite_cancelled",
      target: { type: "invitation", id, label: existing.label ?? null },
      meta: { role: existing.role },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
