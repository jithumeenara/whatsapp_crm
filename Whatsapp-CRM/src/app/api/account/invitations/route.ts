// ============================================================
// /api/account/invitations
//
//   GET  — list outstanding (un-redeemed, non-expired) invites.
//   POST — create a new invite link.
//
// Both admin+. The plaintext token is returned exactly ONCE in
// the POST response. We store only the SHA-256 hash on the row.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  clampExpiryDays,
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from "@/lib/auth/invitations";
import { isAccountRole } from "@/lib/auth/roles";
import { normaliseInviteEmail } from "@/lib/auth/claim-invitation";
import { prisma } from "@/lib/db";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// Resolve the base URL we publish invite links under.
function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function isHostAllowed(
  hostname: string,
  allowList: readonly string[] | null,
): boolean {
  if (!allowList) return true;
  return allowList.includes(hostname.toLowerCase());
}

function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const allowList = parseAllowedHosts();
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost && isHostAllowed(forwardedHost, allowList)) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.trim();
  if (host && isHostAllowed(host, allowList)) {
    const reqProto = new URL(request.url).protocol.replace(":", "");
    return `${reqProto}://${host}`;
  }

  if (allowList && (forwardedHost || host)) {
    console.warn(
      "[POST /api/account/invitations] rejected non-allow-listed host:",
      { forwardedHost, host, allowList },
    );
  } else {
    console.warn(
      "[POST /api/account/invitations] could not derive base URL from request; falling back to marketing domain",
    );
  }
  return "https://wacrm.tech";
}

const MAX_LABEL_LEN = 80;

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const now = new Date();
    const invitations = await prisma.accountInvitation.findMany({
      where: {
        account_id: ctx.accountId,
        accepted_at: null,
        expires_at: { gt: now },
      },
      select: {
        id: true,
        role: true,
        label: true,
        email: true,
        created_by_user_id: true,
        created_at: true,
        expires_at: true,
        accepted_at: true,
        accepted_by_user_id: true,
      },
      orderBy: { created_at: "desc" },
    });

    return NextResponse.json({ invitations });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:inviteCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; expiresInDays?: unknown; label?: unknown; email?: unknown }
      | null;

    const role = body?.role;
    if (!isAccountRole(role) || role === "owner") {
      return NextResponse.json(
        { error: "'role' must be one of admin, agent, viewer" },
        { status: 400 },
      );
    }

    const expiresInDaysRaw = body?.expiresInDays;
    const expiresInDays =
      typeof expiresInDaysRaw === "number" ? expiresInDaysRaw : undefined;
    const expiryDays = clampExpiryDays(expiresInDays);
    const expiresAt = inviteExpiresAt(expiryDays);

    let label: string | null = null;
    if (typeof body?.label === "string") {
      const trimmed = body.label.trim();
      if (trimmed.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `Label must be ${MAX_LABEL_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      label = trimmed === "" ? null : trimmed;
    }

    // Optional: who it is for. Then only a login with this address (trimmed,
    // lowercased) can use it — see src/lib/auth/claim-invitation.ts.
    let email: string | null = null;
    if (body?.email !== undefined && body?.email !== null && body?.email !== "") {
      email = normaliseInviteEmail(body.email);
      if (!email) {
        return NextResponse.json({ error: "Enter a valid email address, or leave it empty" }, { status: 400 });
      }
    }

    const { token, hash } = generateInviteToken();

    const invitation = await prisma.accountInvitation.create({
      data: {
        account_id: ctx.accountId,
        token_hash: hash,
        role,
        created_by_user_id: ctx.userId,
        label,
        email,
        expires_at: expiresAt,
      },
      select: {
        id: true,
        role: true,
        label: true,
        email: true,
        expires_at: true,
        created_at: true,
      },
    });

    return NextResponse.json(
      {
        invitation,
        token,
        url: inviteUrl(token, getBaseUrl(request)),
        expiresInDays: expiryDays,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
