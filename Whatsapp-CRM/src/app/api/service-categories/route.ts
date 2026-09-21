import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * The list of subjects this business handles.
 *
 *   GET — anyone on the account. Agents need it to correct a category
 *         on the review screen, so gating it to admins would break the
 *         one screen that keeps the assistant honest.
 *   PUT — admin+. Replaces the whole list.
 *
 * ── Why PUT the whole list rather than four endpoints ───────────────
 *
 * This is a short list somebody edits in one sitting: add two, rename
 * one, drop one, save. Per-item create/update/delete would mean four
 * endpoints, four permission checks and a screen that fires a request
 * per keystroke — for a list that is never longer than twenty rows.
 *
 * ── Why removed rows are deactivated, not deleted ───────────────────
 *
 * Judgements, leads and agent skills all point at a category by its
 * key. Deleting the row would leave every one of those pointing at
 * nothing, and the accuracy report would start naming categories it
 * could not explain. So a category that leaves the list is marked
 * inactive: it stops being offered, and everything that already
 * referred to it still reads correctly.
 */

const MAX_CATEGORIES = 20

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const categories = await prisma.serviceCategory.findMany({
      where: { account_id: ctx.accountId, active: true },
      orderBy: { sort_order: 'asc' },
      select: { id: true, key: true, label: true, hint: true, sort_order: true },
    })
    return NextResponse.json({ categories })
  } catch (err) {
    return toErrorResponse(err)
  }
}

type Incoming = { key?: unknown; label?: unknown; hint?: unknown }

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as { categories?: unknown } | null
    if (!Array.isArray(body?.categories)) {
      return NextResponse.json({ error: "Provide 'categories' as a list." }, { status: 400 })
    }

    const seen = new Set<string>()
    const clean: Array<{ key: string; label: string; hint: string | null }> = []

    for (const raw of body.categories as Incoming[]) {
      const key = String(raw?.key ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40)
      const label = String(raw?.label ?? '').trim().slice(0, 60)
      if (!key || !label) continue
      // Two rows with the same key would make the unique constraint
      // reject the whole save, which is a confusing way to tell somebody
      // they typed a duplicate. Dropped quietly instead.
      if (seen.has(key)) continue
      seen.add(key)
      const hint = String(raw?.hint ?? '').trim().slice(0, 200)
      clean.push({ key, label, hint: hint || null })
    }

    if (clean.length > MAX_CATEGORIES) {
      return NextResponse.json(
        {
          error: `That is more than ${MAX_CATEGORIES} categories. Accuracy falls when categories overlap — broader ones that route correctly beat narrow ones that get guessed between.`,
        },
        { status: 400 },
      )
    }

    // One transaction: a half-applied list would leave the account with
    // categories it never agreed to and judgements sorted into them.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.serviceCategory.findMany({
        where: { account_id: ctx.accountId },
        select: { key: true },
      })
      const keeping = new Set(clean.map((c) => c.key))

      // Gone from the list: hidden, not destroyed. See the note above.
      const dropping = existing.map((e) => e.key).filter((k) => !keeping.has(k))
      if (dropping.length > 0) {
        await tx.serviceCategory.updateMany({
          where: { account_id: ctx.accountId, key: { in: dropping } },
          data: { active: false },
        })
      }

      for (const [i, c] of clean.entries()) {
        await tx.serviceCategory.upsert({
          where: { account_id_key: { account_id: ctx.accountId, key: c.key } },
          // A key coming back after being dropped is reactivated rather
          // than rejected as a duplicate.
          update: { label: c.label, hint: c.hint, sort_order: i, active: true },
          create: {
            account_id: ctx.accountId,
            key: c.key,
            label: c.label,
            hint: c.hint,
            sort_order: i,
          },
        })
      }
    })

    const categories = await prisma.serviceCategory.findMany({
      where: { account_id: ctx.accountId, active: true },
      orderBy: { sort_order: 'asc' },
      select: { id: true, key: true, label: true, hint: true, sort_order: true },
    })
    return NextResponse.json({ categories })
  } catch (err) {
    return toErrorResponse(err)
  }
}
