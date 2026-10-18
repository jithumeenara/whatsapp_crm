import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { runAutomationsForTrigger, type AutomationContext } from '@/lib/automations/engine'
import type { AutomationTriggerType } from '@/types'

const TRIGGERS: readonly AutomationTriggerType[] = [
  'new_message_received', 'first_inbound_message', 'keyword_match', 'new_contact_created',
  'conversation_assigned', 'tag_added', 'tag_removed', 'time_based', 'comment_keyword_match',
]

/**
 * Manual trigger for testing or for external integrations that want
 * to fire automations. Automations send messages, so an admin only; the
 * trigger must be a real one, the contact must belong to this account,
 * and the context is a small plain object — nothing is passed through
 * as the caller wrote it.
 */
export async function POST(request: Request) {
  let accountId: string
  try {
    accountId = (await requireRole('admin')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const triggerType = body?.trigger_type
  if (typeof triggerType !== 'string' || !(TRIGGERS as readonly string[]).includes(triggerType)) {
    return NextResponse.json({ error: 'trigger_type must be one of: ' + TRIGGERS.join(', ') }, { status: 400 })
  }

  let contactId: string | null = null
  if (body?.contact_id !== undefined && body.contact_id !== null) {
    if (typeof body.contact_id !== 'string') return NextResponse.json({ error: 'contact_id must be text' }, { status: 400 })
    const contact = await prisma.contact.findFirst({ where: { id: body.contact_id, account_id: accountId }, select: { id: true } })
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    contactId = contact.id
  }

  const rawContext = body?.context
  if (rawContext !== undefined && (typeof rawContext !== 'object' || rawContext === null || Array.isArray(rawContext))) {
    return NextResponse.json({ error: 'context must be an object' }, { status: 400 })
  }
  if (rawContext && JSON.stringify(rawContext).length > 10_000) {
    return NextResponse.json({ error: 'context is too large' }, { status: 400 })
  }

  await runAutomationsForTrigger({
    accountId,
    triggerType: triggerType as AutomationTriggerType,
    contactId,
    context: (rawContext as AutomationContext | undefined) ?? {},
  })

  return NextResponse.json({ ok: true })
}
