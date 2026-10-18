import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account";
import { contactsInOutcome } from "@/lib/broadcasts/outcome-audience";
import { OUTCOME_INFO, isOutcome } from "@/lib/broadcasts/outcomes";

/**
 * Contact lists — fixed, saved sets of people, usable as a broadcast
 * audience (migration 137).
 *
 * GET  /api/contact-lists            this account's lists, newest use first
 * POST /api/contact-lists            { name, description?, fromBroadcast: { broadcastId, outcome } }
 *      saves one group of a broadcast's recipients as a list. The name is
 *      unique per account (any case), so a double click makes one list.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer");
    assertPageAccess(ctx, "/broadcasts");
    const lists = await ctx.db.contactList.findMany({
      where: { account_id: ctx.accountId },
      orderBy: [{ last_used_at: { sort: "desc", nulls: "last" } }, { created_at: "desc" }],
      select: {
        id: true, name: true, description: true, source: true, source_outcome: true,
        last_used_at: true, created_at: true,
        source_broadcast: { select: { id: true, name: true } },
        _count: { select: { members: true } },
      },
    });
    return NextResponse.json({
      lists: lists.map(({ _count, ...l }) => ({ ...l, member_count: _count.members })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent");
    assertPageAccess(ctx, "/broadcasts");
    const body = (await req.json().catch(() => null)) as {
      name?: unknown; description?: unknown; fromBroadcast?: { broadcastId?: unknown; outcome?: unknown };
    } | null;

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Give the list a name." }, { status: 400 });
    if (name.length > 120) return NextResponse.json({ error: "The name can be at most 120 characters." }, { status: 400 });
    const description = typeof body?.description === "string" ? body.description.trim().slice(0, 500) || null : null;

    const from = body?.fromBroadcast;
    if (!from || typeof from.broadcastId !== "string" || !isOutcome(from.outcome)) {
      return NextResponse.json({ error: "Choose the group to save." }, { status: 400 });
    }
    const contactIds = await contactsInOutcome(ctx.db, ctx.accountId, from.broadcastId, from.outcome);
    if (contactIds === null) return NextResponse.json({ error: "That broadcast was not found." }, { status: 404 });
    if (contactIds.length === 0) {
      return NextResponse.json({ error: `Nobody is in “${OUTCOME_INFO[from.outcome].label}” — nothing to save.` }, { status: 422 });
    }

    try {
      const list = await ctx.db.$transaction(async (tx) => {
        const created = await tx.contactList.create({
          data: {
            account_id: ctx.accountId,
            user_id: ctx.userId,
            name,
            description,
            source: "broadcast",
            source_broadcast_id: from.broadcastId as string,
            source_outcome: from.outcome as string,
          },
          select: { id: true, name: true },
        });
        const CHUNK = 1000;
        for (let i = 0; i < contactIds.length; i += CHUNK) {
          await tx.contactListMember.createMany({
            data: contactIds.slice(i, i + CHUNK).map((contact_id) => ({ list_id: created.id, contact_id })),
            skipDuplicates: true,
          });
        }
        return created;
      });
      return NextResponse.json({ list: { ...list, member_count: contactIds.length } }, { status: 201 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json({ error: `A list called “${name}” already exists.` }, { status: 409 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
