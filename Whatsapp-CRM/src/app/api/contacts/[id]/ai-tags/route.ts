import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { addTagsToContact } from '@/lib/contacts/tag-events'

/**
 * The AI's tag decisions for one contact, for the contact panel.
 *
 * GET   suggestions waiting for a person, and the tags the AI added — each
 *       with the customer's own words that led to it.
 * POST  { decision_id, action: 'accept' | 'dismiss' } — accepting adds the
 *       tag (and fires its automations); dismissing means the AI never
 *       suggests it for this contact again.
 */

async function contactInAccount(accountId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  return prisma.contact.findFirst({ where: { id, account_id: accountId }, select: { id: true } })
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('viewer')
    const { id } = await params
    const contact = await contactInAccount(ctx.accountId, id)
    if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
    const rows = await prisma.aiTagDecision.findMany({
      where: { contact_id: contact.id, account_id: ctx.accountId, outcome: { in: ['suggested', 'applied'] } },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: { id: true, tag_id: true, confidence: true, evidence: true, reason: true, outcome: true, created_at: true },
    })
    const tags = await prisma.tag.findMany({ where: { id: { in: rows.map((r) => r.tag_id) }, account_id: ctx.accountId }, select: { id: true, name: true, color: true } })
    const byId = new Map(tags.map((t) => [t.id, t]))
    const shaped = rows
      .filter((r) => byId.has(r.tag_id))
      .map((r) => ({ ...r, tag_name: byId.get(r.tag_id)!.name, tag_color: byId.get(r.tag_id)!.color }))
    return NextResponse.json({
      suggestions: shaped.filter((r) => r.outcome === 'suggested'),
      applied: shaped.filter((r) => r.outcome === 'applied'),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const contact = await contactInAccount(ctx.accountId, id)
    if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
    const body = (await req.json().catch(() => ({}))) as { decision_id?: unknown; action?: unknown }
    const decisionId = typeof body.decision_id === 'string' ? body.decision_id : ''
    if (body.action !== 'accept' && body.action !== 'dismiss') return NextResponse.json({ error: 'Accept or dismiss.' }, { status: 400 })
    const decision = await prisma.aiTagDecision.findFirst({ where: { id: decisionId, contact_id: contact.id, account_id: ctx.accountId, outcome: 'suggested' } })
    if (!decision) return NextResponse.json({ error: 'That suggestion is no longer waiting.' }, { status: 404 })

    // Claimed first: a double tap accepts once.
    const claimed = await prisma.aiTagDecision.updateMany({
      where: { id: decision.id, outcome: 'suggested' },
      data: { outcome: body.action === 'accept' ? 'accepted' : 'dismissed', decided_by: ctx.userId },
    })
    if (claimed.count === 0) return NextResponse.json({ error: 'Already handled.' }, { status: 409 })
    if (body.action === 'accept') {
      await addTagsToContact({ accountId: ctx.accountId, contactId: contact.id, tagIds: [decision.tag_id], source: 'inbox' })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
