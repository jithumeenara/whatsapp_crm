import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * Things this business does not offer, and what to say about them.
 *
 *   GET — anyone on the account.
 *   PUT — admin+. Replaces the whole list.
 *
 * ── Why the answer is required and the question alone is not enough ──
 *
 * There is already a box that stops a job enquiry becoming a lead. It
 * keeps the leads list clean and does nothing else: the assistant still
 * has no answer, so it still interrupts somebody, who types "no we
 * don't have a hostel" and goes back to what they were doing.
 *
 * This list carries the reply. That is the entire difference, and it is
 * why `answer` is mandatory rather than optional: an entry without one
 * would silence the alert and leave the customer with nothing, which is
 * worse than the behaviour it replaced.
 *
 * ── Why this list cannot be generated ───────────────────────────────
 *
 * Nothing in a knowledge base distinguishes "we have no hostel" from
 * "nobody has written the hostel page yet". A model asked to guess
 * would eventually tell a customer that a real service does not exist,
 * which is the worst thing this whole system could do. So it starts
 * empty and fills from what actually happens.
 */

const MAX_ENTRIES = 50

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const entries = await prisma.outOfScopeAnswer.findMany({
      where: { account_id: ctx.accountId, active: true },
      orderBy: { created_at: 'asc' },
      select: { id: true, key: true, question: true, answer: true, seen_count: true },
    })
    return NextResponse.json({ entries })
  } catch (err) {
    return toErrorResponse(err)
  }
}

type Incoming = { key?: unknown; question?: unknown; answer?: unknown }

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as { entries?: unknown } | null
    if (!Array.isArray(body?.entries)) {
      return NextResponse.json({ error: "Provide 'entries' as a list." }, { status: 400 })
    }

    const seen = new Set<string>()
    const clean: Array<{ key: string; question: string; answer: string }> = []

    for (const raw of body.entries as Incoming[]) {
      const question = String(raw?.question ?? '').trim().slice(0, 200)
      const answer = String(raw?.answer ?? '').trim().slice(0, 600)
      // An entry with no answer would silence the alert and tell the
      // customer nothing. Refused rather than stored half-made.
      if (!question || !answer) continue

      const key =
        String(raw?.key ?? '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '')
          .slice(0, 40) || slugFrom(question)
      if (!key || seen.has(key)) continue
      seen.add(key)
      clean.push({ key, question, answer })
    }

    if (clean.length > MAX_ENTRIES) {
      return NextResponse.json(
        { error: `That is more than ${MAX_ENTRIES} entries.` },
        { status: 400 },
      )
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.outOfScopeAnswer.findMany({
        where: { account_id: ctx.accountId },
        select: { key: true },
      })
      const keeping = new Set(clean.map((c) => c.key))

      // Deactivated rather than deleted: a judgement recorded last week
      // may point at this key, and the review screen should still be
      // able to say what it matched.
      const dropping = existing.map((e) => e.key).filter((k) => !keeping.has(k))
      if (dropping.length > 0) {
        await tx.outOfScopeAnswer.updateMany({
          where: { account_id: ctx.accountId, key: { in: dropping } },
          data: { active: false },
        })
      }

      for (const c of clean) {
        await tx.outOfScopeAnswer.upsert({
          where: { account_id_key: { account_id: ctx.accountId, key: c.key } },
          update: { question: c.question, answer: c.answer, active: true },
          create: {
            account_id: ctx.accountId,
            key: c.key,
            question: c.question,
            answer: c.answer,
          },
        })
      }
    })

    const entries = await prisma.outOfScopeAnswer.findMany({
      where: { account_id: ctx.accountId, active: true },
      orderBy: { created_at: 'asc' },
      select: { id: true, key: true, question: true, answer: true, seen_count: true },
    })
    return NextResponse.json({ entries })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** A key from the question, for entries typed by hand. Latin letters
 *  only — a Malayalam question would slug to nothing, so it falls back
 *  to a timestamp rather than producing an empty key that silently
 *  drops the row. */
function slugFrom(question: string): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return slug || `entry_${Date.now().toString(36)}`
}
