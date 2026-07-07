import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";

/**
 * GET /api/broadcasts/[id]
 * Returns a single broadcast with its recipients (including contact join).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(request, "viewer");
    const { id } = await params;

    const broadcast = await ctx.db.broadcast.findFirst({
      where: { id, account_id: ctx.accountId },
    });
    if (!broadcast) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const recipients = await ctx.db.broadcastRecipient.findMany({
      where: { broadcast_id: id },
      orderBy: { created_at: "desc" },
      include: { contact: true },
    });

    // Always compute aggregate counts live from the recipients table so the
    // stats are accurate even when the stored fields are stale (e.g. rows that
    // were sent before the increment-on-webhook fix was deployed).
    //
    // The funnel is cumulative: a recipient at "replied" also counts toward
    // sent / delivered / read. The status ladder is:
    //   pending → sent → delivered → read → replied
    //                                      └─ failed (terminal, not in ladder)
    const LADDER = ["sent", "delivered", "read", "replied"] as const;
    const ladderRank: Record<string, number> = {};
    LADDER.forEach((s, i) => { ladderRank[s] = i; });

    let sentCount = 0, deliveredCount = 0, readCount = 0, repliedCount = 0, failedCount = 0;
    for (const r of recipients) {
      if (r.status === "failed") { failedCount++; continue; }
      if (r.status === "pending") continue;
      const rank = ladderRank[r.status] ?? -1;
      if (rank >= 0) sentCount++;       // reached at least "sent"
      if (rank >= 1) deliveredCount++;  // reached at least "delivered"
      if (rank >= 2) readCount++;       // reached at least "read"
      if (rank >= 3) repliedCount++;    // reached "replied"
    }

    const broadcastWithLiveCounts = {
      ...broadcast,
      total_recipients: recipients.length,
      sent_count:      sentCount,
      delivered_count: deliveredCount,
      read_count:      readCount,
      replied_count:   repliedCount,
      failed_count:    failedCount,
    };

    return NextResponse.json({ broadcast: broadcastWithLiveCounts, recipients });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/broadcasts/[id]
 *
 * Finalizes a broadcast's status to "sent" or "failed".
 * Called by the hook after the send loop completes.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(request, "agent");
    const { id } = await params;
    const body = await request.json() as { status: string };

    await ctx.db.broadcast.update({
      where: { id, account_id: ctx.accountId },
      data: { status: body.status },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/broadcasts/[id]
 * Deletes a broadcast and its recipients (cascade via DB FK).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(request, "agent");
    const { id } = await params;

    const broadcast = await ctx.db.broadcast.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, status: true },
    });
    if (!broadcast) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (broadcast.status === "sending") {
      return NextResponse.json(
        { error: "Cannot delete a broadcast that is actively sending" },
        { status: 409 },
      );
    }

    await ctx.db.broadcast.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
