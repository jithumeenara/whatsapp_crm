/**
 * Meta refused the app itself — a missing permission or access level
 * (code 10, 200-299) or a capability the app lacks (3) — as opposed to
 * "nothing was ticked". Different fix, different message.
 */
export function isAppDenied(errors: ReadonlyArray<{ code?: number }>): boolean {
  return errors.some((e) => e.code === 10 || e.code === 3 || (typeof e.code === 'number' && e.code >= 200 && e.code < 300))
}
