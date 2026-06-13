import { NextResponse } from "next/server";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/**
 * PATCH /api/broadcasts/[id]/recipients
 *
 * Batch-updates broadcast_recipients status after sending.
 * Body: { updates: Array<{ id: string; status: string; sent_at?: string;
 *           whatsapp_message_id?: string; error_message?: string }> }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id: broadcastId } = await params;
    const body = await request.json() as {
      updates: Array<{
        id: string;
        status: string;
        sent_at?: string;
        whatsapp_message_id?: string;
        error_message?: string;
      }>;
    };

    // Verify broadcast belongs to this account.
    const broadcast = await ctx.db.broadcast.findUnique({
      where: { id: broadcastId },
      select: { account_id: true },
    });
    if (!broadcast || broadcast.account_id !== ctx.accountId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Apply each update in parallel (each is a simple PK-based row update).
    await Promise.all(
      body.updates.map((upd) =>
        ctx.db.broadcastRecipient.update({
          where: { id: upd.id },
          data: {
            status: upd.status,
            ...(upd.sent_at ? { sent_at: new Date(upd.sent_at) } : {}),
            ...(upd.whatsapp_message_id !== undefined
              ? { whatsapp_message_id: upd.whatsapp_message_id }
              : {}),
            ...(upd.error_message !== undefined
              ? { error_message: upd.error_message }
              : {}),
          },
        }),
      ),
    );

    // Update aggregate counts on the broadcast row so the list page and
    // any cached reads stay accurate without needing a live recount.
    const sentInBatch   = body.updates.filter((u) => u.status === "sent").length;
    const failedInBatch = body.updates.filter((u) => u.status === "failed").length;

    if (sentInBatch > 0 || failedInBatch > 0) {
      await ctx.db.broadcast.update({
        where: { id: broadcastId },
        data: {
          ...(sentInBatch   > 0 ? { sent_count:   { increment: sentInBatch } }   : {}),
          ...(failedInBatch > 0 ? { failed_count: { increment: failedInBatch } } : {}),
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
