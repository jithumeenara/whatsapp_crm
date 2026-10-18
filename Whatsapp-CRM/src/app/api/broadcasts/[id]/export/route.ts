import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";
import { businessTimezone } from "@/lib/ai/human-date";
import { OUTCOMES, OUTCOME_INFO, isOutcome, outcomeOf, type Outcome } from "@/lib/broadcasts/outcomes";

/** "2026-10-18 14:30" in the business's own zone, never the server's. */
function stamp(d: Date | null, timeZone: string): string {
  if (!d) return "";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/**
 * GET /api/broadcasts/[id]/export[?outcome=read_no_reply]
 *
 * The recipients as a spreadsheet, one sheet per group (Replied, Read no
 * reply, …), or just the one group asked for. Server-side for the same
 * reason parse-excel and demo-template are — see those routes.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(request, "viewer");
    const { id } = await params;
    const only = request.nextUrl.searchParams.get("outcome");
    if (only !== null && !isOutcome(only)) {
      return NextResponse.json({ error: "Unknown group." }, { status: 400 });
    }

    const broadcast = await ctx.db.broadcast.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { id: true, name: true },
    });
    if (!broadcast) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const recipients = await ctx.db.broadcastRecipient.findMany({
      where: { broadcast_id: broadcast.id },
      orderBy: { created_at: "desc" },
      select: {
        status: true, error_message: true, sent_at: true, delivered_at: true, read_at: true, replied_at: true,
        contact: { select: { name: true, phone: true, email: true } },
      },
    });
    const zone = await businessTimezone(ctx.accountId);

    const groups = new Map<Outcome, Record<string, string>[]>();
    for (const r of recipients) {
      const outcome = outcomeOf(r);
      if (only && outcome !== only) continue;
      const list = groups.get(outcome) ?? [];
      list.push({
        Name: r.contact?.name ?? "",
        Phone: r.contact?.phone ?? "",
        Email: r.contact?.email ?? "",
        Group: OUTCOME_INFO[outcome].label,
        "Sent at": stamp(r.sent_at, zone),
        "Delivered at": stamp(r.delivered_at, zone),
        "Read at": stamp(r.read_at, zone),
        "Replied at": stamp(r.replied_at, zone),
        Reason: r.error_message ?? "",
      });
      groups.set(outcome, list);
    }

    const COLS = ["Name", "Phone", "Email", "Group", "Sent at", "Delivered at", "Read at", "Replied at", "Reason"];
    const wb = new ExcelJS.Workbook();
    const wanted = only ? [only as Outcome] : OUTCOMES.filter((o) => groups.has(o));
    // An empty workbook will not open — always at least one sheet.
    for (const o of wanted.length ? wanted : (["replied"] as Outcome[])) {
      // Sheet names: 31 characters, none of : \ / ? * [ ]
      const sheet = wb.addWorksheet(OUTCOME_INFO[o].label.replace(/[:\\/?*[\]]/g, " ").slice(0, 31));
      sheet.columns = COLS.map((k) => ({ header: k, key: k, width: 20 }));
      (groups.get(o) ?? []).forEach((row) => sheet.addRow(row));
    }

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `broadcast-${broadcast.name.replace(/[^a-z0-9]/gi, "_")}${only ? `-${only}` : ""}.xlsx`;
    // exceljs's bundled Buffer type doesn't line up with this project's
    // @types/node Buffer<ArrayBufferLike> generic — Uint8Array sidesteps
    // the mismatch and is a valid BodyInit either way.
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
