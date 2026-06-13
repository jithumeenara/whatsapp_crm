import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { NextRequest, NextResponse } from "next/server"
import { dedupeByPhone, isUniqueViolation, normalizeKey } from "@/lib/contacts/dedupe"

interface ImportRow {
  phone: string
  name?: string
  email?: string
  company?: string
}

/**
 * POST /api/contacts/import
 * Bulk import contacts from a pre-parsed CSV.
 * Body: { contacts: ImportRow[] }
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const body = await req.json().catch(() => null)
    if (!body || !Array.isArray(body.contacts)) {
      return NextResponse.json({ error: "contacts array required" }, { status: 400 })
    }

    const rows: ImportRow[] = body.contacts
    let imported = 0
    let skipped = 0
    let failed = 0

    // 1) Dedupe within the file
    const { unique, duplicates: inFileDupes } = dedupeByPhone(rows)
    skipped += inFileDupes

    // 2) Skip numbers already in this account
    const existingRows = await prisma.contact.findMany({
      where: { account_id: ctx.accountId },
      select: { phone: true },
    })
    const existing = new Set(existingRows.map((r) => normalizeKey(r.phone)).filter(Boolean))

    const toInsert = unique.filter((row) => {
      if (existing.has(normalizeKey(row.phone))) {
        skipped++
        return false
      }
      return true
    })

    // 3) Batch insert in chunks of 50
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
      }))

      try {
        const result = await prisma.contact.createMany({
          data,
          skipDuplicates: true,
        })
        imported += result.count
        skipped += chunk.length - result.count
      } catch (err) {
        if (isUniqueViolation(err)) {
          // Retry one by one
          for (const row of data) {
            try {
              await prisma.contact.create({ data: row })
              imported++
            } catch (singleErr) {
              if (isUniqueViolation(singleErr)) {
                skipped++
              } else {
                failed++
              }
            }
          }
        } else {
          failed += chunk.length
        }
      }
    }

    return NextResponse.json({ imported, skipped, failed })
  } catch (err) {
    return toErrorResponse(err)
  }
}
