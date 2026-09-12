import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { COMPANY_CATEGORIES, COMPANY_SECTIONS } from '@/lib/ai/company-profile'

/**
 * The account's company details.
 *
 * Readable by any member (it is the business's own public-facing
 * information, and agents benefit from seeing what the bot will say),
 * writable by admins.
 */

const FIELDS = [
  'legal_name', 'display_name', 'category', 'category_other', 'section', 'section_other',
  'about', 'services', 'website', 'email', 'phone', 'address', 'city', 'state',
  'country', 'working_hours', 'languages',
] as const

export async function GET() {
  let accountId: string
  try {
    accountId = (await requireRole('viewer')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const profile = await prisma.companyProfile.findUnique({ where: { account_id: accountId } })
  return NextResponse.json({
    profile,
    // Shipped with the profile so the form's pickers and the server's
    // idea of valid values can't drift apart.
    categories: COMPANY_CATEGORIES,
    sections: COMPANY_SECTIONS,
  })
}

export async function PUT(req: Request) {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const data: Record<string, string | null> = {}
  for (const field of FIELDS) {
    if (!(field in body)) continue
    const value = body[field]
    // Empty string means "clear this", which is different from omitting
    // the field (leave it alone) — so it is stored as null rather than
    // an empty string that would render as a blank line in the prompt.
    data[field] = typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : null
  }

  const profile = await prisma.companyProfile.upsert({
    where: { account_id: accountId },
    update: data,
    create: { account_id: accountId, ...data },
  })

  return NextResponse.json({ profile })
}
