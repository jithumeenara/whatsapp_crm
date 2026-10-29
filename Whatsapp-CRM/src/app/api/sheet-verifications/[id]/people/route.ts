import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { assertPageAccess, requireRole, toErrorResponse } from '@/lib/auth/account'
import { GoogleNotConnectedError } from '@/lib/google/oauth'
import { SheetsApiError } from '@/lib/google/sheets'
import { listPeople } from '@/lib/verify/sheet-verify-server'

/**
 * GET — everyone in the list, read from the sheet now, with how far each
 * has got. Numbers and emails come masked: the screen only needs to
 * recognise them, and staff open the sheet for the rest.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole('supervisor')
    assertPageAccess(ctx, '/data')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const v = await prisma.sheetVerification.findFirst({ where: { id, account_id: ctx.accountId } })
    if (!v) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    const { people, missingRefs, sharedRefs, tooMany } = await listPeople(v)
    return NextResponse.json({
      people,
      missing_refs: missingRefs,
      shared_refs: sharedRefs,
      too_many: tooMany,
      last_send_error: v.last_send_error,
      sending: !!v.sending_until && v.sending_until.getTime() > Date.now(),
    })
  } catch (err) {
    if (err instanceof SheetsApiError) return NextResponse.json({ error: err.message }, { status: 502 })
    if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
    return toErrorResponse(err)
  }
}
