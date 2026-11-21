import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'
import { addTagsToContacts, removeTagsFromContact } from '@/lib/contacts/tag-events'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { audit, auditCtx } from '@/lib/audit'

/**
 * POST /api/leads/bulk-tags  { ids, tag_id, op: 'add' | 'remove' }
 *
 * One tag added to, or taken off, the people behind the selected leads.
 * Never "set these tags": a bulk replace wipes tags people added by hand
 * (the HubSpot trap). Tags live on the contact, as on the lead page and in
 * the Inbox, so the Tag added / Tag removed automations fire as usual.
 *
 * An agent changes only their own leads (same rule as /api/leads/bulk);
 * leads with no contact are skipped and counted.
 */

const MAX_IDS = 200
const LIMIT = { limit: 20, windowMs: 60_000 }

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const ctx = await requireRole('agent')
    assertPageAccess(ctx, '/leads')
    const rl = checkRateLimit(`leads-bulk-tags:${ctx.userId}`, LIMIT)
    if (!rl.success) return rateLimitResponse(rl)

    const body = (await req.json().catch(() => ({}))) as { ids?: unknown; tag_id?: unknown; op?: unknown }
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === 'string' && x.length > 0))] : []
    if (ids.length === 0) return NextResponse.json({ error: 'Select at least one lead.' }, { status: 400 })
    if (ids.length > MAX_IDS) return NextResponse.json({ error: `Select at most ${MAX_IDS} leads at a time.` }, { status: 400 })
    if (body.op !== 'add' && body.op !== 'remove') return NextResponse.json({ error: 'Choose add or remove.' }, { status: 400 })
    const tagId = typeof body.tag_id === 'string' ? body.tag_id : ''
    const tag = tagId ? await prisma.tag.findFirst({ where: { id: tagId, account_id: ctx.accountId }, select: { id: true, name: true } }) : null
    if (!tag) return NextResponse.json({ error: 'Tag not found.' }, { status: 404 })

    const leads = await prisma.lead.findMany({
      where: {
        id: { in: ids },
        account_id: ctx.accountId,
        ...(canViewAllLeads(ctx.role) ? {} : { assigned_to: ctx.userId }),
      },
      select: { id: true, contact_id: true },
    })
    const contactIds = [...new Set(leads.map((l) => l.contact_id).filter((c): c is string => !!c))]
    const noContact = leads.filter((l) => !l.contact_id).length
    const notYours = ids.length - leads.length

    let changed = 0
    if (body.op === 'add') {
      // A person's action: source 'inbox', as on the lead page and in the Inbox.
      const added = await addTagsToContacts({
        accountId: ctx.accountId,
        pairs: contactIds.map((contactId) => ({ contactId, tagId: tag.id })),
        source: 'inbox',
      })
      changed = added.length
    } else {
      for (const contactId of contactIds) {
        const removed = await removeTagsFromContact({ accountId: ctx.accountId, contactId, tagIds: [tag.id], source: 'inbox' })
        if (removed.length > 0) changed++
      }
    }

    await audit(auditCtx(req, ctx), {
      action: 'record.bulk_updated',
      target: { type: 'tag', id: tag.id, label: tag.name },
      meta: { op: body.op === 'add' ? 'tag_added' : 'tag_removed', leads: leads.length, people: contactIds.length, changed },
    })
    return NextResponse.json({ changed, people: contactIds.length, skippedNoContact: noContact, skippedNotYours: notYours })
  } catch (err) {
    return toErrorResponse(err)
  }
}
