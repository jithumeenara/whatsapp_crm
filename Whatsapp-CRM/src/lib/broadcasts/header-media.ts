/**
 * The header image or document a broadcast attaches.
 *
 * Two kinds are accepted:
 *  - a public http(s) link, which Meta fetches itself (never this server);
 *  - one of this account's own uploads, /api/files/account-<id>/<name>,
 *    which run-broadcast reads from disk and uploads to Meta.
 *
 * Anything else was accepted before and then read from disk relative to
 * the uploads folder — another workspace's file (its folder name is just
 * its account id), a file from before per-account folders, a sibling
 * folder reached with ../ — and sent to whatever number the campaign
 * targets, which can be the sender's own.
 */

const OWN_FILE = /^\/api\/files\/account-([0-9a-zA-Z-]+)\/([A-Za-z0-9][A-Za-z0-9._-]{0,200})$/

export type HeaderMediaCheck = { ok: true; value: string | null } | { ok: false; error: string }

export function checkHeaderMediaUrl(raw: unknown, accountId: string): HeaderMediaCheck {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: 'The header media must be a link.' }
  const url = raw.trim()
  if (!url) return { ok: true, value: null }
  if (url.length > 2000) return { ok: false, error: 'The header media link is too long.' }
  if (/^https?:\/\//i.test(url)) {
    try {
      new URL(url)
      return { ok: true, value: url }
    } catch {
      return { ok: false, error: 'The header media link is not a valid address.' }
    }
  }
  const m = OWN_FILE.exec(url)
  if (m && m[1] === accountId && !m[2].includes('..')) return { ok: true, value: url }
  return { ok: false, error: 'Choose the header media again — that file is not one of this workspace’s uploads.' }
}
