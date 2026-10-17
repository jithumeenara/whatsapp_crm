import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { publicOrigin } from '@/lib/email/microsoft/origin'
import { appsScriptFor, pingToken } from '@/lib/google/sheet-two-way'
import { ensureGoogleTables } from '@/lib/google/store'

/**
 * GET — the Apps Script that makes a two-way sheet sync instantly when the
 * sheet changes. Admin only: it contains the link's ping secret. The same
 * script every time (the secret is kept), so opening this again never
 * breaks a script already installed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('admin')
    await ensureGoogleTables()
    const { id } = await params
    const link = await prisma.googleSheetLink.findFirst({
      where: { table_id: id, account_id: ctx.accountId, direction: 'sync' },
      select: { id: true, instant_ping_at: true },
    })
    if (!link) return NextResponse.json({ error: 'Turn on two-way sync first.' }, { status: 400 })
    // Always https for a real host (the script calls from Google's servers).
    const origin = publicOrigin(req).replace(/^http:\/\/(?!localhost|127\.0\.0\.1)/i, 'https://')
    const token = await pingToken(link.id)
    return NextResponse.json(
      { script: appsScriptFor(origin, link.id, token), last_ping_at: link.instant_ping_at },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
