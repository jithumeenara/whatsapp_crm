import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account";
import { OUTCOME_INFO, isOutcome } from "@/lib/broadcasts/outcomes";

const PAGE = 50;

/**
 * GET    /api/contact-lists/[id]?search=&page=   the list and one page of its people
 * PATCH  /api/contact-lists/[id]   { name?, description? }
 * DELETE /api/contact-lists/[id]   deletes the list only — never a contact
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer");
    assertPageAccess(ctx, "/broadcasts");
    const { id } = await params;
    const list = await ctx.db.contactList.findFirst({
      where: { id, account_id: ctx.accountId },
      select: {
        id: true, name: true, description: true, source: true, source_outcome: true, last_used_at: true, created_at: true,
        source_broadcast: { select: { id: true, name: true } },
        _count: { select: { members: true } },
      },
    });
    if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const search = (req.nextUrl.searchParams.get("search") ?? "").trim().slice(0, 100);
    const page = Math.max(0, Math.min(10_000, Number(req.nextUrl.searchParams.get("page")) || 0));
    const where: Prisma.ContactListMemberWhereInput = {
      list_id: list.id,
      ...(search
        ? { contact: { OR: [{ name: { contains: search, mode: "insensitive" } }, { phone: { contains: search } }] } }
        : {}),
    };
    const [rows, total] = await Promise.all([
      ctx.db.contactListMember.findMany({
        where,
        orderBy: { added_at: "desc" },
        skip: page * PAGE,
        take: PAGE,
        select: { added_at: true, contact: { select: { id: true, name: true, phone: true, opt_in_status: true, blocked_at: true } } },
      }),
      ctx.db.contactListMember.count({ where }),
    ]);
    const { _count, ...rest } = list;
    return NextResponse.json({
      list: {
        ...rest,
        member_count: _count.members,
        source_outcome_label: isOutcome(list.source_outcome) ? OUTCOME_INFO[list.source_outcome].label : null,
      },
      members: rows.map((r) => ({
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
        added_at: r.added_at,
        // Shown so a list never hides that some of its people won't get a send.
        cannot_send: r.contact.opt_in_status === "opted_out" ? "Opted out" : r.contact.blocked_at ? "Blocked" : null,
      })),
      total,
      page,
      pageSize: PAGE,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent");
    assertPageAccess(ctx, "/broadcasts");
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { name?: unknown; description?: unknown } | null;
    const data: { name?: string; description?: string | null } = {};
    if (body?.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 120) return NextResponse.json({ error: "The name must be 1 to 120 characters." }, { status: 400 });
      data.name = name;
    }
    if (body?.description !== undefined) {
      data.description = typeof body.description === "string" ? body.description.trim().slice(0, 500) || null : null;
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    try {
      const r = await ctx.db.contactList.updateMany({ where: { id, account_id: ctx.accountId }, data });
      if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return NextResponse.json({ error: `A list called “${data.name}” already exists.` }, { status: 409 });
      }
      throw err;
    }
    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent");
    assertPageAccess(ctx, "/broadcasts");
    const { id } = await params;
    // The member rows go with the list (ON DELETE CASCADE); the contacts
    // themselves are untouched.
    const r = await ctx.db.contactList.deleteMany({ where: { id, account_id: ctx.accountId } });
    if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
