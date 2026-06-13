// ============================================================
// GET /api/invitations/[token]/peek
//
// Public — no auth required. Lets the /join/<token> page render
// "You're being invited to <Account> as <Role>" before the
// visitor signs up or signs in.
//
// Security model:
//   - Token is in the URL path, not the query.
//   - The plaintext token never crosses the DB boundary — we
//     hash it in TS first and look up by `token_hash`.
//   - Per-IP rate limit pinches brute-force enumeration.
// ============================================================

import { NextResponse } from "next/server";

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`peek:${ip}`, RATE_LIMITS.invitationPeek);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { ok: false, reason: "not_found" },
      { status: 404 },
    );
  }

  try {
    const tokenHash = hashInviteToken(token);
    const now = new Date();

    const invitation = await prisma.accountInvitation.findFirst({
      where: {
        token_hash: tokenHash,
        accepted_at: null,
        expires_at: { gt: now },
      },
      select: {
        id: true,
        role: true,
        label: true,
        expires_at: true,
        account: { select: { id: true, name: true } },
      },
    });

    if (!invitation) {
      // Check if it exists but is expired or already accepted
      const anyInvitation = await prisma.accountInvitation.findFirst({
        where: { token_hash: tokenHash },
        select: { accepted_at: true, expires_at: true },
      });

      if (!anyInvitation) {
        return NextResponse.json({ ok: false, reason: "not_found" });
      }
      if (anyInvitation.accepted_at) {
        return NextResponse.json({ ok: false, reason: "used" });
      }
      return NextResponse.json({ ok: false, reason: "expired" });
    }

    return NextResponse.json({
      ok: true,
      accountId: invitation.account.id,
      accountName: invitation.account.name,
      role: invitation.role,
      label: invitation.label,
      expiresAt: invitation.expires_at,
    });
  } catch (err) {
    console.error("[peek] error:", err);
    return NextResponse.json(
      { ok: false, reason: "server_error" },
      { status: 500 },
    );
  }
}
