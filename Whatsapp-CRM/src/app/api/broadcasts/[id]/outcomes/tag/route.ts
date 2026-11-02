import { NextRequest, NextResponse } from "next/server";
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account";
import { contactsInOutcome } from "@/lib/broadcasts/outcome-audience";
import { isOutcome } from "@/lib/broadcasts/outcomes";
import { addTagsToContacts } from "@/lib/contacts/tag-events";
import { audit, auditCtx } from "@/lib/audit";

/**
 * POST /api/broadcasts/[id]/outcomes/tag   { outcome, tagId }
 *
 * Tags everyone in one group of this broadcast ("Replied" → "Interested").
 * Goes through addTagsToContacts, so "Tag added" automations run for each
 * newly tagged person, once — tagging the same group twice adds nothing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent");
    assertPageAccess(ctx, "/broadcasts");
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { outcome?: unknown; tagId?: unknown } | null;

    if (!isOutcome(body?.outcome)) return NextResponse.json({ error: "Choose a group." }, { status: 400 });
    if (typeof body?.tagId !== "string" || !body.tagId) return NextResponse.json({ error: "Choose a tag." }, { status: 400 });

    const tag = await ctx.db.tag.findFirst({ where: { id: body.tagId, account_id: ctx.accountId }, select: { id: true, name: true } });
    if (!tag) return NextResponse.json({ error: "That tag was not found." }, { status: 404 });

    const contactIds = await contactsInOutcome(ctx.db, ctx.accountId, id, body.outcome);
    if (contactIds === null) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const added = await addTagsToContacts({
      accountId: ctx.accountId,
      pairs: contactIds.map((contactId) => ({ contactId, tagId: tag.id })),
      source: "broadcast",
    });
    await audit({ ...auditCtx(req, ctx), correlationId: crypto.randomUUID() }, {
      action: "record.bulk_updated",
      target: { type: "broadcast", id },
      meta: { count: added.length, inGroup: contactIds.length, outcome: body.outcome, tag: tag.name, tagId: tag.id },
    });
    return NextResponse.json({ tag: tag.name, inGroup: contactIds.length, added: added.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
