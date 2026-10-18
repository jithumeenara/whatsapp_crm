import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'

/**
 * GET /api/chatbot/[id]/node-activity?node_key=upd
 *
 * What one step did the last few times it ran, for the builder: "updated
 * Status: Pending → Confirmed", "no row matched", or the exact error. A
 * step that "does nothing" is otherwise invisible from the builder.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const nodeKey = (req.nextUrl.searchParams.get('node_key') ?? '').slice(0, 120)
    if (!nodeKey) return NextResponse.json({ error: 'node_key is required.' }, { status: 400 })
    const flow = await prisma.flow.findFirst({ where: { id, account_id: ctx.accountId }, select: { id: true } })
    if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const events = await prisma.flowRunEvent.findMany({
      where: {
        node_key: nodeKey,
        event_type: { in: ['node_entered', 'error'] },
        flow_run: { flow_id: flow.id, account_id: ctx.accountId },
      },
      orderBy: { created_at: 'desc' },
      take: 40,
      select: {
        event_type: true,
        payload: true,
        created_at: true,
        flow_run: { select: { contact: { select: { name: true, phone: true } } } },
      },
    })
    // The step's own outcome events, not the plain "entered" marker.
    const items = events
      .filter((e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>
        return e.event_type === 'error' || 'found' in p || 'outcome' in p
      })
      .slice(0, 8)
      .map((e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>
        const contact = e.flow_run?.contact
        const who = contact?.name || (contact?.phone && !contact.phone.includes(':') ? contact.phone : null) || 'A customer'
        let result: 'updated' | 'unchanged' | 'created' | 'not_found' | 'error'
        let detail = ''
        if (e.event_type === 'error') {
          result = 'error'
          detail = String(p.error ?? p.reason ?? 'Something went wrong')
        } else if (p.created) {
          result = 'created'
        } else if (p.outcome === 'not_found' || p.found === 0) {
          result = 'not_found'
          detail = typeof p.reason === 'string' ? p.reason : ''
        } else if (Array.isArray(p.changes) && p.changes.length > 0) {
          result = 'updated'
          detail = (p.changes as unknown[]).map(String).join('; ')
        } else {
          result = 'unchanged'
        }
        return { at: e.created_at, who, result, detail: detail.slice(0, 300) }
      })
    return NextResponse.json({ items })
  } catch (err) {
    return toErrorResponse(err)
  }
}
