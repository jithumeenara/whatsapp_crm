/**
 * Browser side of app_errors: sends one error to /api/client-errors.
 *
 * Fire and forget, with its own small limits so a page stuck in a loop
 * sends a handful, not thousands: the same message at most once a minute,
 * and at most 20 reports per page load. Never throws.
 */

const sent = new Map<string, number>()
let total = 0

export function reportClientError(message: string, where?: string): void {
  try {
    if (typeof window === 'undefined') return
    const msg = String(message || '').slice(0, 1000)
    if (!msg.trim()) return
    const now = Date.now()
    const last = sent.get(msg)
    if (last && now - last < 60_000) return
    if (total >= 20) return
    sent.set(msg, now)
    total += 1
    const body = JSON.stringify({ message: msg, where: where ?? window.location.pathname })
    // keepalive: still delivered when the error is what makes the page unload.
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {})
  } catch {
    // reporting must never add an error of its own
  }
}

export function describeClientError(err: unknown): string {
  if (err instanceof Error) {
    const frame = (err.stack ?? '').split('\n').slice(1, 2).join('').trim()
    return `${err.name}: ${err.message}${frame ? ` (${frame.slice(0, 160)})` : ''}`
  }
  try { return typeof err === 'string' ? err : JSON.stringify(err)?.slice(0, 300) ?? String(err) } catch { return String(err) }
}
