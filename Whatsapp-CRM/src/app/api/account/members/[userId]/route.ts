// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
//
// Previously delegated to SECURITY DEFINER RPCs. Logic is now
// implemented directly in TypeScript using Prisma.
//
// set_member_role: update the profile's account_role.
//   - Caller must be admin+
//   - Target must be in the caller's account
//   - Target cannot be the owner
//   - Cannot set role to owner (use transfer-ownership)
//   - Cannot change own role
//
// remove_account_member: move the removed user to a fresh
//   personal account.
//   - Caller must be admin+
//   - Target must be in the caller's account
//   - Target cannot be the owner
//   - Cannot remove self
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRole:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown }
      | null;
    const role = body?.role;

    if (!isAccountRole(role)) {
      return NextResponse.json(
        { error: "'role' must be one of owner, admin, agent, viewer" },
        { status: 400 },
      );
    }

    if (role === "owner") {
      return NextResponse.json(
        {
          error:
            "Use POST /api/account/transfer-ownership to promote a member to owner",
        },
        { status: 400 },
      );
    }

    if (userId === ctx.userId) {
      return NextResponse.json(
        { error: "You cannot change your own role" },
        { status: 400 },
      );
    }

    // Verify the target is a member of the caller's account and is not the owner
    const target = await prisma.profile.findFirst({
      where: { user_id: userId, account_id: ctx.accountId },
      select: { account_role: true },
    });

    if (!target) {
      return NextResponse.json(
        { error: "Member not found in your account" },
        { status: 404 },
      );
    }

    if (target.account_role === "owner") {
      return NextResponse.json(
        { error: "Cannot change the role of the account owner" },
        { status: 403 },
      );
    }

    await prisma.profile.update({
      where: { user_id: userId },
      data: { account_role: role },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    if (userId === ctx.userId) {
      return NextResponse.json(
        { error: "You cannot remove yourself from the account" },
        { status: 400 },
      );
    }

    // Verify the target is a member of the caller's account and is not the owner
    const target = await prisma.profile.findFirst({
      where: { user_id: userId, account_id: ctx.accountId },
      select: { account_role: true, email: true, full_name: true },
    });

    if (!target) {
      return NextResponse.json(
        { error: "Member not found in your account" },
        { status: 404 },
      );
    }

    if (target.account_role === "owner") {
      return NextResponse.json(
        { error: "Cannot remove the account owner" },
        { status: 403 },
      );
    }

    // Create a new personal account for the removed user and reassign
    // their profile to it. Done in a transaction so the user is never
    // left account-less.
    const newPersonalAccount = await prisma.$transaction(async (tx) => {
      const newAccount = await tx.account.create({
        data: {
          name: target.full_name
            ? `${target.full_name}'s Account`
            : "Personal Account",
          owner_user_id: userId,
        },
      });

      await tx.profile.update({
        where: { user_id: userId },
        data: {
          account_id: newAccount.id,
          account_role: "owner",
        },
      });

      return newAccount;
    });

    return NextResponse.json({
      ok: true,
      newPersonalAccountId: newPersonalAccount.id,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
