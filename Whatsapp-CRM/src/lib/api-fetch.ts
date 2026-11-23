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
export class ApiError extends Error {
  /** The HTTP status, so a screen can tell "no access" (403) from a fault. */
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** How long a screen waits for the server to start answering a read. */
export const API_TIMEOUT_MS = 20_000
/** A save, import or AI action can run long, and giving up early
 *  invites a second click that does it twice. */
export const API_WRITE_TIMEOUT_MS = 90_000
/** A file upload on a slow phone connection needs longer still. */
export const API_UPLOAD_TIMEOUT_MS = 120_000

export const TIMEOUT_MESSAGE = 'The server took too long to answer. Check your connection and try again.'
/** A write that timed out may still have finished on the server. */
export const WRITE_TIMEOUT_MESSAGE = 'The server is taking too long. It may still finish, so refresh the page before trying again.'
export const OFFLINE_MESSAGE = "Couldn't reach the server. Check your connection and try again."

/** Aborts when the caller's signal does, or when the time runs out. */
function deadline(own: AbortSignal | null | undefined, ms: number): { signal: AbortSignal; timedOut: () => boolean; clear: () => void } {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(new DOMException(TIMEOUT_MESSAGE, 'TimeoutError')) }, ms)
  const onAbort = () => ctrl.abort(own?.reason)
  if (own) {
    if (own.aborted) onAbort()
    else own.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    clear: () => { clearTimeout(timer); own?.removeEventListener('abort', onAbort) },
  }
}

/**
 * Plain `fetch` also waits for ever on a dropped phone connection, so the
 * spinner never stops. apiFetch gives up after `timeoutMs` (20 s for a
 * read, 90 s for a write, 2 min for a FormData upload) with an ApiError
 * the screen's catch already shows; a write's message says it may still
 * finish, so nobody clicks again and does it twice. A caller's own `signal` still cancels, and its abort is rethrown
 * unchanged so code that ignores AbortError keeps working. The deadline
 * covers the wait for the response, not reading a long body afterwards.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const { timeoutMs, ...rest } = init ?? {}
  const isUpload = typeof FormData !== 'undefined' && rest.body instanceof FormData
  const method = (rest.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
  const isWrite = method !== 'GET' && method !== 'HEAD'
  const limit = deadline(rest.signal, timeoutMs ?? (isUpload ? API_UPLOAD_TIMEOUT_MS : isWrite ? API_WRITE_TIMEOUT_MS : API_TIMEOUT_MS))
  let res: Response
  try {
    res = await fetch(input, { ...rest, signal: limit.signal })
  } catch (err) {
    if (limit.timedOut()) throw new ApiError(isWrite ? WRITE_TIMEOUT_MESSAGE : TIMEOUT_MESSAGE, 0)
    if (rest.signal?.aborted) throw err // the caller cancelled on purpose
    if (err instanceof TypeError) throw new ApiError(OFFLINE_MESSAGE, 0)
    throw err
  } finally {
    limit.clear()
  }
  if (!res.ok) {
    let message = ''
    try {
      const body = (await res.clone().json()) as { error?: unknown; message?: unknown }
      if (typeof body?.error === 'string') message = body.error
      else if (typeof body?.message === 'string') message = body.message
    } catch {
      // Not JSON — the status line is all there is.
    }
    throw new ApiError(message || `Request failed (${res.status})`, res.status)
  }
  return res
}

/** The message to show for a failure from apiFetch (or anything else),
 *  falling back to the caller's wording when there is nothing better. */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
