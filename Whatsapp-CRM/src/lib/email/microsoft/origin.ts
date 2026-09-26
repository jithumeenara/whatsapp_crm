/**
 * The address this site is being used at, for the Microsoft redirect and
 * notification URLs.
 *
 * Taken from the request, like the WhatsApp Flow endpoint does: the
 * admin is on a hostname that demonstrably works, and the configured
 * app URL is not always that one (the apex redirects to www). Only a
 * plain host name is accepted, so a crafted header cannot turn it into
 * anything else. Microsoft itself refuses any redirect address that is
 * not exactly the one registered.
 */
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i

export function publicOrigin(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwarded || req.headers.get('host') || ''
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'http' ? 'http' : 'https'
  if (host && HOST.test(host)) return `${proto}://${host.toLowerCase()}`
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
}
