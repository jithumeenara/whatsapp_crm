import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasMinRole } from '@/lib/auth/roles'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { GoogleNotConnectedError } from '@/lib/google/oauth'
import { SheetsApiError } from '@/lib/google/sheets'
import { publicErrorMessage } from '@/lib/jobs/public-error'
import {
  findRow,
  linkFor,
  listPeople,
  needsAnswer,
  prepareSheet,
  readSheet,
  recordAnswer,
  runSend,
  RowMovedError,
  setupOf,
  whatsAppSender,
  type Channel,
} from '@/lib/verify/sheet-verify-server'

/**
 * POST { action, … } on one "check details" list.
 *
 *   prepare                    add the Verify ref / status columns and a
 *                              reference to every row (admin)
 *   send { channel, scope }    send the private links: to everyone not yet
 *                              done, or only to those not reached (admin)
 *   link { ref }               one person's link, to send by hand (admin)
 *   phone { ref }              confirmed on a call (supervisor)
 *   revoke                     cancel every link sent so far (admin)
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHANNELS = new Set<Channel>(['whatsapp', 'sms', 'email'])
/** A send that stopped without saying so frees itself after this long;
 *  a running send renews it as it goes. */
const SEND_LOCK_MS = 10 * 60_000

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('supervisor')
    assertPageAccess(ctx, '/data')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const v = await prisma.sheetVerification.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!v) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const body = (await req.json().catch(() => null)) as { action?: unknown; channel?: unknown; scope?: unknown; ref?: unknown } | null
    const action = body?.action
    const admin = hasMinRole(ctx.role, 'admin')
    const ref = typeof body?.ref === 'string' ? body.ref.trim().slice(0, 40) : ''

    if (action === 'phone') {
      if (!ref) return NextResponse.json({ error: 'Choose a person.' }, { status: 400 })
      const sheet = await readSheet(v, { fresh: true })
      const found = findRow(sheet, ref, setupOf(v))
      if (found.kind === 'none') return NextResponse.json({ error: 'That person is no longer in the sheet.' }, { status: 404 })
      if (found.kind === 'many') return NextResponse.json({ error: 'Two rows have this reference (a copied row). Press “Get the sheet ready” first.' }, { status: 409 })
      const me = await prisma.profile.findUnique({ where: { user_id: ctx.userId }, select: { full_name: true, email: true } })
      await recordAnswer({ v, sheet, rowNumber: found.rowNumber, ref, changes: [], by: me?.full_name || me?.email || 'Staff', state: 'phone', userId: ctx.userId })
      return NextResponse.json({ ok: true })
    }

    if (!admin) return NextResponse.json({ error: 'Only an admin can do this.' }, { status: 403 })

    if (action === 'prepare') {
      try {
        return NextResponse.json(await prepareSheet(v))
      } catch (err) {
        if (err instanceof SheetsApiError || err instanceof GoogleNotConnectedError || !(err instanceof Error)) throw err
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
    }

    if (action === 'revoke') {
      await prisma.sheetVerification.updateMany({ where: { id: v.id, account_id: ctx.accountId }, data: { key_version: { increment: 1 } } })
      return NextResponse.json({ ok: true })
    }

    if (action === 'link') {
      if (!ref) return NextResponse.json({ error: 'Choose a person.' }, { status: 400 })
      const found = findRow(await readSheet(v, { fresh: true }), ref, setupOf(v))
      if (found.kind === 'none') return NextResponse.json({ error: 'That person is no longer in the sheet.' }, { status: 404 })
      if (found.kind === 'many') return NextResponse.json({ error: 'Two rows have this reference (a copied row). Press “Get the sheet ready” first.' }, { status: 409 })
      return NextResponse.json({ link: linkFor(v, ref) })
    }

    if (action === 'send') {
      const channel = body?.channel as Channel
      if (!CHANNELS.has(channel)) return NextResponse.json({ error: 'Choose WhatsApp, SMS or email.' }, { status: 400 })
      const scope = body?.scope === 'not_reached' ? 'not_reached' : 'pending'
      if (v.status !== 'active' || (v.deadline && v.deadline.getTime() <= Date.now())) {
        return NextResponse.json({ error: 'This check is closed or past its deadline. Change the deadline first.' }, { status: 400 })
      }
      if (channel === 'whatsapp' && !v.template_name) return NextResponse.json({ error: 'Choose an approved WhatsApp template first.' }, { status: 400 })
      if (channel === 'sms' && !v.sms_text) return NextResponse.json({ error: 'Write the SMS text first.' }, { status: 400 })
      if (channel === 'email' && !v.email_text) return NextResponse.json({ error: 'Write the email first.' }, { status: 400 })

      // WhatsApp ready (number + approved template) before anything is claimed.
      if (channel === 'whatsapp') {
        try {
          await whatsAppSender(v)
        } catch (err) {
          return NextResponse.json({ error: publicErrorMessage(err, 'WhatsApp is not ready to send.', 'sheet-verifications/actions') }, { status: 400 })
        }
      }

      const { people, missingRefs, sharedRefs, tooMany } = await listPeople(v, { fresh: true })
      if (tooMany) return NextResponse.json({ error: 'The list has more than 2000 rows. Use “Only rows where” to check it in parts.' }, { status: 400 })
      if (missingRefs) return NextResponse.json({ error: `${missingRefs} row(s) have no reference yet. Press “Get the sheet ready” first.` }, { status: 400 })
      if (sharedRefs) return NextResponse.json({ error: `${sharedRefs} reference(s) are on more than one row (copied rows). Press “Get the sheet ready” first.` }, { status: 400 })
      const reached = (p: (typeof people)[number]) => p.wa.status && p.wa.status !== 'failed'
      // A fallback goes once per person: a second press does not pay for a second SMS.
      const already = (p: (typeof people)[number]) =>
        (channel === 'sms' && p.sms.status === 'sent') || (channel === 'email' && p.email_send.status === 'sent')
      const refs = people
        .filter((p) => needsAnswer(p.state))
        .filter((p) => (scope === 'not_reached' ? !reached(p) && !already(p) : true))
        .map((p) => p.ref)
      if (!refs.length) return NextResponse.json({ error: 'Nobody left to send to.' }, { status: 400 })

      // One send at a time: a second press while one runs is refused here.
      const until = new Date(Date.now() + SEND_LOCK_MS)
      const claim = await prisma.sheetVerification.updateMany({
        where: { id: v.id, account_id: ctx.accountId, OR: [{ sending_until: null }, { sending_until: { lt: new Date() } }] },
        data: { sending_until: until, last_send_error: null },
      })
      if (!claim.count) return NextResponse.json({ error: 'A send is already running. Wait for it to finish.' }, { status: 409 })
      void runSend(v, channel, refs, until)
      return NextResponse.json({ queued: refs.length })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  } catch (err) {
    if (err instanceof RowMovedError) return NextResponse.json({ error: err.message }, { status: 409 })
    if (err instanceof SheetsApiError) return NextResponse.json({ error: err.message }, { status: 502 })
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
