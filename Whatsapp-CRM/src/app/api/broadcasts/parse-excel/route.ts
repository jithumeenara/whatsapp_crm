import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account";
import type { ExcelContactRow } from "@/lib/broadcasts/excel-row";

/**
 * POST /api/broadcasts/parse-excel
 *
 * Parses an uploaded contact-list Excel/CSV file and returns the extracted
 * rows as JSON. Deliberately server-side, not client-side: exceljs's
 * browser bundle (dist/exceljs.min.js, resolved via its package.json
 * "browser" field) evaluates a string as JavaScript during its own module
 * init, which this site's CSP (script-src has no 'unsafe-eval' in
 * production) blocks outright — breaking the feature for every visitor
 * regardless of which exceljs API is actually used. Node has no such CSP,
 * so parsing here avoids the problem entirely instead of loosening the
 * browser's script policy.
 */
export async function POST(request: NextRequest) {
  try {
    await requireRoleOrApiKey(request, "agent");

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      return NextResponse.json(
        { error: "Please upload an Excel file (.xlsx, .xls) or CSV (.csv)" },
        { status: 400 },
      );
    }

    const buffer = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) return NextResponse.json({ contacts: [] });

    const results: ExcelContactRow[] = [];
    let headers: string[] = [];

    ws.eachRow((row, rowIndex) => {
      // exceljs row.values is 1-indexed; index 0 is always undefined
      const values = (row.values as unknown[]).slice(1);
      if (rowIndex === 1) {
        headers = values.map((v) => String(v ?? ""));
        return;
      }
      const phoneIdx = headers.findIndex((k) => /phone|mobile|number|whatsapp/i.test(k));
      const nameIdx = headers.findIndex((k) => /name/i.test(k) && !/business/i.test(k));
      const tagIdx = headers.findIndex((k) => /^tags?$/i.test(k.trim()));
      const companyIdx = headers.findIndex((k) => /business|company/i.test(k));
      const raw = phoneIdx >= 0 ? String(values[phoneIdx] ?? "").trim().replace(/\s+/g, "") : "";
      const phone = raw.startsWith("+") ? raw : raw ? `+${raw}` : "";
      const name = nameIdx >= 0 ? String(values[nameIdx] ?? "").trim() || undefined : undefined;
      const company = companyIdx >= 0 ? String(values[companyIdx] ?? "").trim() || undefined : undefined;
      const tagNames = tagIdx >= 0
        ? String(values[tagIdx] ?? "").split(/[,;]+/).map((t) => t.trim()).filter(Boolean)
        : undefined;

      // Any column beyond the recognized ones (phone/name/tag/business)
      // becomes a per-contact Custom Field value, keyed by its header text.
      const customFields: Record<string, string> = {};
      headers.forEach((header, idx) => {
        if (idx === phoneIdx || idx === nameIdx || idx === tagIdx || idx === companyIdx) return;
        const label = header.trim();
        if (!label) return;
        const val = String(values[idx] ?? "").trim();
        if (val) customFields[label] = val;
      });

      if (phone.length >= 7) {
        results.push({
          phone, name, company,
          tagNames: tagNames?.length ? tagNames : undefined,
          customFields: Object.keys(customFields).length ? customFields : undefined,
        });
      }
    });

    return NextResponse.json({ contacts: results });
  } catch (err) {
    return toErrorResponse(err);
  }
}
