import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/db'
import { NextResponse } from 'next/server'

/**
 * The callbacks this person is late for.
 *
 * ── What "this person's" means, and why it is not assigned_to ───────
 *
 * The obvious filter is `assigned_to = me`, and it would return
 * nothing. The callbacks the assistant creates are deliberately left
 * unassigned — see ask-callback.ts: "Created by nobody in particular:
 * it belongs to the pool until somebody takes it, exactly like the
 * conversation does." Filtering on the assignee alone would have made
 * this whole alert silently empty, which is the worst way for a feature
 * to fail: it looks built and it never fires.
 *
 * What actually marks a callback as somebody's is that they picked the
 * customer. So a row counts as mine when any of these is true:
 *
 *   - the follow-up names me directly, or
 *   - its lead is assigned to me, or
 *   - it has no lead of its own but its contact has one that is mine.
 *
 * The third case is the common one for an assistant-created callback,
 * which carries a contact and no lead.
 *
 * ── Why unclaimed ones are counted but not listed ───────────────────
 *
 * A callback for a customer nobody has picked belongs to nobody, so
 * nobody is alerted — which is correct, and also a way for a promised
 * call to be missed entirely. Rather than leave that invisible, the
 * count comes back separately. The UI shows it only to somebody who can
 * act on it across the whole account.
 */

/** A promise to ring back that is already late is the point of this. */
export async function GET() {
  try {
    const ctx = await requireRole('agent')
    const now = new Date()

    const mineOrMyCustomers = {
      OR: [
        { assigned_to: ctx.userId },
        { lead: { assigned_to: ctx.userId } },
        {
          lead_id: null,
          contact: { leads: { some: { assigned_to: ctx.userId } } },
        },
      ],
    }

    const base = {
      account_id: ctx.accountId,
      status: 'pending',
      due_at: { lte: now },
    }

    const [due, unclaimed] = await Promise.all([
      prisma.followUp.findMany({
        where: { ...base, ...mineOrMyCustomers },
        // Oldest promise first. Somebody told a customer a time and that
        // time has passed; the one that has been broken longest is the
        // one to fix first.
        orderBy: { due_at: 'asc' },
        take: 50,
        select: {
          id: true,
          title: true,
          note: true,
          due_at: true,
          lead_id: true,
          contact_id: true,
          contact: { select: { id: true, name: true, phone: true } },
          // Where the click should land. A follow-up may carry a lead
          // directly, or reach one through the contact.
          lead: { select: { id: true, status: true } },
        },
      }),
      // Nobody's. Counted, never listed here.
      prisma.followUp.count({
        where: {
          ...base,
          assigned_to: null,
          lead: null,
          contact: { leads: { none: { assigned_to: { not: null } } } },
        },
      }),
    ])

    return NextResponse.json({
      due: due.map((f) => ({
        id: f.id,
        title: f.title,
        note: f.note,
        due_at: f.due_at,
        // One answer for the UI, so it does not have to work out where
        // to send somebody: the lead if there is one, else the contact.
        lead_id: f.lead?.id ?? f.lead_id ?? null,
        contact_id: f.contact?.id ?? f.contact_id ?? null,
        contact_name: f.contact?.name ?? null,
        contact_phone: f.contact?.phone ?? null,
      })),
      unclaimed_count: unclaimed,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
