import { NextResponse } from 'next/server'
import { ForbiddenError, UnauthorizedError, assertPageAccess, requireRole, type AccountContext } from '@/lib/auth/account'
import type { AccountRole } from '@/lib/auth/roles'

/**
 * Who may use the Automations API: a member of at least `min` rank who
 * may also open the Automations page. The routes used to ask only that
 * somebody be signed in, so a viewer, or an agent an admin had kept off
 * the page, could create and switch on an automation that messages
 * everybody. Reads need `viewer`, changes `agent`; either way the page.
 */
export async function automationsMember(
  min: AccountRole,
): Promise<{ ok: true; ctx: AccountContext } | { ok: false; res: NextResponse }> {
  try {
    const ctx = await requireRole(min)
    assertPageAccess(ctx, '/automations')
    return { ok: true, ctx }
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    if (err instanceof ForbiddenError) return { ok: false, res: NextResponse.json({ error: err.message }, { status: 403 }) }
    throw err
  }
}
