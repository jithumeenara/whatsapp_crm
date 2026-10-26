import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";

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
 * PATCH /api/broadcasts/[id]   { action: "pause" | "resume" | "cancel" }
 *
 * The only status changes a person may make, each allowed from certain
 * states only and applied with a conditional update (so a sweep starting
 * the same broadcast at the same moment wins or loses cleanly):
 *   pause   an event-based broadcast that is listening or sending
 *   resume  an event-based broadcast that is paused or stopped
 *   cancel  a scheduled broadcast or a waiting automatic follow-up
 * It used to write whatever status the body named.
 */
const TRANSITIONS: Record<string, { from: string[]; to: string; eventOnly?: boolean }> = {
  pause: { from: ["active", "sending"], to: "paused", eventOnly: true },
  resume: { from: ["paused", "failed"], to: "active", eventOnly: true },
  cancel: { from: ["scheduled", "waiting", "draft"], to: "cancelled" },
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(request, "agent");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const rule = typeof body?.action === "string" ? TRANSITIONS[body.action] : undefined;
    if (!rule) return NextResponse.json({ error: "Unknown action." }, { status: 400 });

    const broadcast = await ctx.db.broadcast.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, status: true, schedule_type: true },
    });
    if (!broadcast) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (rule.eventOnly && broadcast.schedule_type !== "event") {
      return NextResponse.json({ error: "Only an event-based broadcast can be paused or resumed." }, { status: 400 });
    }
    const changed = await ctx.db.broadcast.updateMany({
      where: { id: broadcast.id, account_id: ctx.accountId, status: { in: rule.from } },
      data: { status: rule.to },
    });
    if (changed.count === 0) {
      return NextResponse.json({ error: `This broadcast is ${broadcast.status} and can't be changed that way now.` }, { status: 409 });
    }
    return NextResponse.json({ ok: true, status: rule.to });
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

    // A broadcast that went out holds every recipient's delivery record;
    // deleting it takes them all. Drafts and scheduled ones are anyone's.
    if (!["draft", "scheduled"].includes(broadcast.status) && !hasMinRole(ctx.role, "admin")) {
      return NextResponse.json(
        { error: "Only an admin can delete a broadcast that has been sent." },
        { status: 403 },
      );
    }

    await ctx.db.broadcast.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
