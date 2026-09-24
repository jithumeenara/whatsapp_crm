import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrApiKey, toErrorResponse } from '@/lib/auth/account'
import { canViewAllLeads } from '@/lib/auth/roles'
import { prisma } from '@/lib/db'
import { emitToAccount } from '@/lib/socket'
import { findOrCreateContact } from '@/lib/contacts/find-or-create'
import { normalizeEnteredPhone } from '@/lib/leads/new-follow-up'

const PAGE_SIZE = 25

/** Statuses an unassigned lead can have and still be in New Pool. */
const POOL_STATUSES = ['new', 'follow_up']

const TAB_STATUS_MAP: Record<string, string | null> = {
  new_pool: 'new',
  call_not_connected: 'call_not_connected',
  visited: 'visited',
  appointment_fixed: 'appointment_fixed',
  follow_up: 'follow_up',
  closed: 'closed',
  all: null,
  // Everything this person is working, whatever state it is in. The tab
  // that was missing — see the GET handler for what its absence cost.
  mine: null,
  // Open leads nobody has touched past the account's own threshold.
  overdue: null,
  // What the assistant thinks is a lead and nobody has confirmed yet.
  suggested: null,
  // Leads already in the pool that the assistant read and did not think
  // were an enquiry. Not hidden from the other tabs — collected here so
  // somebody can work through them in one sitting.
  not_enquiry: null,
}

/** A finished lead is history, not work. It stays reachable on its own
 *  tab and in search; it does not sit in a list of things to do. */
const CLOSED = 'closed'

/**
 * Lists leads for one tab.
 *
 * ── The lead that vanished ──────────────────────────────────────────
 *
 * An agent worked out of New Pool, which is `status = new` AND
 * `assigned_to = null`. Claiming a lead sets `assigned_to`, so the row
 * left the list the instant it was claimed — and any status change took
 * it further away. It was still theirs and still open; there was simply
 * no tab that showed it. "All" was the only place it existed, mixed in
 * with every closed lead the account had ever had.
 *
 * So the work an agent has in hand had no home, and the fix is a tab
 * that is exactly that: `mine`.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'viewer')
    const { searchParams } = req.nextUrl

    const tab = searchParams.get('tab')?.trim() ?? 'all'
    const search = searchParams.get('search')?.trim() ?? ''
    const score = searchParams.get('score')?.trim() ?? ''
    const district = searchParams.get('district')?.trim() ?? ''
    const tagId = searchParams.get('tag_id')?.trim() ?? ''
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10) || 0)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? String(PAGE_SIZE), 10) || PAGE_SIZE))

    const isPrivileged = canViewAllLeads(ctx.role)

    const where: Record<string, unknown> = { account_id: ctx.accountId }

    // Tab-based status filter
    const tabStatus = TAB_STATUS_MAP[tab]
    if (tabStatus !== undefined && tabStatus !== null) {
      where.status = tabStatus
    }

    // Closed leads are excluded everywhere except their own tab.
    //
    // "All Leads" meant all of them, closed ones included, so a team
    // three months in had a list that was mostly finished business and
    // a handful of live leads somewhere inside it. The tab people open
    // to see what needs doing should show what needs doing.
    // `everything` is the exception, and the reason it exists.
    //
    // "All Open" answers "what needs doing", which is the right default
    // and the wrong question when somebody is looking for a particular
    // person — that search has to be run twice, once in each tab, and
    // whichever one they try first is the one that comes back empty.
    if (tab !== 'closed' && tab !== 'everything' && tabStatus === null) {
      where.status = { not: CLOSED }
    }

    // Untouched for longer than this account allows.
    //
    // Filtered in SQL rather than marked in the browser: the point of
    // the tab is to find the neglected ones among thousands, and a page
    // of fifty cannot be filtered into a list of what is late.
    if (tab === 'overdue') {
      const settings = await prisma.leadSettings.findUnique({
        where: { account_id: ctx.accountId },
        select: { sla_breach_hours: true },
      })
      const breachHours = settings?.sla_breach_hours ?? 72
      // 0 means the account switched the marking off; the tab then has
      // nothing to say, and says nothing rather than everything.
      where.updated_at =
        breachHours > 0
          ? { lt: new Date(Date.now() - breachHours * 60 * 60 * 1000) }
          : { lt: new Date(0) }
    }

    // A suggestion is not a lead until somebody says so.
    //
    // It sits on its own tab and nowhere else — the whole reason the
    // assistant suggests rather than creates is that its mistakes must
    // not reach the lists people work from. Excluded everywhere else by
    // default, including search, including "all".
    if (tab === 'suggested') {
      where.ai_suggested = true
      where.status = 'new'
    } else {
      where.ai_suggested = false
    }

    if (tab === 'not_enquiry') {
      where.ai_verdict = 'not_enquiry'
      where.status = { not: CLOSED }
    }

    // Pool: what nobody has picked up — new enquiries, and call-backs a
    // customer asked for (the assistant puts those in Follow-up). Both
    // are waiting on whoever takes them, so both belong where agents
    // look for work.
    if (tab === 'new_pool') {
      where.status = { in: POOL_STATUSES }
      where.assigned_to = null
    } else if (tab === 'mine') {
      // Mine, whoever you are. A supervisor asking for "mine" wants
      // theirs, not everyone's.
      where.assigned_to = ctx.userId
    } else if (tab === 'suggested') {
      // Unassigned by definition — nobody has claimed something nobody
      // has agreed is real. Scoping this to assigned_to would show an
      // agent an empty tab forever.
      where.assigned_to = null
    } else if (tab === 'follow_up' && !isPrivileged) {
      // A callback the assistant arranged for a customer nobody has
      // picked yet waits here unclaimed. Agents see those beside their
      // own, the way the pool works, so somebody can pick it up.
      where.AND = [{ OR: [{ assigned_to: ctx.userId }, { assigned_to: null }] }]
    } else if (!isPrivileged) {
      // Agents only see their own leads outside the pool — including on
      // the "all" tab, which used to skip this and leak every agent's
      // leads account-wide (the frontend was papering over that by
      // silently substituting new_pool for "all", which hid an agent's
      // own closed/follow-up leads instead of fixing the real gap).
      where.assigned_to = ctx.userId
    }
    // Privileged users (supervisor+) see all leads in all tabs

    if (score) where.score = score
    if (district) where.district = district

    if (tagId) {
      where.contact = { tags: { some: { tag_id: tagId } } }
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { contact: { name: { contains: search, mode: 'insensitive' } } },
        { contact: { phone: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: page * limit,
        take: limit,
        include: {
          contact: { select: { id: true, name: true, phone: true, avatar_url: true } },
          assignee: { select: { id: true, email: true, profile: { select: { full_name: true, avatar_url: true } } } },
          _count: { select: { activities: true, follow_ups: true, tasks: true } },
        },
      }),
      prisma.lead.count({ where }),
    ])

    // Filter out leads hidden from agents (column may not exist yet — catch gracefully)
    let visibleLeads = leads
    if (!isPrivileged) {
      try {
        const hiddenIds = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM leads
          WHERE account_id = ${ctx.accountId}::uuid AND is_hidden = true
        `
        const hiddenSet = new Set(hiddenIds.map((r) => r.id))
        visibleLeads = leads.filter((l) => !hiddenSet.has(l.id))
      } catch {
        // Column doesn't exist yet — show all leads for agents
      }
    }

    return NextResponse.json({ leads: visibleLeads, total })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, 'agent')
    const body = await req.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const {
      title, contact_id: rawContactId, source, status, score, notes, assigned_to,
      lead_quality, district, place,
      force_create,  // when true: bypass duplicate check and always create
    } = body as Record<string, string | boolean | undefined>
    if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 })

    // ── Who the lead is for ─────────────────────────────────────────────────────
    // A picked contact must be one of this account's. A new number typed
    // into the form (new_contact) is matched to the contact that already
    // has it, or becomes a new one.
    let contact_id: string | undefined
    if (typeof rawContactId === 'string' && rawContactId) {
      const owned = await prisma.contact.findFirst({
        where: { id: rawContactId, account_id: ctx.accountId },
        select: { id: true },
      })
      if (!owned) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
      contact_id = owned.id
    } else if (body.new_contact && typeof body.new_contact === 'object') {
      const nc = body.new_contact as Record<string, unknown>
      const phone = typeof nc.phone === 'string' ? normalizeEnteredPhone(nc.phone) : null
      if (!phone) {
        return NextResponse.json({ error: 'Enter a valid phone number, e.g. 9847012345 or 919847012345' }, { status: 400 })
      }
      let alternatePhone: string | null = null
      if (typeof nc.alternate_phone === 'string' && nc.alternate_phone.trim()) {
        alternatePhone = normalizeEnteredPhone(nc.alternate_phone)
        if (!alternatePhone) {
          return NextResponse.json({ error: 'The alternate number is not a valid phone number' }, { status: 400 })
        }
      }
      const found = await findOrCreateContact({
        accountId: ctx.accountId,
        userId: ctx.userId,
        phone,
        name: typeof nc.name === 'string' ? nc.name.trim().slice(0, 120) || null : null,
        alternatePhone,
      })
      contact_id = found.contact.id
    }

    // ── Duplicate detection ─────────────────────────────────────────────────────
    // When a contact is linked, check whether they already have leads.
    // Return 409 with enough info for the UI to show the duplicate dialog.
    // The caller passes force_create=true to skip this check and proceed anyway.
    if (contact_id && !force_create) {
      const existingLeads = await prisma.lead.findMany({
        where: { contact_id: contact_id as string, account_id: ctx.accountId },
        orderBy: { created_at: 'desc' },
        select: {
          id: true, title: true, status: true, score: true, created_at: true, converted_at: true,
          assigned_to: true,
          assignee: {
            select: {
              id: true, email: true,
              profile: { select: { full_name: true, avatar_url: true } },
            },
          },
          activities: { orderBy: { created_at: 'desc' }, take: 1, select: { created_at: true } },
        },
      })

      if (existingLeads.length > 0) {
        const contact = await prisma.contact.findFirst({
          where: { id: contact_id as string, account_id: ctx.accountId },
          select: { id: true, name: true, phone: true, email: true, avatar_url: true },
        })

        const total  = existingLeads.length
        const active = existingLeads.filter((l) => l.status !== 'closed').length
        const closed = existingLeads.filter((l) => l.status === 'closed').length
        const activeLead = existingLeads.find((l) => l.status !== 'closed') ?? null
        const lastActivityAt = existingLeads
          .flatMap((l) => l.activities)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
          ?.created_at ?? null

        return NextResponse.json(
          {
            duplicate: true,
            contact,
            leads: existingLeads,
            counts: { total, active, closed },
            activeLead,
            lastActivityAt,
          },
          { status: 409 },
        )
      }
    }
    // ── End duplicate detection ─────────────────────────────────────────────────

    const lead = await prisma.lead.create({
      data: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        title: title as string,
        contact_id: (contact_id as string) ?? null,
        source: (source as string) ?? 'manual',
        status: (status as string) ?? 'new',
        score: (score as string) ?? 'warm',
        lead_quality: (lead_quality as string) ?? null,
        district: (district as string) ?? null,
        place: (place as string) ?? null,
        notes: (notes as string) ?? null,
        assigned_to: (assigned_to as string) ?? null,
      },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        assignee: { select: { id: true, email: true, profile: { select: { full_name: true } } } },
      },
    })

    await prisma.leadActivity.create({
      data: {
        account_id: ctx.accountId,
        lead_id: lead.id,
        contact_id: lead.contact_id ?? null,
        user_id: ctx.userId,
        type: 'created',
        title: 'Lead created',
        description: `Lead "${lead.title}" was created`,
      },
    })

    emitToAccount(ctx.accountId, 'lead', { eventType: 'INSERT', new: lead, old: {} })
    return NextResponse.json({ lead }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}
