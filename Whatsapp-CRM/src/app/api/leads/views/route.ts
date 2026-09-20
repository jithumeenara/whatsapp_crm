import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * Saved filters, per person.
 *
 * "My hot leads in Malappuram" is three controls set the same way every
 * morning. Setting them again each time is not hard, which is exactly
 * why nobody does it — people settle for the default view and stop
 * using the filters at all. Naming one makes it a place to go.
 *
 * ── What is stored ──────────────────────────────────────────────────
 *
 * Whatever the list was showing, as loose JSON. Not a column per
 * filter: a filter added next year would need a migration, and a filter
 * removed would leave a column nothing reads. Unknown keys are ignored
 * on the way out, so a view saved before a filter existed still opens.
 *
 * Deliberately not the page number or the sort. Those are where you
 * happened to be, not what you were looking at, and restoring somebody
 * to page four of a list that has changed since is worse than opening
 * at the top.
 */

/** Enough for the handful somebody actually returns to. A list of forty
 *  saved views is a filter bar with extra steps. */
const MAX_VIEWS = 12

/** Only these are restored. A key the page stopped reading is dropped
 *  rather than passed through as a filter nothing applies. */
const FILTER_KEYS = ['tab', 'tagId', 'search', 'score', 'district'] as const

function cleanFilters(value: unknown): Record<string, string> {
  const raw = (value ?? {}) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const key of FILTER_KEYS) {
    const v = raw[key]
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 120)
  }
  return out
}

export async function GET(_req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const views = await prisma.leadView.findMany({
      where: { user_id: ctx.userId, account_id: ctx.accountId },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      select: { id: true, name: true, filters: true, sort_order: true },
    })
    return NextResponse.json({
      views: views.map((v) => ({ ...v, filters: cleanFilters(v.filters) })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const body = (await req.json().catch(() => null)) as
      | { name?: string; filters?: unknown }
      | null

    const name = body?.name?.trim().slice(0, 60)
    if (!name) return NextResponse.json({ error: 'Give the view a name.' }, { status: 400 })

    const filters = cleanFilters(body?.filters)
    if (Object.keys(filters).length === 0) {
      // Saving "everything" is saving the default, which is already one
      // click away. Refusing is kinder than a view that does nothing.
      return NextResponse.json(
        { error: 'Set a filter first — there is nothing to save yet.' },
        { status: 400 },
      )
    }

    const count = await prisma.leadView.count({
      where: { user_id: ctx.userId, account_id: ctx.accountId },
    })
    if (count >= MAX_VIEWS) {
      return NextResponse.json(
        { error: `That is ${MAX_VIEWS} views already. Remove one first.` },
        { status: 400 },
      )
    }

    const view = await prisma.leadView.create({
      data: {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        filters,
        sort_order: count,
      },
      select: { id: true, name: true, filters: true, sort_order: true },
    })

    return NextResponse.json({ view }, { status: 201 })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireRole('agent')
    const id = req.nextUrl.searchParams.get('id')?.trim()
    if (!id) return NextResponse.json({ error: 'Which view?' }, { status: 400 })

    // Scoped to the owner in the delete itself. These are personal, and
    // an id from a query string must not reach somebody else's.
    const { count } = await prisma.leadView.deleteMany({
      where: { id, user_id: ctx.userId, account_id: ctx.accountId },
    })
    if (count === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    return NextResponse.json({ deleted: count })
  } catch (err) {
    return toErrorResponse(err)
  }
}
