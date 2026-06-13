import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/**
 * GET /api/conversations/unread
 *
 * Returns the total number of conversations that have at least one
 * unread inbound message for the authenticated user's account.
 *
 * Used by useTotalUnread (sidebar badge) which polls this endpoint
 * every 10 seconds instead of subscribing to Supabase realtime.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const total = await ctx.db.conversation.count({
      where: {
        account_id: ctx.accountId,
        unread_count: { gt: 0 },
      },
    });

    return NextResponse.json({ total });
  } catch (err) {
    return toErrorResponse(err);
  }
}
