import { NextRequest, NextResponse } from "next/server";
import { liveSendableContactWhere } from "@/lib/broadcasts/sendable";
import { cleanName, nameUpdateFor, type NameChoice } from "@/lib/broadcasts/excel-row";
import { MAX_IMPORT_ROWS } from "@/lib/contacts/csv-import";
import { loadContactsByNumber } from "@/lib/contacts/import-existing";
import { Prisma } from "@prisma/client";
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account";
import type { AccountContext } from "@/lib/auth/account";
import type { AudienceConfig, VariableMapping } from "@/hooks/use-broadcast-sending";
import { hasTagRules, parseTagMatch, tagAudienceWhere, tagRuleError, tagsBelongToAccount } from "@/lib/broadcasts/tag-audience";
import { loadTableRule, phoneColumns, tableAudienceMatch, tableRuleError } from "@/lib/broadcasts/table-audience";
import { liveCounts } from "@/lib/broadcasts/counts";
import { contactsInLists, contactsInOutcome } from "@/lib/broadcasts/outcome-audience";
import { listIdsOf } from "@/lib/broadcasts/list-audience";
import { OUTCOME_INFO, isOutcome } from "@/lib/broadcasts/outcomes";
import { isSendWindow } from "@/lib/broadcasts/rules";
import { engagementDays, engagementWhere, isEngagementKind } from "@/lib/broadcasts/engagement";

/**
 * GET /api/broadcasts
 * Lists all broadcasts for the current account, newest first.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer");
    // The data behind /broadcasts. Withholding the page while leaving
    // its API open is what made the old menu-only restriction
    // decorative — anyone signed in could read this by asking.
    assertPageAccess(ctx, '/broadcasts');
    const rows = await ctx.db.broadcast.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { created_at: "desc" },
      include: {
        event_tag: { select: { id: true, name: true } },
        parent: { select: { id: true, name: true } },
      },
    });
    // Counted from the recipients, the same way each broadcast's own page
    // does, so the list and the page can never disagree — and so rows
    // whose stored totals drifted before this fix show right at once.
    const live = await liveCounts(rows.map((b) => b.id));
    const broadcasts = rows.map((b) => ({ ...b, ...(live.get(b.id) ?? {}) }));
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
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(request, "agent");
    // The data behind /broadcasts. Withholding the page while leaving
    // its API open is what made the old menu-only restriction
    // decorative — anyone signed in could read this by asking.
    assertPageAccess(ctx, '/broadcasts');
    const db = ctx.db;

    const body = await request.json() as {
      name: string;
      template_name: string;
      template_language: string;
      variables: Record<string, VariableMapping>;
      audience: AudienceConfig;
      header_media_url?: string;
      /** Which connected number to send from (Finding #14) — optional;
       *  falls back to the account's default number when unset. */
      whatsapp_config_id?: string;
      /** 'now' (default) sends immediately once the caller hits /process,
       *  same as before this field existed. 'once'/'recurring' create the
       *  row as status:'scheduled' instead -- the sweep in
       *  src/lib/broadcasts/sweep.ts picks it up at next_send_at. */
      schedule_type?: "now" | "once" | "recurring" | "after_parent" | "event";
      scheduled_at?: string;
      interval_value?: number;
      interval_unit?: "minutes" | "hours" | "days";
      max_sends?: number;
      /** Whether this campaign's sends may reorder the Inbox. Defaults
       *  to false — see src/lib/broadcasts/run-broadcast.ts. */
      show_in_inbox?: boolean;
      /** 'after_parent': wait this long after the first broadcast finishes. */
      follow_up_delay?: { value?: number; unit?: string };
      /** 'event': send when this tag is added to / removed from someone. */
      event?: { trigger?: string; tag_id?: string; delay_value?: number; delay_unit?: string; include_existing?: boolean };
      /** 'HH:MM-HH:MM' in the business zone, for automatic sends. */
      send_window?: string | null;
    };
    if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 200) {
      return NextResponse.json({ error: "Give the broadcast a name (up to 200 characters)." }, { status: 400 });
    }
    if (typeof body.template_name !== "string" || !body.template_name) {
      return NextResponse.json({ error: "Choose a template." }, { status: 400 });
    }
    const sendWindow = body.send_window == null || body.send_window === "" ? null : body.send_window;
    if (sendWindow !== null && !isSendWindow(sendWindow)) {
      return NextResponse.json({ error: "Send window must look like 09:00-21:00." }, { status: 400 });
    }

    // Automatic follow-up and event-based broadcasts choose their people
    // later (auto-sweep.ts / events.ts) — no audience is resolved now.
    if (body.schedule_type === "after_parent" || body.schedule_type === "event") {
      return createAutomatic(ctx, body, sendWindow);
    }

    if (!body.audience || typeof body.audience !== "object") {
      return NextResponse.json({ error: "Choose who this broadcast goes to." }, { status: 400 });
    }

    // A follow-up goes to one group of an earlier broadcast in this
    // account, and only to a group that may be followed up.
    let parent: { id: string; outcome: string } | null = null;
    if (body.audience.type === "broadcast_outcome") {
      const from = body.audience.fromBroadcast;
      if (!from || typeof from.broadcastId !== "string" || !isOutcome(from.outcome) || !OUTCOME_INFO[from.outcome].followUp) {
        return NextResponse.json({ error: "That group of people cannot get a follow-up." }, { status: 400 });
      }
      const found = await db.broadcast.findFirst({ where: { id: from.broadcastId, account_id: ctx.accountId }, select: { id: true } });
      if (!found) return NextResponse.json({ error: "The first broadcast was not found." }, { status: 404 });
      parent = { id: found.id, outcome: from.outcome };
    }

    if (body.audience.type === "tags") {
      const problem = tagRuleError(body.audience);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      if (!(await tagsBelongToAccount(db, ctx.accountId, body.audience))) {
        return NextResponse.json({ error: "A chosen tag no longer exists. Choose the tags again." }, { status: 400 });
      }
    }

    if (body.audience.type === "csv") {
      const rows: unknown = body.audience.csvContacts;
      if (!Array.isArray(rows) || rows.some((r) => !r || typeof (r as { phone?: unknown }).phone !== "string")) {
        return NextResponse.json({ error: "The Excel list is not valid. Upload the file again." }, { status: 400 });
      }
      if (rows.length > MAX_IMPORT_ROWS) {
        return NextResponse.json({ error: `At most ${MAX_IMPORT_ROWS.toLocaleString()} numbers in one Excel file.` }, { status: 400 });
      }
    }

    if (body.audience.type === "table") {
      const problem = tableRuleError(body.audience.table);
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      const loaded = await loadTableRule(ctx.accountId, body.audience.table!);
      if ("error" in loaded) return NextResponse.json({ error: loaded.error }, { status: 400 });
      const match = await tableAudienceMatch(ctx.accountId, body.audience.table!, phoneColumns(loaded.table.fields));
      if (match.tooMany) {
        return NextResponse.json({ error: "More than 20,000 people match this rule. Narrow it down (for example by batch or month)." }, { status: 400 });
      }
    }

    // ── Resolve audience ──────────────────────────────────────
    const contacts = await resolveAudience(ctx, body.audience);

    if (contacts.length === 0) {
      return NextResponse.json(
        { error: "No contacts found for this audience." },
        { status: 422 },
      );
    }

    // ── Scheduling ──────────────────────────────────────────────
    const scheduleType = body.schedule_type === "recurring" ? "recurring" : body.schedule_type === "once" ? "once" : "now";
    let scheduledAt: Date | null = null;
    let intervalValue: number | undefined;
    let intervalUnit: string | undefined;
    let maxSends = 1;

    if (scheduleType !== "now") {
      if (!body.scheduled_at) {
        return NextResponse.json({ error: "scheduled_at is required for a scheduled or recurring broadcast" }, { status: 400 });
      }
      scheduledAt = new Date(body.scheduled_at);
      if (Number.isNaN(scheduledAt.getTime())) {
        return NextResponse.json({ error: "Invalid scheduled_at" }, { status: 400 });
      }
      if (scheduleType === "recurring") {
        intervalValue = Number(body.interval_value);
        intervalUnit = body.interval_unit;
        if (!intervalValue || intervalValue < 1 || !["minutes", "hours", "days"].includes(intervalUnit ?? "")) {
          return NextResponse.json({ error: "Valid interval_value + interval_unit are required for a recurring broadcast" }, { status: 400 });
        }
        maxSends = Math.max(1, Number(body.max_sends) || 1);
      }
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
        header_media_url: body.header_media_url?.trim() || null,
        whatsapp_config_id: body.whatsapp_config_id?.trim() || null,
        audience_filter: {
          type: body.audience.type,
          tagIds: body.audience.tagIds,
          ...(body.audience.type === "tags" ? { tagMatch: parseTagMatch(body.audience.tagMatch) } : {}),
          ...(body.audience.type === "table" && body.audience.table
            ? {
                table: {
                  tableId: body.audience.table.tableId,
                  fieldKey: body.audience.table.fieldKey,
                  operator: body.audience.table.operator,
                  value: typeof body.audience.table.value === "string" ? body.audience.table.value.slice(0, 200) : undefined,
                },
              }
            : {}),
          customField: body.audience.customField,
          excludeTagIds: body.audience.excludeTagIds,
          ...(parent ? { fromBroadcast: { broadcastId: parent.id, outcome: parent.outcome } } : {}),
          ...(body.audience.type === "list" && listIdsOf(body.audience).length > 0
            ? { listIds: listIdsOf(body.audience), listId: listIdsOf(body.audience)[0] }
            : {}),
          ...(body.audience.type === "engagement" && body.audience.engagement ? { engagement: body.audience.engagement } : {}),
        } as Prisma.InputJsonValue,
        parent_broadcast_id: parent?.id ?? null,
        parent_outcome: parent?.outcome ?? null,
        schedule_type: scheduleType,
        show_in_inbox: body.show_in_inbox === true,
        scheduled_at: scheduledAt,
        next_send_at: scheduledAt,
        interval_value: intervalValue ?? null,
        interval_unit: intervalUnit ?? null,
        max_sends: maxSends,
        // A scheduled/recurring broadcast waits for the sweep; "now" keeps
        // the original behavior where the caller immediately hits /process.
        status: scheduleType === "now" ? "draft" : "scheduled",
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
      // 'now' broadcasts still need the caller to kick off /process; a
      // scheduled/recurring one is left for the sweep to pick up instead.
      scheduled: scheduleType !== "now",
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
  ctx: AccountContext,
  audience: AudienceConfig,
): Promise<ContactRow[]> {
  const db = ctx.db;
  let contacts: ContactRow[] = [];

  // No "has an existing WhatsApp conversation" requirement here — a contact
  // added/tagged/imported but never yet messaged is still a valid broadcast
  // target (often the whole point of a campaign). Invalid numbers (bad
  // format, or an Instagram PSID stored in the phone field) are caught per
  // recipient at actual send time in run-broadcast.ts via isValidE164, which
  // marks that one recipient "failed" instead of excluding it from the
  // audience count/preview entirely.
  //
  // The exceptions are contacts who can never or must never receive one
  // (src/lib/broadcasts/sendable.ts): placeholder "numbers" (email-only
  // contacts, website visitors), anyone who opted out, blocked contacts
  // and merged duplicates. Excluded up front, so the count matches the send.
  const sendable = liveSendableContactWhere(ctx.accountId);

  if (audience.type === "all") {
    contacts = await db.contact.findMany({
      where: sendable,
    });
  } else if (audience.type === "table" && audience.table) {
    // Rows of a Data Store table (or its synced Google Sheet) that meet
    // the rule, reached by the chat that saved them or their phone number.
    const loaded = await loadTableRule(ctx.accountId, audience.table);
    if (!("error" in loaded)) {
      const { contactIds } = await tableAudienceMatch(ctx.accountId, audience.table, phoneColumns(loaded.table.fields));
      contacts = contactIds.length
        ? await db.contact.findMany({ where: { AND: [sendable, { id: { in: contactIds } }] } })
        : [];
    }
  } else if (audience.type === "tags" && hasTagRules(audience)) {
    // Contains (any/all) and Does not contain, in one query — the same
    // rule the count uses (src/lib/broadcasts/tag-audience.ts).
    contacts = await db.contact.findMany({
      where: { AND: [sendable, tagAudienceWhere(audience)] },
    });
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
        where: { id: { in: contactIds }, ...sendable },
      });
    }
  } else if (audience.type === "csv" && audience.csvContacts) {
    const upserted = await upsertCsvContacts(ctx, audience.csvContacts);
    const upsertedIds = upserted.map((c) => c.id);
    contacts = upsertedIds.length > 0
      ? await db.contact.findMany({ where: { id: { in: upsertedIds }, ...sendable } })
      : [];
  } else if (audience.type === "broadcast_outcome" && audience.fromBroadcast && isOutcome(audience.fromBroadcast.outcome)) {
    const ids = await contactsInOutcome(db, ctx.accountId, audience.fromBroadcast.broadcastId, audience.fromBroadcast.outcome);
    contacts = ids && ids.length > 0 ? await db.contact.findMany({ where: { id: { in: ids }, ...sendable } }) : [];
  } else if (audience.type === "engagement" && audience.engagement && isEngagementKind(audience.engagement.kind) && engagementDays(audience.engagement.days)) {
    contacts = await db.contact.findMany({
      where: { AND: [sendable, engagementWhere(ctx.accountId, audience.engagement.kind, engagementDays(audience.engagement.days)!)] },
    });
  } else if (audience.type === "list" && listIdsOf(audience).length > 0) {
    // One list or several: each person once.
    const listIds = listIdsOf(audience);
    const ids = await contactsInLists(db, ctx.accountId, listIds);
    contacts = ids && ids.length > 0 ? await db.contact.findMany({ where: { id: { in: ids }, ...sendable } }) : [];
    if (ids) {
      await db.contactList.updateMany({ where: { id: { in: listIds }, account_id: ctx.accountId }, data: { last_used_at: new Date() } });
    }
  } else if (audience.type === "contacts" && audience.contactIds && audience.contactIds.length > 0) {
    contacts = await db.contact.findMany({
      where: { id: { in: audience.contactIds }, ...sendable },
    });
  }

  // Apply exclude tags (a tag audience already did, in its own query).
  if (audience.type !== "tags" && Array.isArray(audience.excludeTagIds) && audience.excludeTagIds.length > 0) {
    const excludeRows = await db.contactTag.findMany({
      where: { tag_id: { in: audience.excludeTagIds } },
      select: { contact_id: true },
    });
    const excludedIds = new Set(excludeRows.map((r) => r.contact_id));
    contacts = contacts.filter((c) => !excludedIds.has(c.id));
  }

  return contacts;
}

/** Strip everything except digits for phone deduplication. */
function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

interface CsvContactRow {
  phone: string;
  name?: string;
  tagNames?: string[];
  /** "business name"/"company" column — matches Contact.company directly. */
  company?: string;
  /** Every other column, keyed by its header text — becomes a Custom Field
   *  value per contact (see the block below), so it shows up as a "Custom
   *  Field" option in the broadcast's variable-mapping step. */
  customFields?: Record<string, string>;
  /** Already a contact with another name: 'file' takes the file's. */
  nameChoice?: NameChoice;
}

async function upsertCsvContacts(
  ctx: AccountContext,
  csvRows: CsvContactRow[],
): Promise<ContactRow[]> {
  if (csvRows.length === 0) return [];
  const db = ctx.db;

  // De-duplicate CSV rows by digits-only phone so "+91..." and "91..." are the same.
  const uniqueByDigits = new Map<string, CsvContactRow>();
  for (const row of csvRows) {
    if (!row.phone) continue;
    const digits = digitsOnly(row.phone);
    if (digits && !uniqueByDigits.has(digits)) {
      uniqueByDigits.set(digits, row);
    }
  }
  if (uniqueByDigits.size === 0) return [];

  // Existing contacts, matched as the preview matched them (last ten
  // digits, country codes respected) — so "9876543210" saved and
  // "+91 98765 43210" in the file are one person, not a new duplicate.
  const find = await loadContactsByNumber(ctx.accountId);
  const byDigits = new Map<string, ContactRow>();
  const renames: Array<{ id: string; from: string | null; to: string }> = [];
  for (const [digits, row] of uniqueByDigits) {
    const c = find(row.phone);
    if (!c) continue;
    // An archived contact is not sent to, so its name is left as it is.
    const to = c.archived_at ? null : nameUpdateFor(c.name, row);
    if (to) renames.push({ id: c.id, from: c.name, to });
    byDigits.set(digits, { ...c, name: to ?? c.name, user_id: ctx.userId, account_id: ctx.accountId });
  }

  // The name each existing number keeps: a blank one takes the file's, a
  // different one only when the person chose the file's — with a note.
  if (renames.length > 0) {
    const stamp = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date());
    for (let i = 0; i < renames.length; i += 50) {
      const batch = renames.slice(i, i + 50);
      await db.$transaction(async (tx) => {
        for (const r of batch) {
          const done = await tx.contact.updateMany({ where: { id: r.id, account_id: ctx.accountId, merged_into_contact_id: null }, data: { name: r.to } });
          if (done.count === 0) continue;
          await tx.contactNote.create({
            data: { account_id: ctx.accountId, contact_id: r.id, user_id: ctx.userId, note_text: `Name from a broadcast Excel file (${stamp}): ${r.from || "—"} → ${r.to}` },
          });
        }
      });
    }
  }

  // Only create contacts that have no match on digits-only phone.
  const toCreate = [...uniqueByDigits.entries()]
    .filter(([digits]) => !byDigits.has(digits))
    .map(([, row]) => ({
      user_id: ctx.userId,
      account_id: ctx.accountId,
      phone: row.phone,
      name: cleanName(row.name) || null,
      company: cleanName(row.company) || null,
      opt_in_source: "broadcast_csv",
      opt_in_at: new Date(),
    }));

  const INSERT_CHUNK = 200;
  for (let i = 0; i < toCreate.length; i += INSERT_CHUNK) {
    const chunk = toCreate.slice(i, i + INSERT_CHUNK);
    await db.contact.createMany({ data: chunk, skipDuplicates: true });
    const created = await db.contact.findMany({
      where: { account_id: ctx.accountId, phone: { in: chunk.map((c) => c.phone) } },
    });
    for (const c of created) byDigits.set(digitsOnly(c.phone), c);
  }

  // Apply any per-row tag names (from an optional "tag" Excel column) — matched
  // case-insensitively against the account's existing tags. Unknown names are
  // silently skipped rather than auto-created, since the import UI only offers
  // a dropdown of tags that already exist.
  const allTagNames = new Set<string>();
  for (const row of uniqueByDigits.values()) {
    for (const t of row.tagNames ?? []) allTagNames.add(t.toLowerCase());
  }
  if (allTagNames.size > 0) {
    const accountTags = await db.tag.findMany({ where: { account_id: ctx.accountId } });
    const tagIdByName = new Map(accountTags.map((t) => [t.name.toLowerCase(), t.id]));
    const contactTagRows: { contact_id: string; tag_id: string }[] = [];
    for (const [digits, row] of uniqueByDigits) {
      const contact = byDigits.get(digits);
      if (!contact || !row.tagNames) continue;
      for (const name of row.tagNames) {
        const tagId = tagIdByName.get(name.toLowerCase());
        if (tagId) contactTagRows.push({ contact_id: contact.id, tag_id: tagId });
      }
    }
    if (contactTagRows.length > 0) {
      const { addTagsToContacts } = await import("@/lib/contacts/tag-events");
      await addTagsToContacts({
        accountId: ctx.accountId,
        pairs: contactTagRows.map((r) => ({ contactId: r.contact_id, tagId: r.tag_id })),
        source: "import",
      });
    }
  }

  // Any column beyond phone/name/business/tag becomes a Custom Field value
  // per contact — auto-creating the Custom Field (case-insensitively matched
  // against existing ones) the first time its header is seen. This is what
  // lets a "Doctor" or "Appointment Date" Excel column show up as a "Custom
  // Field" option in the broadcast's variable-mapping step afterward.
  const allFieldNames = new Set<string>();
  for (const row of uniqueByDigits.values()) {
    for (const name of Object.keys(row.customFields ?? {})) allFieldNames.add(name);
  }
  if (allFieldNames.size > 0) {
    const existingFields = await db.customField.findMany({ where: { account_id: ctx.accountId } });
    const fieldIdByName = new Map(existingFields.map((f) => [f.field_name.toLowerCase(), f.id]));

    for (const name of allFieldNames) {
      if (fieldIdByName.has(name.toLowerCase())) continue;
      const created = await db.customField.create({
        data: { account_id: ctx.accountId, user_id: ctx.userId, field_name: name, field_type: "text" },
      });
      fieldIdByName.set(name.toLowerCase(), created.id);
    }

    const customValueRows: { contact_id: string; custom_field_id: string; value: string }[] = [];
    for (const [digits, row] of uniqueByDigits) {
      const contact = byDigits.get(digits);
      if (!contact || !row.customFields) continue;
      for (const [name, value] of Object.entries(row.customFields)) {
        const fieldId = fieldIdByName.get(name.toLowerCase());
        if (fieldId && value) customValueRows.push({ contact_id: contact.id, custom_field_id: fieldId, value });
      }
    }
    // One row per (contact, field) already — upsert individually so a
    // re-import updates existing values instead of erroring on the
    // @@unique([contact_id, custom_field_id]) constraint.
    for (const row of customValueRows) {
      await db.contactCustomValue.upsert({
        where: { contact_id_custom_field_id: { contact_id: row.contact_id, custom_field_id: row.custom_field_id } },
        create: row,
        update: { value: row.value },
      });
    }
  }

  return [...uniqueByDigits.keys()]
    .map((digits) => byDigits.get(digits))
    .filter((c): c is ContactRow => Boolean(c));
}

// ── Automatic follow-ups and event-based broadcasts ────────────────────

const UNIT_MINUTES: Record<string, number> = { minutes: 1, hours: 60, days: 1440 };
const MAX_WAIT_MINUTES = 43_200; // 30 days

function toMinutes(value: unknown, unit: unknown): number | null {
  const v = Number(value ?? 0);
  const m = UNIT_MINUTES[String(unit ?? "hours")];
  if (!Number.isFinite(v) || v < 0 || !m) return null;
  const total = Math.round(v * m);
  return total <= MAX_WAIT_MINUTES ? total : null;
}

async function createAutomatic(
  ctx: AccountContext,
  body: {
    name: string;
    template_name: string;
    template_language: string;
    variables: Record<string, VariableMapping>;
    audience: AudienceConfig;
    header_media_url?: string;
    whatsapp_config_id?: string;
    schedule_type?: string;
    show_in_inbox?: boolean;
    follow_up_delay?: { value?: number; unit?: string };
    event?: { trigger?: string; tag_id?: string; delay_value?: number; delay_unit?: string; include_existing?: boolean };
  },
  sendWindow: string | null,
) {
  const db = ctx.db;
  const base = {
    user_id: ctx.userId,
    account_id: ctx.accountId,
    name: body.name.trim(),
    template_name: body.template_name,
    template_language: typeof body.template_language === "string" && body.template_language ? body.template_language : "en_US",
    template_variables: (body.variables ?? {}) as Prisma.InputJsonValue,
    header_media_url: body.header_media_url?.trim() || null,
    whatsapp_config_id: body.whatsapp_config_id?.trim() || null,
    show_in_inbox: body.show_in_inbox === true,
    send_window: sendWindow,
    total_recipients: 0,
  };

  if (body.schedule_type === "after_parent") {
    const from = body.audience?.type === "broadcast_outcome" ? body.audience.fromBroadcast : undefined;
    if (!from || typeof from.broadcastId !== "string" || !isOutcome(from.outcome) || !OUTCOME_INFO[from.outcome].followUp) {
      return NextResponse.json({ error: "An automatic follow-up needs a group of an earlier broadcast." }, { status: 400 });
    }
    const parent = await db.broadcast.findFirst({ where: { id: from.broadcastId, account_id: ctx.accountId }, select: { id: true } });
    if (!parent) return NextResponse.json({ error: "The first broadcast was not found." }, { status: 404 });
    const delay = toMinutes(body.follow_up_delay?.value, body.follow_up_delay?.unit);
    if (delay === null) return NextResponse.json({ error: "The wait must be between 0 minutes and 30 days." }, { status: 400 });

    const b = await db.broadcast.create({
      data: {
        ...base,
        schedule_type: "after_parent",
        status: "waiting",
        parent_broadcast_id: parent.id,
        parent_outcome: from.outcome,
        follow_up_delay_minutes: delay,
        audience_filter: { type: "broadcast_outcome", fromBroadcast: { broadcastId: parent.id, outcome: from.outcome } },
      },
      select: { id: true },
    });
    return NextResponse.json({ broadcastId: b.id, scheduled: true, recipients: [] });
  }

  // Event-based.
  const ev = body.event ?? {};
  if (ev.trigger !== "tag_added" && ev.trigger !== "tag_removed") {
    return NextResponse.json({ error: "Choose when it is sent: a tag added or a tag removed." }, { status: 400 });
  }
  const tag = typeof ev.tag_id === "string"
    ? await db.tag.findFirst({ where: { id: ev.tag_id, account_id: ctx.accountId }, select: { id: true } })
    : null;
  if (!tag) return NextResponse.json({ error: "Choose a tag." }, { status: 400 });
  const delay = toMinutes(ev.delay_value, ev.delay_unit);
  if (delay === null) return NextResponse.json({ error: "The wait must be between 0 minutes and 30 days." }, { status: 400 });

  const b = await db.broadcast.create({
    data: {
      ...base,
      schedule_type: "event",
      status: "active",
      event_trigger: ev.trigger,
      event_tag_id: tag.id,
      event_delay_minutes: delay,
      audience_filter: { type: "event", trigger: ev.trigger, tagId: tag.id },
    },
    select: { id: true },
  });

  // "Also send to people who already have this tag" — once each, like
  // anyone tagged later.
  let queued = 0;
  if (ev.include_existing === true && ev.trigger === "tag_added") {
    const holders = await db.contactTag.findMany({
      where: { tag_id: tag.id, contact: { account_id: ctx.accountId } },
      select: { contact_id: true },
    });
    const { enqueueEventRecipients } = await import("@/lib/broadcasts/events");
    queued = await enqueueEventRecipients(ctx.accountId, b.id, holders.map((h) => h.contact_id), delay);
  }
  return NextResponse.json({ broadcastId: b.id, scheduled: true, recipients: [], queued });
}
