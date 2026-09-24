import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'
import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import { findOrCreateContact } from '@/lib/contacts/find-or-create'
import { parseFollowUpInput } from '@/lib/leads/new-follow-up'
import { claimIfUnassigned } from '@/lib/leads/claim'

/**
 * POST /api/leads/follow-up — "call this person back at this time".
 *
 * One form on the Leads page's Follow-up tab: a contact (picked, or a
 * new number), a date, a time and what it is about. Everything that
 * makes it show up where people look happens here, together:
 *
 *  - the contact is found — or created, for a number we have never
 *    seen — within this account only;
 *  - their open lead moves to Follow-up, or one is opened in Follow-up
 *    if they have none, so it appears on this tab;
 *  - the reminder itself is written, which is what fires the callback
 *    alert when it falls due.
 *
 * Every id that reaches the database is one this route looked up in
 * the caller's own account. Nothing is taken from the body on trust.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const body = await req.json().catch(() => null)
    const input = parseFollowUpInput(body)
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 })

    // ── Who ──────────────────────────────────────────────────────────
    let contact: { id: string; name: string | null; phone: string } | null = null
    let contactCreated = false
    if (input.contactId) {
      contact = await prisma.contact.findFirst({
        where: { id: input.contactId, account_id: ctx.accountId },
        select: { id: true, name: true, phone: true },
      })
      if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    } else {
      const found = await findOrCreateContact({
        accountId: ctx.accountId,
        userId: ctx.userId,
        phone: input.phone as string,
        name: input.name,
        alternatePhone: input.alternatePhone,
      })
      contact = found.contact
      contactCreated = found.created
    }

    // ── Their lead ───────────────────────────────────────────────────
    const lead = await prisma.lead.findFirst({
      where: { account_id: ctx.accountId, contact_id: contact.id, status: { not: 'closed' } },
      orderBy: { created_at: 'desc' },
      select: { id: true, title: true, status: true, assigned_to: true },
    })

    // An agent may not take over a colleague's lead by scheduling a
    // call on it. Supervisors and above may, as they can anywhere else.
    if (lead?.assigned_to && lead.assigned_to !== ctx.userId && !canViewAllLeads(ctx.role)) {
      return NextResponse.json(
        { error: 'This customer already has a lead with another agent. Ask them or a supervisor.' },
        { status: 409 },
      )
    }

    // Scheduling a call on a lead nobody holds is picking it up — the
    // conversation and any earlier call-backs come with it.
    if (lead && !lead.assigned_to) {
      await claimIfUnassigned({
        accountId: ctx.accountId,
        leadId: lead.id,
        userId: ctx.userId,
        how: 'by scheduling a follow-up',
      })
    }
    const assignee = lead?.assigned_to ?? ctx.userId
    const label = contact.name || contact.phone

    const result = await prisma.$transaction(async (tx) => {
      let leadId: string
      let created = false
      const previousStatus = lead?.status ?? null

      if (lead) {
        leadId = lead.id
        await tx.lead.update({
          where: { id: lead.id },
          data: { status: 'follow_up', assigned_to: assignee },
        })
      } else {
        const made = await tx.lead.create({
          data: {
            account_id: ctx.accountId,
            user_id: ctx.userId,
            contact_id: contact.id,
            title: label,
            source: 'manual',
            status: 'follow_up',
            score: 'warm',
            notes: input.description,
            assigned_to: assignee,
          },
          select: { id: true },
        })
        leadId = made.id
        created = true
        await tx.leadActivity.create({
          data: {
            account_id: ctx.accountId,
            lead_id: leadId,
            contact_id: contact.id,
            user_id: ctx.userId,
            type: 'created',
            title: 'Lead created',
            description: 'Opened from a scheduled follow-up',
          },
        })
      }

      const followUp = await tx.followUp.create({
        data: {
          account_id: ctx.accountId,
          user_id: ctx.userId,
          contact_id: contact.id,
          lead_id: leadId,
          title: `Follow-up: ${lead?.title ?? label}`,
          note: input.description,
          due_at: input.dueAt,
          assigned_to: assignee,
        },
        select: { id: true, due_at: true },
      })

      await tx.leadActivity.create({
        data: {
          account_id: ctx.accountId,
          lead_id: leadId,
          contact_id: contact.id,
          user_id: ctx.userId,
          type: previousStatus && previousStatus !== 'follow_up' ? 'stage_change' : 'follow_up',
          title: 'Follow-up scheduled',
          description: input.description,
          metadata:
            previousStatus && previousStatus !== 'follow_up'
              ? { previous_status: previousStatus, new_status: 'follow_up', due_at: input.dueAt.toISOString() }
              : { due_at: input.dueAt.toISOString() },
        },
      })

      return { leadId, created, followUp }
    })

    emitToAccount(ctx.accountId, 'lead', {
      eventType: result.created ? 'INSERT' : 'UPDATE',
      new: { id: result.leadId, status: 'follow_up', assigned_to: assignee },
      old: lead ? { id: lead.id, status: lead.status, assigned_to: lead.assigned_to } : {},
    })

    return NextResponse.json(
      { lead_id: result.leadId, lead_created: result.created, contact_created: contactCreated, follow_up: result.followUp },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
