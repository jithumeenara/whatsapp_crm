import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/db";
import { runBroadcast } from "@/lib/broadcasts/run-broadcast";

/**
 * POST /api/broadcasts/[id]/process
 *
 * Kicks off background server-side sending. Returns 202 immediately —
 * the actual send loop runs in the Node.js event loop after the
 * response is flushed. Safe on a VPS/PM2 process (not serverless).
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
    if (broadcast.status === "sending") {
      return NextResponse.json({ ok: true, message: "Already sending" });
    }

    await ctx.db.broadcast.update({
      where: { id },
      data: { status: "sending" },
    });

    // Fire and forget — runs in Node.js event loop after response is sent.
    setImmediate(() => {
      runBroadcast(id, ctx.accountId).catch((err) => {
        console.error("[broadcast/process] fatal error:", err);
        prisma.broadcast
          .update({ where: { id }, data: { status: "failed" } })
          .catch(() => {});
      });
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
