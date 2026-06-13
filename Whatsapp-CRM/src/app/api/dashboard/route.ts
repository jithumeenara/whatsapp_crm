import { NextRequest, NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  loadMetrics,
  loadConversationsSeries,
  loadPipelineDonut,
  loadResponseTime,
  loadActivity,
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
      case "pipeline":
        return NextResponse.json(await loadPipelineDonut(ctx.accountId));
      case "response-time":
        return NextResponse.json(await loadResponseTime(ctx.accountId));
      case "activity":
        return NextResponse.json(await loadActivity(ctx.accountId, limit));
      default: {
        const [metrics, series, pipeline, responseTime, activity] = await Promise.all([
          loadMetrics(ctx.accountId),
          loadConversationsSeries(ctx.accountId, rangeDays),
          loadPipelineDonut(ctx.accountId),
          loadResponseTime(ctx.accountId),
          loadActivity(ctx.accountId, limit),
        ]);
        return NextResponse.json({ metrics, series, pipeline, responseTime, activity });
      }
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
