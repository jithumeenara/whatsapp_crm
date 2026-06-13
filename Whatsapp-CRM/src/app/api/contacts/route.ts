import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"

const PAGE_SIZE = 25

/**
 * GET /api/contacts
 *
 * Query params:
 *   search  — filters by name, phone, or email (case-insensitive)
 *   page    — 0-based page index (default 0)
 *   limit   — page size (default 25, max 100)
 *
 * Returns: { contacts, total }
 * Each contact includes a `tags` array of Tag objects.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("viewer")
    const { searchParams } = req.nextUrl

    const search = searchParams.get("search")?.trim() ?? ""
    const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10) || 0)
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? String(PAGE_SIZE), 10) || PAGE_SIZE),
    )
    const skip = page * limit

    const where = {
      account_id: ctx.accountId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
        include: {
          tags: {
            include: { tag: true },
          },
        },
      }),
      prisma.contact.count({ where }),
    ])

    // Flatten tags relation → flat tag objects
    const shaped = contacts.map(({ tags: contactTags, ...c }) => ({
      ...c,
      tags: contactTags.map((ct) => ct.tag),
    }))

    return NextResponse.json({ contacts: shaped, total })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/contacts
 * Creates a new contact for the current account.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("agent")
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const { phone, name, email, company, avatar_url } = body as Record<string, string | undefined>
    if (!phone) return NextResponse.json({ error: "phone is required" }, { status: 400 })

    const contact = await prisma.contact.create({
      data: {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        phone,
        name: name ?? null,
        email: email ?? null,
        company: company ?? null,
        avatar_url: avatar_url ?? null,
      },
    })

    return NextResponse.json({ contact }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
