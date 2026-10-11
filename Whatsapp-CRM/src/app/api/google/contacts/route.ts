import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ContactsError, importGoogleContacts, listContactGroups } from '@/lib/google/contacts'
import { GoogleNotConnectedError, logGoogleActivity } from '@/lib/google/oauth'

function failure(err: unknown) {
  if (err instanceof ContactsError) return NextResponse.json({ error: err.message }, { status: err.status })
  if (err instanceof GoogleNotConnectedError) return NextResponse.json({ error: err.message }, { status: 400 })
  return toErrorResponse(err)
}

/** The Google account's contact groups, to choose what to import. */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    return NextResponse.json({ groups: await listContactGroups(ctx.accountId) })
  } catch (err) {
    return failure(err)
  }
}

/** One import, now. Running it twice changes nothing the second time. */
const running = new Set<string>()
export async function POST(req: NextRequest) {
  let accountId = ''
  try {
    const ctx = await requireRole('admin')
    accountId = ctx.accountId
    if (running.has(accountId)) return NextResponse.json({ error: 'An import is already running.' }, { status: 409 })
    running.add(accountId)
    const body = (await req.json().catch(() => ({}))) as { groups?: unknown }
    const groups = Array.isArray(body.groups) ? body.groups.filter((g): g is string => typeof g === 'string' && g.startsWith('contactGroups/')).slice(0, 50) : []
    const result = await importGoogleContacts(ctx.accountId, ctx.userId, groups)
    await logGoogleActivity(ctx.accountId, ctx.userId, 'contacts_import', `${result.created} added, ${result.updated} updated`)
    return NextResponse.json(result)
  } catch (err) {
    return failure(err)
  } finally {
    if (accountId) running.delete(accountId)
  }
}
