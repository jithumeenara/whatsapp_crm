/**
 * Where a request from Meta's Flow servers should go.
 *
 * A Flow's endpoint URI is typed into Meta's Flow Builder by hand, and
 * the address people have to hand is the one in their browser bar while
 * editing the Flow: /flows/<id>. That is the editor page, behind the
 * login, so Meta's server — which has no session — was redirected to the
 * sign-in page (307) and the Flow failed its health check, and would
 * have failed for every customer.
 *
 * A POST to exactly /flows/<uuid> is never a person: the page is opened
 * with GET, and the page's own server actions carry a `next-action`
 * header. So such a POST is handed to the Flow's real endpoint,
 * /api/flows/<uuid>/webhook, which is public already and trusts nothing
 * it cannot decrypt with the account's own Flow key. Nothing becomes
 * reachable that was not reachable before; a wrong address just works.
 *
 * "Point it here" on the Flow editor still sets the proper address.
 *
 * Pure (no Next imports), so the proxy's rule is tested — see
 * endpoint-path.test.ts.
 */

const EDITOR_PAGE = /^\/flows\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i

export function flowEndpointRewrite(
  method: string,
  pathname: string,
  headers: { get(name: string): string | null },
): string | null {
  if (method !== 'POST') return null
  if (headers.get('next-action')) return null
  const match = EDITOR_PAGE.exec(pathname)
  return match ? `/api/flows/${match[1]}/webhook` : null
}
