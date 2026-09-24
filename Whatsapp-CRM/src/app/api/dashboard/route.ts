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

    switch (section) {
      case "metrics":
        return NextResponse.json(await loadMetrics(ctx.accountId));
      case "series":
        return NextResponse.json(await loadConversationsSeries(ctx.accountId, rangeDays));
      case "response-time":
        return NextResponse.json(await loadResponseTime(ctx.accountId));
      case "activity":
        return NextResponse.json(await loadActivity(ctx.accountId, limit, withDetail));
      case "crm":
      case "crm_stats":
        return NextResponse.json(await loadCRMStats(ctx.accountId));
      case "overview": {
        // Everything the dashboard shows, in one round trip.
        const [metrics, series, responseTime, activity, crm, sparks] = await Promise.all([
          loadMetrics(ctx.accountId),
          loadConversationsSeries(ctx.accountId, rangeDays),
          loadResponseTime(ctx.accountId),
          loadActivity(ctx.accountId, 8, withDetail),
          loadCRMStats(ctx.accountId),
          loadSparks(ctx.accountId, 7),
        ]);
        return NextResponse.json({ metrics, series, responseTime, activity, crm, sparks });
      }
      default: {
        const [metrics, series, responseTime, activity] = await Promise.all([
          loadMetrics(ctx.accountId),
          loadConversationsSeries(ctx.accountId, rangeDays),
          loadResponseTime(ctx.accountId),
          loadActivity(ctx.accountId, limit, withDetail),
        ]);
        return NextResponse.json({ metrics, series, responseTime, activity });
      }
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
