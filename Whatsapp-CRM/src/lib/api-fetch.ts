/**
 * `fetch` that fails when the server says no.
 *
 * Plain `fetch` only rejects when the network does; a 403, 404, 409 or
 * 500 resolves like a success. So the common shape
 *
 *   try { await fetch(...); toast.success("Deleted") } catch { toast.error(...) }
 *
 * announced "Deleted" for a delete the server refused, and "Lead
 * claimed!" for a lead a colleague had already taken. This throws on any
 * non-2xx response, with the server's own `error` text when it sent one,
 * so the catch that was already there is the one that runs.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (!res.ok) {
    let message = ''
    try {
      const body = (await res.clone().json()) as { error?: unknown; message?: unknown }
      if (typeof body?.error === 'string') message = body.error
      else if (typeof body?.message === 'string') message = body.message
    } catch {
      // Not JSON — the status line is all there is.
    }
    throw new Error(message || `Request failed (${res.status})`)
  }
  return res
}

/** The message to show for a failure from apiFetch (or anything else),
 *  falling back to the caller's wording when there is nothing better. */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
