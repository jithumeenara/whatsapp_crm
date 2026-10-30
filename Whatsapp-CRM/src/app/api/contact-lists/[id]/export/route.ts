import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
// A name like =HYPERLINK(...) stays text in whatever opens the file next.
import { safeText } from "@/lib/reports/excel";
import { requireRoleOrApiKey, toErrorResponse, assertPageAccess } from "@/lib/auth/account";

/** GET /api/contact-lists/[id]/export — the list's people as a spreadsheet. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRoleOrApiKey(req, "viewer");
    assertPageAccess(ctx, "/broadcasts");
    const { id } = await params;
    const list = await ctx.db.contactList.findFirst({ where: { id, account_id: ctx.accountId }, select: { id: true, name: true } });
    if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const rows = await ctx.db.contactListMember.findMany({
      where: { list_id: list.id },
      select: { contact: { select: { name: true, phone: true, email: true, opt_in_status: true } } },
      take: 100_000,
    });
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(list.name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "List");
    sheet.columns = ["Name", "Phone", "Email", "Opted out"].map((k) => ({ header: k, key: k, width: 22 }));
    for (const r of rows) {
      sheet.addRow({
        Name: safeText(r.contact.name ?? ""),
        Phone: r.contact.phone,
        Email: safeText(r.contact.email ?? ""),
        "Opted out": r.contact.opt_in_status === "opted_out" ? "Yes" : "",
      });
    }
    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="list-${list.name.replace(/[^a-z0-9]/gi, "_")}.xlsx"`,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
