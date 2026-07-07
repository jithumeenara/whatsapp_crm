import { NextRequest, NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  loadMetrics,
  loadConversationsSeries,
  loadResponseTime,
  loadActivity,
  loadCRMStats,
} from "@/lib/dashboard/queries";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer");
    const { searchParams } = new URL(req.url);
    const section = searchParams.get("section");
    const rangeDays = parseInt(searchParams.get("range") ?? "30", 10);
    const limit = parseInt(searchParams.get("limit") ?? "50", 10);

    switch (section) {
      case "metrics":
        return NextResponse.json(await loadMetrics(ctx.accountId));
      case "series":
        return NextResponse.json(await loadConversationsSeries(ctx.accountId, rangeDays));
      case "response-time":
        return NextResponse.json(await loadResponseTime(ctx.accountId));
      case "activity":
        return NextResponse.json(await loadActivity(ctx.accountId, limit));
      case "crm":
        return NextResponse.json(await loadCRMStats(ctx.accountId));
      default: {
        const [metrics, series, responseTime, activity] = await Promise.all([
          loadMetrics(ctx.accountId),
          loadConversationsSeries(ctx.accountId, rangeDays),
          loadResponseTime(ctx.accountId),
          loadActivity(ctx.accountId, limit),
        ]);
        return NextResponse.json({ metrics, series, responseTime, activity });
      }
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
