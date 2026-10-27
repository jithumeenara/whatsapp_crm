import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { MAX_IMPORT_ROWS, phoneKey } from "@/lib/contacts/csv-import"
import { loadContactsByNumber } from "@/lib/contacts/import-existing"
import { checkRateLimit } from "@/lib/rate-limit"

/**
 * POST /api/contacts/import/check  { phones: string[] }
 * Which of these numbers are already contacts in this account — for the
 * import preview, before anything is saved. Returns only what the
 * preview shows: the contact's name, company, whether it has an email,
 * and whether it is archived. Matched on the last ten digits, as the
 * import itself does.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const rl = checkRateLimit(`contacts-import-check:${ctx.userId}`, { limit: 30, windowMs: 60_000 })
    if (!rl.success) return NextResponse.json({ error: "Too many checks. Wait a minute." }, { status: 429 })

    const body = await req.json().catch(() => null)
    const phones = Array.isArray(body?.phones) ? (body.phones as unknown[]).filter((p): p is string => typeof p === "string") : null
    if (!phones) return NextResponse.json({ error: "phones array required" }, { status: 400 })
    if (phones.length > MAX_IMPORT_ROWS) {
      return NextResponse.json({ error: `At most ${MAX_IMPORT_ROWS.toLocaleString()} numbers at a time.` }, { status: 400 })
    }
    const find = await loadContactsByNumber(ctx.accountId)
    const existing: Record<string, { name: string | null; company: string | null; hasEmail: boolean; archived: boolean }> = {}
    for (const raw of phones) {
      const phone = raw.slice(0, 40)
      const c = find(phone)
      if (c) existing[phoneKey(phone)] = { name: c.name, company: c.company, hasEmail: !!c.email, archived: !!c.archived_at }
    }
    return NextResponse.json({ existing })
  } catch (err) {
    return toErrorResponse(err)
  }
}
