// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it. Field visibility: sensitive fields (email) are returned only
// when the caller is admin+.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { parseWorkingHours } from "@/lib/agents/working-hours";
import type { AccountMember } from "@/types";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const rows = await prisma.profile.findMany({
      where: { account_id: ctx.accountId },
      select: {
        user_id: true,
        full_name: true,
        email: true,
        avatar_url: true,
        account_role: true,
        restrict_to_assigned: true,
        working_hours: true,
        handles_categories: true,
        created_at: true,
        // Presence travels with the roster rather than on an endpoint of
        // its own: every screen that wants to know who is here is
        // already asking who the team is.
        user: { select: { last_seen_at: true, went_offline_at: true } },
      },
      orderBy: { created_at: "asc" },
    });

    // Sent with the roster because the shift editor opens from it, and
    // the business's own clock is the right default for somebody's
    // hours — better than the browser's, which is only ever a guess
    // about where the person setting up the rota happens to be sitting.
    const company = await prisma.companyProfile.findUnique({
      where: { account_id: ctx.accountId },
      select: { timezone: true },
    });

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = rows.flatMap((row) => {
      if (!isAccountRole(row.account_role)) return [];
      // Agent accounts use "{digits}@agent.local" as their internal email.
      // Strip the suffix so the roster shows just the WhatsApp number.
      const emailStr = row.email ?? "";
      const displayEmail = canSeeEmails
        ? emailStr.endsWith("@agent.local")
          ? `WhatsApp: ${emailStr.replace("@agent.local", "")}`
          : emailStr || null
        : null;
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: displayEmail,
          avatar_url: row.avatar_url,
          role: row.account_role,
          restrict_to_assigned: row.restrict_to_assigned,
          joined_at: row.created_at.toISOString(),
          last_seen_at: row.user?.last_seen_at?.toISOString() ?? null,
          // Both, because "last seen two minutes ago" and "pressed Log
          // out one minute ago" are the same person and only the pair
          // says which. See src/lib/agents/presence.ts.
          went_offline_at: row.user?.went_offline_at?.toISOString() ?? null,
          // Parsed here rather than trusted: the column is JSON, so it
          // can hold anything, and a shape nobody can read means "no
          // hours set" rather than an error on the roster screen.
          working_hours: parseWorkingHours(row.working_hours),
          handles_categories: Array.isArray(row.handles_categories)
            ? (row.handles_categories as unknown[]).filter(
                (h): h is string => typeof h === "string",
              )
            : [],
        },
      ];
    });

    return NextResponse.json({ members, account_timezone: company?.timezone ?? null });
  } catch (err) {
    console.error("[GET /api/account/members] error:", err)
    return toErrorResponse(err);
  }
}
