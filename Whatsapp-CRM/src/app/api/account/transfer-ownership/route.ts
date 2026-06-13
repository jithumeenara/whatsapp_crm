// ============================================================
// POST /api/account/transfer-ownership
//
// Owner only. Atomically:
//   - demotes the current owner to 'admin'
//   - promotes the target member to 'owner'
//   - updates accounts.owner_user_id
//
// Implemented as a prisma.$transaction to replace the former
// `transfer_account_ownership` SECURITY DEFINER RPC.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function looksLikeUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("owner");

    const limit = checkRateLimit(
      `admin:transferOwnership:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { newOwnerUserId?: unknown }
      | null;
    const newOwnerUserId = body?.newOwnerUserId;

    if (!looksLikeUuid(newOwnerUserId)) {
      return NextResponse.json(
        { error: "'newOwnerUserId' must be a valid UUID" },
        { status: 400 },
      );
    }

    if (newOwnerUserId === ctx.userId) {
      return NextResponse.json(
        { error: "You are already the owner of this account" },
        { status: 400 },
      );
    }

    // Verify the target is a member of the caller's account
    const targetProfile = await prisma.profile.findFirst({
      where: { user_id: newOwnerUserId, account_id: ctx.accountId },
      select: { account_role: true },
    });

    if (!targetProfile) {
      return NextResponse.json(
        { error: "Target user is not a member of your account" },
        { status: 400 },
      );
    }

    // Atomically: demote current owner → admin, promote target → owner,
    // update accounts.owner_user_id
    await prisma.$transaction([
      prisma.profile.update({
        where: { user_id: ctx.userId },
        data: { account_role: "admin" },
      }),
      prisma.profile.update({
        where: { user_id: newOwnerUserId },
        data: { account_role: "owner" },
      }),
      prisma.account.update({
        where: { id: ctx.accountId },
        data: { owner_user_id: newOwnerUserId },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
