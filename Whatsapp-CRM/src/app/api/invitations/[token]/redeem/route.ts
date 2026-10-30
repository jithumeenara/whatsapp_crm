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
//   - Caller owns an account other people still work in → 409
//     (leaving would strand that team without its owner)
//
// Single use is enforced by claimInvitation's conditional update inside
// the same transaction as the move — the checks above it only choose
// the error message. Checking first and marking used later let two
// people who redeemed the same link at once both join.
//
// Implemented with prisma.$transaction to replace the former
// `redeem_invitation` SECURITY DEFINER RPC.
// ============================================================

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { hashInviteToken } from "@/lib/auth/invitations";
import { claimInvitation, InvitationUnavailableError } from "@/lib/auth/claim-invitation";
import { forgetCachedProfile } from "@/lib/auth/account";
import { prisma } from "@/lib/db";
import { invalidateBusinessCount } from "@/lib/files/legacy-access";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { clientIpKey } from "@/lib/net/client-ip";

function getClientIp(request: Request): string {
  return clientIpKey(request.headers);
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

    const caller = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });

    // The owner of a team cannot leave it by accepting somebody else's
    // invitation: the team would be left with nobody who can manage it.
    const teammates = await prisma.profile.count({
      where: { account_id: callerProfile.account_id, user_id: { not: userId } },
    });
    if (teammates > 0) {
      return NextResponse.json(
        {
          error:
            "You own a workspace other people work in. Transfer its ownership before joining another one.",
        },
        { status: 409 },
      );
    }

    // Atomically claim the invite and move the caller's profile. The
    // account and role come from the invitation row, never the request.
    const accountId = await prisma.$transaction(async (tx) => {
      // Throws (undoing this transaction) if it is used, expired, or
      // names a different email address from this login's.
      const claimed = await claimInvitation(tx, token, userId, caller?.email ?? "", now);

      await tx.profile.update({
        where: { user_id: userId },
        data: {
          account_id: claimed.account_id,
          account_role: claimed.role,
        },
      });

      return claimed.account_id;
    });

    // Their next request must see the new account and role, not the
    // personal-owner copy cached for up to a minute.
    forgetCachedProfile(userId);
    // Who is in which account changed (security review R4a).
    invalidateBusinessCount();

    return NextResponse.json({ ok: true, accountId });
  } catch (err) {
    if (err instanceof InvitationUnavailableError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.reason === "wrong_email" ? 403 : 400 },
      );
    }
    console.error("[redeem] error:", err);
    return NextResponse.json(
      { error: "Failed to redeem invitation" },
      { status: 500 },
    );
  }
}
