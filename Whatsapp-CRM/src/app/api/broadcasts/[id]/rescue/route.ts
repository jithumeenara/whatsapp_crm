import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";

/**
 * POST /api/broadcasts/[id]/rescue
 *
 * Rescues a broadcast stuck in "sending" state (e.g. the send process
 * crashed or hung before processing recipients). Resets all "pending"
 * recipients to "failed" so the user can click Retry to re-send them.
 * Only works when the broadcast status is exactly "sending".
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
    if (broadcast.status !== "sending") {
      return NextResponse.json(
        { error: "Broadcast is not stuck — status must be 'sending' to rescue" },
        { status: 409 },
      );
    }

    // Reset pending recipients to failed so Retry can re-attempt them
    const { count } = await ctx.db.broadcastRecipient.updateMany({
      where: { broadcast_id: id, status: "pending" },
      data: {
        status: "failed",
        error_message: "Send process died — rescued. Use Retry to re-send.",
      },
    });

    await ctx.db.broadcast.update({
      where: { id },
      data: { status: "failed", failed_count: { increment: count } },
    });

    return NextResponse.json({ ok: true, rescued: count });
  } catch (err) {
    return toErrorResponse(err);
  }
}
