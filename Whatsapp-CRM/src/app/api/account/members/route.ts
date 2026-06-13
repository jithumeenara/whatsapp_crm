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
        created_at: true,
      },
      orderBy: { created_at: "asc" },
    });

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = rows.flatMap((row) => {
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at.toISOString(),
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
