import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import type { AudienceConfig, VariableMapping } from "@/hooks/use-broadcast-sending";

/**
 * GET /api/broadcasts
 * Lists all broadcasts for the current account, newest first.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const broadcasts = await ctx.db.broadcast.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { created_at: "desc" },
    });
    return NextResponse.json({ broadcasts });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/broadcasts
 *
 * Creates a broadcast row and its recipient rows, resolves the audience
 * (including CSV upserts), and returns the broadcast id + the resolved
 * contact list (with custom field values) so the hook can drive the
 * send loop.
 *
 * This is intentionally one coarse endpoint: the hook drives the
 * per-batch Meta sends itself, updating recipient rows as it goes.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const db = ctx.db;

    const body = await request.json() as {
      name: string;
      template_name: string;
      template_language: string;
      variables: Record<string, VariableMapping>;
      audience: AudienceConfig;
    };

    // ── Resolve audience ──────────────────────────────────────
    let contacts = await resolveAudience(ctx, body.audience);

    if (contacts.length === 0) {
      return NextResponse.json(
        { error: "No contacts found for this audience." },
        { status: 422 },
      );
    }

    // ── Create broadcast row ──────────────────────────────────
    const broadcast = await db.broadcast.create({
      data: {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        name: body.name,
        template_name: body.template_name,
        template_language: body.template_language,
        template_variables: body.variables,
        audience_filter: {
          type: body.audience.type,
          tagIds: body.audience.tagIds,
          customField: body.audience.customField,
          excludeTagIds: body.audience.excludeTagIds,
        } as Prisma.InputJsonValue,
        status: "sending",
        total_recipients: contacts.length,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      },
    });

    // ── Insert recipient rows ─────────────────────────────────
    const INSERT_CHUNK = 200;
    for (let i = 0; i < contacts.length; i += INSERT_CHUNK) {
      const chunk = contacts.slice(i, i + INSERT_CHUNK);
      try {
        await db.broadcastRecipient.createMany({
          data: chunk.map((c) => ({
            broadcast_id: broadcast.id,
            contact_id: c.id,
            status: "pending",
          })),
        });
      } catch (err) {
        // Mark broadcast failed and propagate so the client sees the error.
        await db.broadcast.update({
          where: { id: broadcast.id },
          data: { status: "failed", failed_count: contacts.length },
        });
        throw err;
      }
    }

    // ── Fetch recipients with contact + custom values ─────────
    const recipientRows = await db.broadcastRecipient.findMany({
      where: { broadcast_id: broadcast.id },
      include: { contact: true },
    });

    const contactIds = recipientRows
      .map((r) => r.contact?.id)
      .filter((id): id is string => Boolean(id));

    // Bulk-load custom values for all contacts in this broadcast.
    const customValueRows = await db.contactCustomValue.findMany({
      where: { contact_id: { in: contactIds } },
      select: { contact_id: true, custom_field_id: true, value: true },
    });

    // Build index: contactId → { fieldId → value }
    const customValueIndex: Record<string, Record<string, string>> = {};
    for (const row of customValueRows) {
      if (!customValueIndex[row.contact_id]) {
        customValueIndex[row.contact_id] = {};
      }
      customValueIndex[row.contact_id][row.custom_field_id] = row.value ?? "";
    }

    return NextResponse.json({
      broadcastId: broadcast.id,
      recipients: recipientRows.map((r) => ({
        id: r.id,
        contact: r.contact
          ? {
              id: r.contact.id,
              phone: r.contact.phone,
              name: r.contact.name,
              email: r.contact.email,
              company: r.contact.company,
            }
          : null,
        customValues: r.contact ? (customValueIndex[r.contact.id] ?? {}) : {},
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ── Audience resolution helpers ────────────────────────────────────────

type ContactRow = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  user_id: string;
  account_id: string;
};

async function resolveAudience(
  ctx: Awaited<ReturnType<typeof getCurrentAccount>>,
  audience: AudienceConfig,
): Promise<ContactRow[]> {
  const db = ctx.db;
  let contacts: ContactRow[] = [];

  if (audience.type === "all") {
    contacts = await db.contact.findMany({
      where: { account_id: ctx.accountId },
    });
  } else if (
    audience.type === "tags" &&
    audience.tagIds &&
    audience.tagIds.length > 0
  ) {
    const contactTags = await db.contactTag.findMany({
      where: { tag_id: { in: audience.tagIds } },
      select: { contact_id: true },
    });
    const uniqueContactIds = [...new Set(contactTags.map((ct) => ct.contact_id))];
    if (uniqueContactIds.length > 0) {
      contacts = await db.contact.findMany({
        where: { id: { in: uniqueContactIds }, account_id: ctx.accountId },
      });
    }
  } else if (audience.type === "custom_field" && audience.customField) {
    const { fieldId, operator, value } = audience.customField;
    let valueFilter: unknown;
    if (operator === "is") valueFilter = { equals: value };
    else if (operator === "is_not") valueFilter = { not: value };
    else if (operator === "contains") valueFilter = { contains: value, mode: "insensitive" };

    const matches = await db.contactCustomValue.findMany({
      where: { custom_field_id: fieldId, value: valueFilter as never },
      select: { contact_id: true },
    });
    const contactIds = [...new Set(matches.map((m) => m.contact_id))];
    if (contactIds.length > 0) {
      contacts = await db.contact.findMany({
        where: { id: { in: contactIds }, account_id: ctx.accountId },
      });
    }
  } else if (audience.type === "csv" && audience.csvContacts) {
    contacts = await upsertCsvContacts(ctx, audience.csvContacts);
  }

  // Apply exclude tags.
  if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
    const excludeRows = await db.contactTag.findMany({
      where: { tag_id: { in: audience.excludeTagIds } },
      select: { contact_id: true },
    });
    const excludedIds = new Set(excludeRows.map((r) => r.contact_id));
    contacts = contacts.filter((c) => !excludedIds.has(c.id));
  }

  return contacts;
}

async function upsertCsvContacts(
  ctx: Awaited<ReturnType<typeof getCurrentAccount>>,
  csvRows: { phone: string; name?: string }[],
): Promise<ContactRow[]> {
  if (csvRows.length === 0) return [];
  const db = ctx.db;

  // De-duplicate by phone within the CSV.
  const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
  for (const row of csvRows) {
    if (row.phone) uniqueByPhone.set(row.phone, row);
  }
  const phones = [...uniqueByPhone.keys()];

  const existing = await db.contact.findMany({
    where: { account_id: ctx.accountId, phone: { in: phones } },
  });

  const byPhone = new Map<string, ContactRow>();
  for (const c of existing) byPhone.set(c.phone, c);

  const missing = phones
    .filter((p) => !byPhone.has(p))
    .map((phone) => ({
      user_id: ctx.userId,
      account_id: ctx.accountId,
      phone,
      name: uniqueByPhone.get(phone)?.name ?? null,
    }));

  const INSERT_CHUNK = 200;
  for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
    const chunk = missing.slice(i, i + INSERT_CHUNK);
    await db.contact.createMany({ data: chunk, skipDuplicates: true });
    // Re-fetch to get the IDs of newly created contacts.
    const created = await db.contact.findMany({
      where: {
        account_id: ctx.accountId,
        phone: { in: chunk.map((c) => c.phone) },
      },
    });
    for (const c of created) byPhone.set(c.phone, c);
  }

  return phones
    .map((p) => byPhone.get(p))
    .filter((c): c is ContactRow => Boolean(c));
}
