'use client'

/**
 * Connecting Google in its own window.
 *
 * The CRM page stays where it is — a half-filled import, an open table —
 * while Google's sign-in runs in a pop-up. When it finishes, the pop-up
 * lands on /google-done, which tells this page the outcome and closes
 * itself. If the browser blocks pop-ups, the whole page goes to Google and
 * comes back, as it always did.
 */

export interface GoogleConnectResult {
  /** 'connected' | 'error' | 'closed' (the window was shut first) */
  outcome: string
  reason?: string
}

export const GOOGLE_DONE_MESSAGE = 'crm-google-connect'

export function connectGoogle(url: string, onDone: (r: GoogleConnectResult) => void): void {
  const popupUrl = `${url}${url.includes('?') ? '&' : '?'}popup=1`
  const w = 520
  const h = 680
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2))
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2))
  const win = window.open(popupUrl, 'crm-google-connect', `popup=yes,width=${w},height=${h},left=${left},top=${top}`)
  if (!win) {
    window.location.href = url
    return
  }
  let settled = false
  const finish = (r: GoogleConnectResult) => {
    if (settled) return
    settled = true
    window.removeEventListener('message', onMessage)
    clearInterval(watch)
    onDone(r)
  }
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return
    const d = e.data as { source?: string; outcome?: unknown; reason?: unknown } | null
    if (!d || d.source !== GOOGLE_DONE_MESSAGE) return
    finish({ outcome: String(d.outcome ?? 'error'), reason: typeof d.reason === 'string' ? d.reason : undefined })
  }
  window.addEventListener('message', onMessage)
  // Shut without finishing: let the page know, so a spinner does not wait forever.
  const watch = setInterval(() => {
    if (win.closed) finish({ outcome: 'closed' })
  }, 700)
  win.focus()
}
