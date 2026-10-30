import { ForbiddenError, UnauthorizedError, requireRole, type AccountContext } from '@/lib/auth/account'
import type { AccountRole } from '@/lib/auth/roles'

/**
 * A signed-in member of at least `min` rank, in the `{ ok, status, body }`
 * shape the Data Store routes' guards return.
 *
 * Those guards used to read the profile themselves, which proved the
 * person belonged to an account and nothing about what they may do
 * there: a viewer could delete a table's columns and rows. Going through
 * requireRole gives them the same rank check every other route has.
 *
 * Ranks used by the Data Store:
 *   viewer      read tables and rows
 *   agent       add, change, delete and import rows
 *   supervisor  create tables and change their columns
 *   admin       delete a table (and its forms, sheets and alerts)
 */
export async function dataStoreMember(
  min: AccountRole,
): Promise<{ ok: true; ctx: AccountContext } | { ok: false; status: number; body: { error: string } }> {
  try {
    return { ok: true, ctx: await requireRole(min) }
  } catch (err) {
    if (err instanceof UnauthorizedError) return { ok: false, status: 401, body: { error: 'Unauthorized' } }
    if (err instanceof ForbiddenError) return { ok: false, status: 403, body: { error: err.message } }
    throw err
  }
}

/** The rank a request needs to change rows: reads are open to every member. */
export function rowRank(method: string): AccountRole {
  return method === 'GET' || method === 'HEAD' ? 'viewer' : 'agent'
}
