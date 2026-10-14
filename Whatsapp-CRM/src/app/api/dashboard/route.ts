import { NextRequest, NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import {
  loadMetrics,
  loadConversationsSeries,
  loadResponseTime,
  loadActivity,
  loadCRMStats,
  loadSparks,
  loadNewLeads,
} from "@/lib/dashboard/queries";

/** 7, 30 or 90 — whatever was asked, clamped, so a stray query string
 *  cannot make the server scan a year of messages. */
function readRange(searchParams: URLSearchParams): number {
  const raw = parseInt(searchParams.get("range") ?? searchParams.get("days") ?? "30", 10);
  if (!Number.isFinite(raw)) return 30;
  return Math.min(Math.max(raw, 1), 90);
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer");
    const { searchParams } = new URL(req.url);
    const section = searchParams.get("section");
    const rangeDays = readRange(searchParams);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
    // What customers wrote is shown only to people who manage the team;
    // the feed spans the whole account.
    const withDetail = hasMinRole(ctx.role, "supervisor");
    // An agent sees their own work, as in the Inbox: the chats assigned
    // to them, their leads, follow-ups and tasks — not the account's.
    const agentId = ctx.role === "agent" ? ctx.userId : null;

    switch (section) {
      case "metrics":
        return NextResponse.json(await loadMetrics(ctx.accountId, agentId));
      case "series":
        return NextResponse.json(await loadConversationsSeries(ctx.accountId, rangeDays, agentId));
      case "response-time":
        return NextResponse.json(await loadResponseTime(ctx.accountId, agentId));
      case "activity":
        return NextResponse.json(await loadActivity(ctx.accountId, limit, withDetail, agentId));
      case "new-leads":
        return NextResponse.json({
          newLeads: agentId ? await loadNewLeads(ctx.accountId, agentId) : null,
        });
      case "crm":
      case "crm_stats":
        return NextResponse.json(await loadCRMStats(ctx.accountId, agentId));
      case "overview": {
        // Everything the dashboard shows, in one round trip.
        const [metrics, series, responseTime, activity, crm, sparks, newLeads] = await Promise.all([
          loadMetrics(ctx.accountId, agentId),
          loadConversationsSeries(ctx.accountId, rangeDays, agentId),
          loadResponseTime(ctx.accountId, agentId),
          loadActivity(ctx.accountId, 8, withDetail, agentId),
          loadCRMStats(ctx.accountId, agentId),
          loadSparks(ctx.accountId, 7, agentId),
          // The agent's Leads button: what is waiting to be picked up.
          agentId ? loadNewLeads(ctx.accountId, agentId) : Promise.resolve(null),
        ]);
        return NextResponse.json({ metrics, series, responseTime, activity, crm, sparks, newLeads });
      }
      default: {
        const [metrics, series, responseTime, activity] = await Promise.all([
          loadMetrics(ctx.accountId, agentId),
          loadConversationsSeries(ctx.accountId, rangeDays, agentId),
          loadResponseTime(ctx.accountId, agentId),
          loadActivity(ctx.accountId, limit, withDetail, agentId),
        ]);
        return NextResponse.json({ metrics, series, responseTime, activity });
      }
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
