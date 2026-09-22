import { hasMinRole, type AccountRole } from './roles'
import { PAGE_SECTIONS } from '@/lib/navigation/pages'

/**
 * Which screens a particular person may open.
 *
 * ── Why this is a separate question from their role ─────────────────
 *
 * roles.ts decides what somebody may *do*: five ranks, and every write
 * in the application is gated on one of them. This decides which
 * screens they are handed at all, and an admin sets it per member
 * rather than per rank — two agents doing different jobs get different
 * menus.
 *
 * ── Why this file exists rather than a check at each page ───────────
 *
 * Until now the answer lived in one place and was enforced in none.
 * `agentAllowed` in navigation/sections.ts hid four pages from an
 * agent's menu, and its own comment claimed "every page enforces its
 * own access" — which was not true of any of them. Reports, Pipelines
 * and Broadcasts each asked only for the `viewer` rank, the lowest
 * there is, and Flows asked only that somebody be signed in. An agent
 * who typed the address saw the page and its data.
 *
 * A permission an admin can set and a user can walk around is worse
 * than no permission at all: it is a promise the screen makes and the
 * server does not keep. So the answer is computed here, once, and the
 * places that must obey it — the dashboard layout, the API routes, the
 * sidebar — all ask this rather than each deciding for itself.
 */

/** Every page an admin can grant or withhold. Derived from the nav so
 *  the two cannot drift: a page added to the menu is grantable the same
 *  day, and one removed stops being offered. */
export function grantablePages(): string[] {
  return PAGE_SECTIONS.flatMap((s) => s.items.map((i) => i.href))
}

/**
 * What somebody sees when nobody has decided for them.
 *
 * Deliberately the behaviour they have today: supervisors and above get
 * everything, and an agent or viewer gets the pages `agentAllowed`
 * already marked. So turning this feature on changes nothing until an
 * admin chooses to change something, and a member invited next month
 * starts with a working set rather than a blank one.
 */
export function defaultPagesFor(role: AccountRole): string[] {
  if (hasMinRole(role, 'supervisor')) return grantablePages()
  return PAGE_SECTIONS.flatMap((s) =>
    s.items.filter((i) => i.agentAllowed).map((i) => i.href),
  )
}

/**
 * Parse what was stored, and refuse to guess.
 *
 * `null` and a malformed value both mean "not decided" and fall back to
 * the role default. An empty array does not: somebody deliberately took
 * every page away, and quietly restoring the defaults would undo an
 * admin's decision without telling anybody.
 */
export function parsePageAccess(stored: unknown): string[] | null {
  if (!Array.isArray(stored)) return null
  const known = new Set(grantablePages())
  // Unknown entries are dropped rather than honoured. A page that no
  // longer exists cannot be granted, and a value that was never a page
  // has no business deciding anything.
  return stored.filter((v): v is string => typeof v === 'string' && known.has(v))
}

/**
 * The pages this person may open, as a set.
 *
 * Owners and admins always get everything, whatever is stored. That is
 * not a convenience: if their pages could be switched off, one wrong
 * click removes the only account that could switch them back on, and
 * the way out is a database console. The rule lives here rather than in
 * the column so it cannot be bypassed by writing the row directly.
 */
export function pagesFor(role: AccountRole, stored: unknown): Set<string> {
  if (hasMinRole(role, 'admin')) return new Set(grantablePages())
  const chosen = parsePageAccess(stored)
  return new Set(chosen ?? defaultPagesFor(role))
}

/**
 * May this person open this address?
 *
 * Matches on the nav href and its children, so `/leads/<id>` is allowed
 * by a grant of `/leads` — withholding a list while leaving its detail
 * pages open would be a permission that only looks like one.
 */
export function canOpenPath(role: AccountRole, stored: unknown, pathname: string): boolean {
  const allowed = pagesFor(role, stored)

  // Not a grantable page at all — /settings, /join/<token>, an unknown
  // address. This function's job is the pages an admin can withhold;
  // everything else keeps whatever protection it already has, and
  // answering "no" here would lock people out of screens nobody chose
  // to restrict.
  const page = longestNavMatch(pathname)
  if (!page) return true

  return allowed.has(page)
}

/**
 * The nav entry that owns this address, if any.
 *
 * Longest match wins, because `/data` and `/data/[tableId]` are both
 * real and the more specific one is the truer answer. Compared against
 * segment boundaries so that `/leadsomething` is never taken for a
 * child of `/leads`.
 */
function longestNavMatch(pathname: string): string | null {
  let best: string | null = null
  for (const href of grantablePages()) {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      if (!best || href.length > best.length) best = href
    }
  }
  return best
}

/**
 * Where to send somebody who asked for a page they may not open.
 *
 * Their first allowed page, rather than a fixed address: sending
 * everybody to /dashboard is wrong for the one person whose dashboard
 * was taken away, and a redirect loop is a worse answer than a plain
 * refusal. When nothing at all is allowed there is nowhere to send
 * them, and the caller has to say so instead.
 */
export function firstAllowedPage(role: AccountRole, stored: unknown): string | null {
  const allowed = pagesFor(role, stored)
  for (const href of grantablePages()) {
    if (allowed.has(href)) return href
  }
  return null
}
