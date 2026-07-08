import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/db";
import { runBroadcast } from "@/lib/broadcasts/run-broadcast";

/**
 * POST /api/broadcasts/[id]/retry
 *
 * Resets all failed recipients back to "pending" and re-runs the
 * broadcast send loop in the background. Returns 202 immediately.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent");
    const { id } = await params;

    const broadcast = await ctx.db.broadcast.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, status: true },
    });

    if (!broadcast) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (broadcast.status === "sending") {
      return NextResponse.json({ error: "Broadcast is already sending" }, { status: 409 });
    }

    // Count failed recipients to reset
    const failedCount = await ctx.db.broadcastRecipient.count({
      where: { broadcast_id: id, status: "failed" },
    });

    if (failedCount === 0) {
      return NextResponse.json({ error: "No failed recipients to retry" }, { status: 400 });
    }

    // Reset failed recipients to pending
    await ctx.db.broadcastRecipient.updateMany({
      where: { broadcast_id: id, status: "failed" },
      data: { status: "pending", error_message: null, sent_at: null, whatsapp_message_id: null },
    });

    // Mark broadcast as sending and reset failed_count
    await ctx.db.broadcast.update({
      where: { id },
      data: { status: "sending", failed_count: 0 },
    });

    setImmediate(() => {
      runBroadcast(id, ctx.accountId).catch((err) => {
        console.error("[broadcast/retry] fatal error:", err);
        prisma.broadcast
          .update({ where: { id }, data: { status: "failed" } })
          .catch(() => {});
      });
    });

    return NextResponse.json({ ok: true, retrying: failedCount }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
