import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account";
import { audit, auditCtx } from "@/lib/audit";

/**
 * DELETE /api/contact-lists/[id]/members   { contactIds: string[] }
 * Takes people off the list. The contacts stay.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent");
    assertPageAccess(ctx, "/broadcasts");
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { contactIds?: unknown } | null;
    const ids = Array.isArray(body?.contactIds)
      ? (body.contactIds as unknown[]).filter((v): v is string => typeof v === "string").slice(0, 1000)
      : [];
    if (ids.length === 0) return NextResponse.json({ error: "Choose who to remove." }, { status: 400 });
    const list = await ctx.db.contactList.findFirst({ where: { id, account_id: ctx.accountId }, select: { id: true } });
    if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const r = await ctx.db.contactListMember.deleteMany({ where: { list_id: list.id, contact_id: { in: ids } } });
    await ctx.db.contactList.update({ where: { id: list.id }, data: { updated_at: new Date() } });
    await audit(auditCtx(req, ctx), {
      action: "record.updated",
      target: { type: "contact_list", id: list.id, label: null },
      meta: { op: "members_removed", count: r.count, contact_ids: ids.slice(0, 200) },
    });
    return NextResponse.json({ removed: r.count });
  } catch (err) {
    return toErrorResponse(err);
  }
}
