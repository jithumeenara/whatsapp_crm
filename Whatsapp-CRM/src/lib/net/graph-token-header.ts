/**
 * Meta tokens travel in a header, not in the address.
 *
 * About forty places call graph.facebook.com with `?access_token=…` in the
 * URL. An address is the part of a request that ends up everywhere: in
 * error messages that echo the URL, in logs, in a proxy's access log. A
 * header does not. Graph accepts the same token as
 * `Authorization: Bearer <token>`, so this moves it there for every call,
 * in one place, instead of editing every caller.
 *
 * Only graph.facebook.com, only the `access_token` query parameter, and
 * never when the caller already set an Authorization header. Everything
 * else in the address (appsecret_proof, fields, filtering) stays where it
 * is. Installed once in server.ts; no imports, no next/server.
 */

type FetchFn = typeof fetch

/** The request with its Graph token moved to a header, or null to leave it. */
export function moveGraphToken(
  input: Parameters<FetchFn>[0],
  init?: Parameters<FetchFn>[1],
): { url: string; init: RequestInit } | null {
  if (typeof input !== 'string' && !(input instanceof URL)) return null
  let url: URL
  try {
    url = new URL(typeof input === 'string' ? input : input.href)
  } catch {
    return null
  }
  if (url.hostname !== 'graph.facebook.com' || url.protocol !== 'https:') return null
  const token = url.searchParams.get('access_token')
  if (!token) return null
  const headers = new Headers(init?.headers)
  if (headers.has('authorization')) return null
  url.searchParams.delete('access_token')
  headers.set('Authorization', `Bearer ${token}`)
  return { url: url.toString(), init: { ...init, headers } }
}

export function withGraphTokenHeader(real: FetchFn): FetchFn {
  return (async (input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => {
    const moved = moveGraphToken(input, init)
    return moved ? real(moved.url, moved.init) : real(input, init)
  }) as FetchFn
}

let installed = false

export function installGraphTokenHeader(): void {
  if (installed) return
  installed = true
  globalThis.fetch = withGraphTokenHeader(globalThis.fetch.bind(globalThis))
}
