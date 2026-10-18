import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account";
import { liveCounts } from "@/lib/broadcasts/counts";
import { OUTCOMES, OUTCOME_INFO, countOutcomes, isOutcome } from "@/lib/broadcasts/outcomes";

/**
 * GET /api/broadcasts/[id]/outcomes
 *
 * What happened to everyone this broadcast went to, one group each
 * (src/lib/broadcasts/outcomes.ts), plus the follow-ups already sent to
 * those groups and, for a follow-up, the broadcast it follows up.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer");
    assertPageAccess(ctx, "/broadcasts");
    const { id } = await params;

    const broadcast = await ctx.db.broadcast.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, name: true, status: true, parent_broadcast_id: true, parent_outcome: true },
    });
    if (!broadcast) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Every status but 'failed' maps to one group on its own; a failure's
    // group depends on its reason, so only those rows are read in full.
    const [byStatus, failed] = await Promise.all([
      ctx.db.broadcastRecipient.groupBy({
        by: ["status"],
        where: { broadcast_id: broadcast.id, status: { not: "failed" } },
        _count: { _all: true },
      }),
      ctx.db.broadcastRecipient.findMany({
        where: { broadcast_id: broadcast.id, status: "failed" },
        select: { status: true, error_message: true },
      }),
    ]);
    const counts = countOutcomes(failed);
    for (const g of byStatus) {
      const one = countOutcomes([{ status: g.status }]);
      for (const o of OUTCOMES) if (one[o]) counts[o] += g._count._all;
    }

    const [children, parent] = await Promise.all([
      ctx.db.broadcast.findMany({
        where: { parent_broadcast_id: broadcast.id, account_id: ctx.accountId },
        orderBy: { created_at: "asc" },
        select: { id: true, name: true, status: true, parent_outcome: true, total_recipients: true, scheduled_at: true, next_send_at: true, created_at: true },
      }),
      broadcast.parent_broadcast_id
        ? ctx.db.broadcast.findFirst({
            where: { id: broadcast.parent_broadcast_id, account_id: ctx.accountId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
    ]);
    const live = await liveCounts(children.map((c) => c.id));

    return NextResponse.json({
      broadcast: { id: broadcast.id, name: broadcast.name, status: broadcast.status },
      outcomes: OUTCOMES.map((key) => ({ key, ...OUTCOME_INFO[key], count: counts[key] })),
      followUps: children.map((c) => ({
        ...c,
        parent_outcome_label: isOutcome(c.parent_outcome) ? OUTCOME_INFO[c.parent_outcome].label : null,
        ...(live.get(c.id) ?? {}),
      })),
      parent: parent
        ? { ...parent, outcome: broadcast.parent_outcome, outcome_label: isOutcome(broadcast.parent_outcome) ? OUTCOME_INFO[broadcast.parent_outcome].label : null }
        : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
