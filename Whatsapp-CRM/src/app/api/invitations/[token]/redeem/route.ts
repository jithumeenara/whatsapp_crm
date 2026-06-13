// ============================================================
// POST /api/invitations/[token]/redeem
//
// Authenticated. Caller atomically moves from their personal
// account (created at signup) to the inviter's account with the
// invite's role.
//
// Refusal cases:
//   - Caller not authenticated → 401
//   - Token not found / used / expired → 400
//   - Caller's profile has data that prevents the move → 409
//
// Implemented with prisma.$transaction to replace the former
// `redeem_invitation` SECURITY DEFINER RPC.
// ============================================================

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { hashInviteToken } from "@/lib/auth/invitations";
import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`redeem:${ip}`, RATE_LIMITS.invitationRedeem);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { error: "Missing invitation token" },
      { status: 400 },
    );
  }

  // Auth check before touching the DB
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const tokenHash = hashInviteToken(token);
    const now = new Date();

    // Look up the invitation
    const invitation = await prisma.accountInvitation.findFirst({
      where: { token_hash: tokenHash },
      select: {
        id: true,
        account_id: true,
        role: true,
        accepted_at: true,
        expires_at: true,
      },
    });

    if (!invitation) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 400 },
      );
    }
    if (invitation.accepted_at) {
      return NextResponse.json(
        { error: "Invitation has already been used" },
        { status: 400 },
      );
    }
    if (invitation.expires_at < now) {
      return NextResponse.json(
        { error: "Invitation has expired" },
        { status: 400 },
      );
    }

    // Verify the caller has a profile (must exist for redeem to work)
    const callerProfile = await prisma.profile.findUnique({
      where: { user_id: userId },
      select: { account_id: true, account_role: true },
    });

    if (!callerProfile) {
      return NextResponse.json(
        { error: "Your profile could not be found" },
        { status: 400 },
      );
    }

    // Conflict: caller is already in a shared (non-personal) account.
    // A personal account is one where the user is also the owner.
    const callerAccount = await prisma.account.findFirst({
      where: { id: callerProfile.account_id, owner_user_id: userId },
      select: { id: true },
    });

    // If they're not the owner of their current account, they're already
    // in a shared account — refuse the redeem.
    if (!callerAccount) {
      return NextResponse.json(
        {
          error:
            "You are already a member of another shared account. Leave it first before accepting an invitation.",
        },
        { status: 409 },
      );
    }

    // Atomically mark the invite accepted and move the caller's profile
    const accountId = await prisma.$transaction(async (tx) => {
      // Mark invitation accepted
      await tx.accountInvitation.update({
        where: { id: invitation.id },
        data: {
          accepted_at: now,
          accepted_by_user_id: userId,
        },
      });

      // Move the caller's profile to the new account
      await tx.profile.update({
        where: { user_id: userId },
        data: {
          account_id: invitation.account_id,
          account_role: invitation.role,
        },
      });

      return invitation.account_id;
    });

    return NextResponse.json({ ok: true, accountId });
  } catch (err) {
    console.error("[redeem] error:", err);
    return NextResponse.json(
      { error: "Failed to redeem invitation" },
      { status: 500 },
    );
  }
}
