import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
import { isUniqueViolation } from "@/lib/contacts/dedupe"
import { cleanImportRow, MAX_IMPORT_ROWS, phoneKey, planExistingUpdate, type ImportRow } from "@/lib/contacts/csv-import"
import { loadContactsByNumber } from "@/lib/contacts/import-existing"
import { checkRateLimit } from "@/lib/rate-limit"

/**
 * POST /api/contacts/import
 * Bulk import contacts from a pre-parsed CSV.
 * Body: { contacts: Array<{ phone, name?, email?, company?, onExisting? }> }
 *
 * A number already in this account (last ten digits — "+91 98765 43210"
 * and "9876543210" are one person) is skipped, or updated as its row says
 * (fill / name / name_company — see planExistingUpdate). Every update is
 * written as a note on the contact, so it can be seen and undone. An
 * archived contact that is updated comes back.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const rl = checkRateLimit(`contacts-import:${ctx.userId}`, { limit: 10, windowMs: 60_000 })
    if (!rl.success) return NextResponse.json({ error: "Too many imports. Wait a minute." }, { status: 429 })

    const body = await req.json().catch(() => null)
    if (!body || !Array.isArray(body.contacts)) {
      return NextResponse.json({ error: "contacts array required" }, { status: 400 })
    }
    if (body.contacts.length > MAX_IMPORT_ROWS) {
      return NextResponse.json({ error: `At most ${MAX_IMPORT_ROWS.toLocaleString()} contacts at a time. Split the file.` }, { status: 400 })
    }

    let imported = 0
    let updated = 0
    let skipped = 0
    let failed = 0
    // Every row checked again here (the browser's preview is a convenience):
    // a real phone number, a valid email or none, known fields only.
    const rows: ImportRow[] = []
    const seen = new Set<string>()
    for (const raw of body.contacts as unknown[]) {
      const row = cleanImportRow(raw)
      if (!row) { failed++; continue }
      const key = phoneKey(row.phone)
      if (seen.has(key)) { skipped++; continue } // repeated in the file
      seen.add(key)
      rows.push(row)
    }

    // The account's contacts, matched the same way the preview did
    // (real numbers only, oldest first, country codes respected).
    const find = await loadContactsByNumber(ctx.accountId)

    const toInsert: ImportRow[] = []
    const updates: Array<{ id: string; data: Record<string, unknown>; note: string }> = []
    const stamp = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date())
    for (const row of rows) {
      const current = find(row.phone)
      if (!current) { toInsert.push(row); continue }
      const plan = planExistingUpdate(
        { name: current.name, company: current.company, email: current.email, archived: !!current.archived_at },
        row,
        row.onExisting ?? "skip",
      )
      if (!plan) { skipped++; continue }
      updates.push({
        id: current.id,
        data: { ...plan.patch, ...(current.archived_at ? { archived_at: null, archived_by: null } : {}) },
        note: `Updated by import (${stamp}): ${plan.note}${current.archived_at ? " — restored from Archived" : ""}`,
      })
    }

    // Updates in batches: each change and its note together, the note only
    // when the contact was really changed (not merged or gone meanwhile).
    for (let i = 0; i < updates.length; i += 50) {
      const batch = updates.slice(i, i + 50)
      try {
        const done = await prisma.$transaction(async (tx) => {
          let n = 0
          for (const u of batch) {
            const r = await tx.contact.updateMany({ where: { id: u.id, account_id: ctx.accountId, merged_into_contact_id: null }, data: u.data })
            if (r.count === 0) continue
            await tx.contactNote.create({ data: { account_id: ctx.accountId, contact_id: u.id, user_id: ctx.userId, note_text: u.note } })
            n++
          }
          return n
        })
        updated += done
        skipped += batch.length - done
      } catch (err) {
        console.error("[contacts import] update batch failed:", err instanceof Error ? err.message : err)
        failed += batch.length
      }
    }

    // New contacts, in chunks of 50.
    const chunkSize = 50
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize)
      const data = chunk.map((row) => ({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        phone: row.phone,
        name: row.name || null,
        email: row.email || null,
        company: row.company || null,
        opt_in_source: "csv_import",
        opt_in_at: new Date(),
      }))
      try {
        const result = await prisma.contact.createMany({ data, skipDuplicates: true })
        imported += result.count
        skipped += chunk.length - result.count
      } catch (err) {
        if (!isUniqueViolation(err)) { failed += chunk.length; continue }
        // One at a time: the clashing row is skipped, the rest go in.
        for (const row of data) {
          try {
            await prisma.contact.create({ data: row })
            imported++
          } catch (singleErr) {
            if (isUniqueViolation(singleErr)) skipped++
            else failed++
          }
        }
      }
    }

    return NextResponse.json({ imported, updated, skipped, failed })
  } catch (err) {
    return toErrorResponse(err)
  }
}
