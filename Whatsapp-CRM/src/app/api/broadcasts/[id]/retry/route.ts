import { NextRequest, NextResponse } from "next/server";
import { assertPageAccess, requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { runBroadcast } from "@/lib/broadcasts/run-broadcast";
import { refreshBroadcastCounts } from "@/lib/broadcasts/counts";
import { pickRetryable } from "@/lib/broadcasts/retry-rules";

/**
 * POST /api/broadcasts/[id]/retry
 *
 * Resets the failed recipients worth a second try back to "pending" and
 * re-runs the send loop in the background (202). The rest — can't receive,
 * opted out, template problem, or Meta's marketing limit within a day —
 * are counted in `skipped`, never resent.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent");
    // Broadcasts are a page an admin grants; the API keeps the same rule.
    assertPageAccess(ctx, "/broadcasts");
    const limit = checkRateLimit(`broadcast-create:${ctx.userId}`, RATE_LIMITS.broadcastCreate);
    if (!limit.success) return rateLimitResponse(limit);
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

    // Only the failures worth a second try (src/lib/broadcasts/retry-rules.ts):
    // not people who cannot or must not get it, not a template Meta refuses,
    // and Meta's marketing limit only after a day.
    const failed = await ctx.db.broadcastRecipient.findMany({
      where: { broadcast_id: id, status: "failed" },
      select: { id: true, error_message: true, sent_at: true, created_at: true },
    });
    if (failed.length === 0) {
      return NextResponse.json({ error: "No failed recipients to retry" }, { status: 400 });
    }
    const pick = pickRetryable(failed);
    if (pick.retry.length === 0) {
      const why = [
        pick.skipped.too_soon ? `${pick.skipped.too_soon} hit WhatsApp's daily marketing limit for that person — try again tomorrow` : "",
        pick.skipped.cannot_receive ? `${pick.skipped.cannot_receive} cannot receive WhatsApp messages or opted out` : "",
        pick.skipped.template ? `${pick.skipped.template} failed because of the template — fix it in Templates` : "",
      ].filter(Boolean);
      return NextResponse.json({ error: `Nothing to retry now: ${why.join("; ")}.`, skipped: pick.skipped }, { status: 400 });
    }
    const failedCount = pick.retry.length;

    // Reset just those to pending
    await ctx.db.broadcastRecipient.updateMany({
      where: { broadcast_id: id, status: "failed", id: { in: pick.retry } },
      data: { status: "pending", error_message: null, sent_at: null, whatsapp_message_id: null },
    });

    // Mark broadcast as sending and reset failed_count
    await ctx.db.broadcast.update({
      where: { id },
      data: { status: "sending" },
    });
    await refreshBroadcastCounts(id);

    setImmediate(() => {
      runBroadcast(id, ctx.accountId).catch((err) => {
        console.error("[broadcast/retry] fatal error:", err);
        prisma.broadcast
          .update({ where: { id }, data: { status: "failed" } })
          .catch(() => {});
      });
    });

    return NextResponse.json({ ok: true, retrying: failedCount, skipped: pick.skipped }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
