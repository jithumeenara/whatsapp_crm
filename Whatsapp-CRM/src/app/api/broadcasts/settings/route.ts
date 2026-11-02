import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account";
import { getBroadcastSettings, parseBroadcastSettings } from "@/lib/broadcasts/settings";
import { audit, auditCtx, changedFieldNames } from "@/lib/audit";

/**
 * GET /api/broadcasts/settings   this account's broadcast rules
 * PUT /api/broadcasts/settings   change them (admin)
 *
 * Frequency cap, STOP / START words and the daily-limit retry —
 * src/lib/broadcasts/settings.ts.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer");
    assertPageAccess(ctx, "/broadcasts");
    return NextResponse.json({ settings: await getBroadcastSettings(ctx.accountId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "admin");
    assertPageAccess(ctx, "/broadcasts");
    const parsed = parseBroadcastSettings(await req.json().catch(() => null));
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const v = parsed.value;
    const before = await getBroadcastSettings(ctx.accountId);
    await ctx.db.broadcastSettings.upsert({
      where: { account_id: ctx.accountId },
      create: { account_id: ctx.accountId, ...v },
      update: v,
    });
    await audit(auditCtx(req, ctx), {
      action: "config.other_changed",
      target: { type: "broadcast_settings", id: ctx.accountId, label: "Broadcast rules" },
      meta: { fields: changedFieldNames(before as unknown as Record<string, unknown>, v as unknown as Record<string, unknown>) },
    });
    return NextResponse.json({ settings: v });
  } catch (err) {
    return toErrorResponse(err);
  }
}
