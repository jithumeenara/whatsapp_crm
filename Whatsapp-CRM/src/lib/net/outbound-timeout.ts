/**
 * No outgoing request waits for ever.
 *
 * Most server code calls Meta, Google, payment gateways and AI providers
 * with a bare `fetch(url, init)`. Node's fetch has no timeout of its own,
 * so when a provider stops answering (a half-open connection, an outage
 * that accepts the socket and says nothing) the request hangs: the
 * customer's reply never goes, a job holds its lock, and the screen that
 * asked spins until the browser gives up.
 *
 * Installed once in server.ts, this gives every outgoing request that
 * did not bring its own `signal` a generous deadline, so the caller's
 * existing catch runs with a clear "timed out" error instead of nothing.
 * A caller that passes a signal — `AbortSignal.timeout(…)`, a request's
 * own abort — keeps exactly the behaviour it chose.
 *
 * Only requests that leave this machine are touched: the app calling
 * itself (localhost, 127.0.0.1) is left alone.
 */

type FetchFn = typeof fetch

/** Ordinary API calls: Graph, Google, Razorpay, PhonePe, Telegram… */
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 60_000

/** Model calls can think for a while, and media uploads are large. */
export const SLOW_OUTBOUND_TIMEOUT_MS = 180_000

const SLOW_HOSTS = [
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'api.anthropic.com',
  'api.openai.com',
  'api.groq.com',
  'api.deepseek.com',
  'api.mistral.ai',
  'openrouter.ai',
  'texttospeech.googleapis.com',
  'speech.googleapis.com',
]

function urlOf(input: Parameters<FetchFn>[0]): URL | null {
  try {
    if (typeof input === 'string') return new URL(input)
    if (input instanceof URL) return input
    return new URL(input.url)
  } catch {
    return null // a relative URL: not an outgoing request
  }
}

function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1' || host.endsWith('.localhost')
}

/** How long an outgoing request may take, or null when it is left alone. */
export function outboundTimeoutFor(input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]): number | null {
  if (init?.signal) return null
  // A Request object always carries a signal and there is no telling
  // whether the caller set it, so it is treated as the caller's choice.
  // Server code here passes strings or URLs.
  if (typeof input === 'object' && !(input instanceof URL)) return null
  const url = urlOf(input)
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null
  if (isLocal(url.hostname)) return null
  if (SLOW_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return SLOW_OUTBOUND_TIMEOUT_MS
  const method = (init?.method ?? 'GET').toUpperCase()
  // An upload (FormData / Blob body) to Meta or Google can be tens of MB.
  const body = init?.body
  const isUpload = method !== 'GET' && (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    body instanceof ArrayBuffer || ArrayBuffer.isView(body)
  )
  return isUpload ? SLOW_OUTBOUND_TIMEOUT_MS : DEFAULT_OUTBOUND_TIMEOUT_MS
}

/** Wraps a fetch so outgoing requests without a signal get a deadline. */
export function withOutboundTimeout(real: FetchFn): FetchFn {
  return (async (input: Parameters<FetchFn>[0], init?: Parameters<FetchFn>[1]) => {
    const ms = outboundTimeoutFor(input, init)
    if (ms === null) return real(input, init)
    return real(input, { ...init, signal: AbortSignal.timeout(ms) })
  }) as FetchFn
}

let installed = false

/** server.ts calls this once, after the development send guard. */
export function installOutboundTimeout(): void {
  if (installed) return
  installed = true
  globalThis.fetch = withOutboundTimeout(globalThis.fetch.bind(globalThis))
}
