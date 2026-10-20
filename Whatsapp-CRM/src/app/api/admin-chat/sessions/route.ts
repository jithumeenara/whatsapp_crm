import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { writeAudit } from '@/lib/admin-chat/audit'

/**
 * POST /api/admin-chat/sessions { action: 'end_all' } — the kill switch:
 * every open Admin Chat session of this account ends now. Anyone who
 * wants back in must send the keyword and a fresh code again.
 */

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => ({}))) as { action?: unknown }
    if (body.action !== 'end_all') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    const ended = await prisma.adminChatSession.updateMany({
      where: { account_id: ctx.accountId, state: { not: 'ended' } },
      data: { state: 'ended', ended_at: new Date(), end_reason: 'ended_by_owner', history: [] },
    })
    await writeAudit({ accountId: ctx.accountId, event: 'all_sessions_ended', actorUserId: ctx.userId, detail: { sessions: ended.count } })
    return NextResponse.json({ ok: true, ended: ended.count })
  } catch (err) {
    return toErrorResponse(err)
  }
}
