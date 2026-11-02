/**
 * When the database cannot take an audit event, it is kept in a local
 * file and replayed later — never silently lost. Each line is HMAC'd, so a
 * line someone added by hand is refused at replay, and replayed rows are
 * marked (meta.replayed, ingested_at) so they never pass as normal events.
 * The file is capped; anything beyond the cap is counted and reported.
 */

import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

const FILE = path.join(process.cwd(), 'logs', 'audit-fallback.ndjson')
const MAX_BYTES = 10 * 1024 * 1024

let dropped = 0

function key(): string {
  // Its own key when set; otherwise one derived from the session secret,
  // so the file cannot be signed without the server's secrets.
  const own = process.env.AUDIT_FALLBACK_KEY?.trim()
  if (own) return own
  return crypto.createHmac('sha256', process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? 'unset').update('audit-fallback').digest('hex')
}

function sign(body: string): string {
  return crypto.createHmac('sha256', key()).update(body).digest('hex')
}

export async function keepForReplay(rows: Array<Record<string, unknown> & { occurred_at: Date }>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 })
  const size = await fs.stat(FILE).then((s) => s.size).catch(() => 0)
  const lines: string[] = []
  for (const r of rows) {
    const body = JSON.stringify({ ...r, occurred_at: r.occurred_at.toISOString() })
    lines.push(JSON.stringify({ body, mac: sign(body) }))
  }
  const add = lines.join('\n') + '\n'
  if (size + add.length > MAX_BYTES) {
    dropped += rows.length
    console.error(`[audit] fallback file full — ${rows.length} event(s) dropped (${dropped} since start)`)
    return
  }
  await fs.appendFile(FILE, add, { mode: 0o600 })
}

/** Replays the file into the chains, then removes it. Lines whose MAC does
 *  not match are refused and reported. Returns counts. */
export async function replayAuditFallback(): Promise<{ replayed: number; refused: number; dropped: number }> {
  const text = await fs.readFile(FILE, 'utf8').catch(() => '')
  const droppedNow = dropped
  dropped = 0
  if (!text.trim() && !droppedNow) return { replayed: 0, refused: 0, dropped: 0 }
  const { appendPrepared, audit } = await import('./write')
  const good: Array<Record<string, unknown>> = []
  let refused = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const { body, mac } = JSON.parse(line) as { body: string; mac: string }
      const ok = typeof body === 'string' && typeof mac === 'string' && mac.length === 64 &&
        crypto.timingSafeEqual(Buffer.from(sign(body), 'hex'), Buffer.from(mac, 'hex'))
      if (!ok) { refused++; continue }
      const row = JSON.parse(body) as Record<string, unknown>
      good.push({ ...row, occurred_at: new Date(String(row.occurred_at)), meta: { ...((row.meta as object) ?? {}), replayed: true } })
    } catch {
      refused++
    }
  }
  if (good.length) await appendPrepared(good as never, { ingestedAt: new Date() })
  await fs.rm(FILE, { force: true })
  if (good.length || refused || droppedNow) {
    await audit(
      { accountId: null, actor: { type: 'system', id: 'audit-replay' }, source: 'system' },
      { action: 'system.audit_write_failed', outcome: refused || droppedNow ? 'failure' : 'success', meta: { replayed: good.length, refused, dropped: droppedNow } },
    )
  }
  return { replayed: good.length, refused, dropped: droppedNow }
}
