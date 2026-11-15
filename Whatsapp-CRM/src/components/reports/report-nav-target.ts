/**
 * Which report the address should point at when the period, comparison
 * or tab changes.
 *
 * Clicking another report in the side menu does not change the page at
 * once: the old report stays on screen until the new one has loaded
 * (seconds on a slow line or a first visit). A period click in that gap
 * used to replace the address with the OLD report's path, cancelling the
 * report just picked — the screen jumped back. The Reports layout
 * remembers the report being opened (pendingPathFromClick) and every
 * address change goes there instead (replaceTarget).
 */

export interface LinkClick {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
  /** The anchor's target attribute ("" when none). */
  target: string
  /** The anchor's resolved href (absolute). */
  href: string
}

function trimSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p
}

/** The Reports path this click opens in this tab, or null when it does
 *  not (new tab, another site, outside Reports, cancelled). */
export function pendingPathFromClick(c: LinkClick, origin: string): string | null {
  if (c.defaultPrevented || c.button !== 0) return null
  if (c.metaKey || c.ctrlKey || c.shiftKey || c.altKey) return null
  if (c.target && c.target !== "_self") return null
  if (!c.href) return null
  let url: URL
  try {
    url = new URL(c.href, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  const path = trimSlash(url.pathname)
  if (path !== "/reports" && !path.startsWith("/reports/")) return null
  return path
}

/** The path a period / comparison / tab change should go to. */
export function replaceTarget(pending: string | null, pathname: string | null): string {
  return pending ?? pathname ?? "/reports"
}
