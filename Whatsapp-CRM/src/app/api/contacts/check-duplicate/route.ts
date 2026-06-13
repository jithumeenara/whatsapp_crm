import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { NextRequest, NextResponse } from "next/server"
import { findExistingContact, isExactMatch } from "@/lib/contacts/dedupe"

/**
 * GET /api/contacts/check-duplicate?phone=...
 * Returns { match: null | { contact, exact } } for duplicate detection in the contact form.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const phone = new URL(req.url).searchParams.get("phone")?.trim()

    if (!phone) {
      return NextResponse.json({ match: null })
    }

    const existing = await findExistingContact(ctx.accountId, phone)
    if (!existing) {
      return NextResponse.json({ match: null })
    }

    return NextResponse.json({
      match: {
        contact: { id: existing.id, phone: existing.phone, name: existing.name },
        exact: isExactMatch(existing, phone),
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
