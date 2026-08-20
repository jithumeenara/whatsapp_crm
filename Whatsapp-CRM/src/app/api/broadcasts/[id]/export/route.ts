import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { format } from "date-fns";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";

/**
 * GET /api/broadcasts/[id]/export
 *
 * Generates the Sent/Failed recipient export for a broadcast. Server-side
 * for the same reason parse-excel and demo-template are — see those routes.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRoleOrApiKey(request, "viewer");
    const { id } = await params;

    const broadcast = await ctx.db.broadcast.findFirst({
      where: { id, account_id: ctx.accountId },
      select: { name: true },
    });
    if (!broadcast) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const recipients = await ctx.db.broadcastRecipient.findMany({
      where: { broadcast_id: id },
      orderBy: { created_at: "desc" },
      include: { contact: true },
    });

    const sent: Record<string, string>[] = [];
    const skipped: Record<string, string>[] = [];
    for (const r of recipients) {
      const row = {
        Name: r.contact?.name ?? "",
        Phone: r.contact?.phone ?? "",
        Email: r.contact?.email ?? "",
        Status: r.status,
        "Sent At": r.sent_at ? format(r.sent_at, "yyyy-MM-dd HH:mm") : "",
        "Delivered At": r.delivered_at ? format(r.delivered_at, "yyyy-MM-dd HH:mm") : "",
        "Read At": r.read_at ? format(r.read_at, "yyyy-MM-dd HH:mm") : "",
        "Replied At": r.replied_at ? format(r.replied_at, "yyyy-MM-dd HH:mm") : "",
        Error: r.error_message ?? "",
      };
      if (r.status === "failed") skipped.push(row);
      else sent.push(row);
    }

    const COLS = ["Name", "Phone", "Email", "Status", "Sent At", "Delivered At", "Read At", "Replied At", "Error"];
    const wb = new ExcelJS.Workbook();
    const sentSheet = wb.addWorksheet("Sent");
    sentSheet.columns = COLS.map((k) => ({ header: k, key: k, width: 20 }));
    sent.forEach((row) => sentSheet.addRow(row));
    const failedSheet = wb.addWorksheet("Failed");
    failedSheet.columns = COLS.map((k) => ({ header: k, key: k, width: 20 }));
    skipped.forEach((row) => failedSheet.addRow(row));

    const buffer = await wb.xlsx.writeBuffer();
    const filename = `broadcast-${broadcast.name.replace(/[^a-z0-9]/gi, "_")}.xlsx`;
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
