import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";

/**
 * GET /api/broadcasts/demo-template
 *
 * Generates the sample contact-list Excel file for the broadcast Import
 * Excel step. Server-side for the same reason parse-excel is server-side:
 * exceljs's browser bundle trips this site's production CSP (no
 * 'unsafe-eval' in script-src) just by being loaded, regardless of which
 * feature is used. Generating it here also means the in-cell "tag"
 * dropdown (an exceljs data-validation feature) can safely come back —
 * Node has no such CSP to violate.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(request, "viewer");

    const tags = await ctx.db.tag.findMany({
      where: { account_id: ctx.accountId },
      select: { name: true },
      orderBy: { name: "asc" },
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Contacts");
    ws.columns = [
      { header: "phone", key: "phone", width: 20 },
      { header: "name", key: "name", width: 24 },
      { header: "business name", key: "company", width: 24 },
      { header: "tag", key: "tag", width: 20 },
    ];
    const sampleTag = tags[0]?.name ?? "";
    ws.addRow({ phone: "+919876543210", name: "Jane Doe", company: "Acme Pvt Ltd", tag: sampleTag });
    ws.addRow({ phone: "+15551234567", name: "John Smith", company: "", tag: "" });
    ws.getRow(1).font = { bold: true };

    // In-cell dropdown listing the account's existing tags — safe here
    // (server-side), unlike the same feature generated in the browser.
    if (tags.length > 0) {
      const list = `"${tags.map((t) => t.name).join(",")}"`;
      for (let r = 2; r <= 500; r++) {
        ws.getCell(`D${r}`).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [list],
        };
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    // exceljs's bundled Buffer type doesn't line up with this project's
    // @types/node Buffer<ArrayBufferLike> generic — Uint8Array sidesteps
    // the mismatch and is a valid BodyInit either way.
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="broadcast-contacts-template.xlsx"',
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
