import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { clientIpKey } from '@/lib/net/client-ip'
import { corrections } from '@/lib/verify/sheet-verify'
import { readLink } from '@/lib/verify/sheet-verify-link'
import { openLink, viewOf } from '@/lib/verify/verify-public'
import { prisma } from '@/lib/db'
import { isOpen, markOpened, recordAnswer, RowMovedError, setupOf } from '@/lib/verify/sheet-verify-server'
import { verifyStrings } from '@/lib/verify/verify-strings'

/**
 * POST /api/v/<token>  { action: 'confirm' }
 *                      { action: 'correct', values: {header: text}, seen: {header: text} }
 *
 * A person's answer from their private link (no login). The signed link
 * names their one row; only the columns the business allows can change,
 * and the change is written to that row of the business's Google Sheet.
 */

// Per address, generous: many phones share one address on mobile networks
// (CGNAT), and a bulk send makes them all answer at once. The per-link
// limit is what stops one link being hammered.
const PER_IP = { limit: 60, windowMs: 10 * 60_000 }
const PER_LINK = { limit: 10, windowMs: 60 * 60_000 }
const OPENED_PER_IP = { limit: 300, windowMs: 10 * 60_000 }
const OPENED_PER_LINK = { limit: 30, windowMs: 60 * 60_000 }

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const ip = clientIpKey(req.headers)
  const claim = readLink(token)
  if (!claim) return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
  const body = (await req.json().catch(() => null)) as { action?: unknown; values?: unknown; seen?: unknown } | null

  // Sent by the page's script once it shows, so a mail scanner fetching
  // the link does not count as the person opening it. No sheet read, and
  // its own limits: reopening the page never uses up a person's answers.
  if (body?.action === 'opened') {
    if (!checkRateLimit(`verify-opened:${ip}`, OPENED_PER_IP).success || !checkRateLimit(`verify-opened:${claim.v}:${claim.r}`, OPENED_PER_LINK).success) {
      return NextResponse.json({ ok: true })
    }
    const v = await prisma.sheetVerification.findUnique({ where: { id: claim.v } }).catch(() => null)
    if (v && v.key_version === claim.k && isOpen(v)) await markOpened(v, claim.r).catch((err) => console.error('[verify-answer] opened not recorded:', err))
    return NextResponse.json({ ok: true })
  }

  const perIp = checkRateLimit(`verify-answer:${ip}`, PER_IP)
  if (!perIp.success) return rateLimitResponse(perIp)
  const perLink = checkRateLimit(`verify-link:${claim.v}:${claim.r}`, PER_LINK)
  if (!perLink.success) return rateLimitResponse(perLink)
  if (body?.action !== 'confirm' && body?.action !== 'correct') {
    return NextResponse.json({ error: 'Nothing was sent.' }, { status: 400 })
  }

  try {
    // Read afresh: what was on screen is compared with the sheet as it is now.
    const link = await openLink(token, { fresh: true })
    if (link.kind === 'invalid') return NextResponse.json({ error: 'This link is not valid.' }, { status: 404 })
    const t = verifyStrings(link.kind === 'ok' ? link.lang : 'lang' in link ? link.lang : 'en')
    if (link.kind === 'closed') return NextResponse.json({ error: t.closed(link.business) }, { status: 410 })
    if (link.kind === 'not_found') return NextResponse.json({ error: t.notFound(link.business) }, { status: 404 })
    if (link.kind === 'shared') return NextResponse.json({ error: t.notFound(link.business) }, { status: 409 })

    if (body.action === 'confirm') {
      await recordAnswer({ v: link.v, sheet: link.sheet, rowNumber: link.rowNumber, ref: link.ref, changes: [], by: 'Person', state: 'verified' })
      return NextResponse.json({ ok: true, state: 'verified', items: viewOf(link) })
    }

    const checked = corrections(setupOf(link.v), link.sheet.headers, link.row, body.values, body.seen)
    if (!checked.ok) return NextResponse.json({ error: checked.problem, stale: !!checked.stale }, { status: checked.stale ? 409 : 400 })
    if (!checked.changes.length) return NextResponse.json({ error: t.noChange }, { status: 400 })
    await recordAnswer({ v: link.v, sheet: link.sheet, rowNumber: link.rowNumber, ref: link.ref, changes: checked.changes, by: 'Person', state: 'corrected' })
    const row = [...link.row]
    for (const c of checked.changes) row[c.col] = c.after
    return NextResponse.json({ ok: true, state: 'corrected', items: viewOf({ ...link, row }) })
  } catch (err) {
    if (err instanceof RowMovedError) return NextResponse.json({ error: err.message, stale: true }, { status: 409 })
    console.error('[verify-answer] failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not save just now. Please try again in a minute.' }, { status: 502 })
  }
}
