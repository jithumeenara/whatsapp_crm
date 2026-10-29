import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { cleanVerificationInput } from '@/lib/verify/sheet-verify'

/**
 * "Check details" lists — people confirming or correcting their own row
 * of a Google Sheet (src/lib/verify).
 *
 * GET   this account's checks, with how far each has got
 * POST  a new one (admin)
 */

export async function GET() {
  try {
    const ctx = await requireRole('supervisor')
    assertPageAccess(ctx, '/data')
    const list = await prisma.sheetVerification.findMany({
      where: { account_id: ctx.accountId },
      orderBy: { created_at: 'desc' },
      select: { id: true, name: true, spreadsheet_name: true, tab_title: true, deadline: true, status: true, created_at: true },
    })
    const counts = await prisma.sheetVerificationPerson.groupBy({
      by: ['verification_id', 'state'],
      where: { account_id: ctx.accountId, verification_id: { in: list.map((l) => l.id) } },
      _count: { _all: true },
    })
    return NextResponse.json({
      verifications: list.map((l) => {
        const mine = counts.filter((c) => c.verification_id === l.id)
        const n = (s: string[]) => mine.filter((c) => s.includes(c.state)).reduce((a, c) => a + c._count._all, 0)
        return { ...l, done: n(['verified', 'corrected', 'phone']), opened: n(['opened']), tracked: n(['pending', 'opened', 'verified', 'corrected', 'phone']) }
      }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')
    assertPageAccess(ctx, '/data')
    const parsed = cleanVerificationInput(await req.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.problem }, { status: 400 })
    const count = await prisma.sheetVerification.count({ where: { account_id: ctx.accountId } })
    if (count >= 200) return NextResponse.json({ error: 'You have 200 checks already. Delete old ones first.' }, { status: 400 })
    const created = await prisma.sheetVerification.create({
      data: { ...parsed.data, account_id: ctx.accountId, created_by: ctx.userId },
      select: { id: true },
    })
    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
