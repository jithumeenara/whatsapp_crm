/**
 * When the database cannot take an audit event, it is kept in a local
 * file and replayed later — never silently lost. Each line is HMAC'd, so a
 * line someone added by hand is refused at replay, and replayed rows are
 * marked (meta.replayed, ingested_at) so they never pass as normal events.
 * The file is capped; anything beyond the cap is counted and reported.
 *
 * Replay is written so a crash or a failing account cannot double or lose
 * events:
 *   1. the file is renamed to audit-fallback.processing before it is read,
 *      so events written meanwhile go to a fresh audit-fallback.ndjson;
 *      a .processing left by a crash is finished first;
 *   2. rows are replayed one account at a time, and after each account's
 *      transaction commits the lines still to do are written back, so a
 *      crash repeats at most the account that was in flight;
 *   3. a line that fails three replays, or whose signature does not match,
 *      goes to audit-fallback.quarantine (0600) and is reported — kept for
 *      a person to look at, never retried forever, never deleted.
 */

import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'

const MAX_BYTES = 10 * 1024 * 1024
/** Failed replays before a line is moved to the quarantine file. */
export const MAX_REPLAY_TRIES = 3

let dropped = 0
let running: Promise<ReplayResult> | null = null

export interface FallbackOptions {
  /** Folder for the files; default <cwd>/logs. Tests pass a temp folder. */
  dir?: string
}

export interface ReplayResult {
  replayed: number
  refused: number
  quarantined: number
  /** Lines left for the next replay (their account failed this time). */
  pending: number
  dropped: number
}

function files(opts?: FallbackOptions) {
  const dir = opts?.dir ?? path.join(process.cwd(), 'logs')
  return {
    dir,
    live: path.join(dir, 'audit-fallback.ndjson'),
    processing: path.join(dir, 'audit-fallback.processing'),
    quarantine: path.join(dir, 'audit-fallback.quarantine'),
  }
}

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

export async function keepForReplay(rows: Array<Record<string, unknown> & { occurred_at: Date }>, opts?: FallbackOptions): Promise<void> {
  // Route tests mock the database, so every audit write "fails" there:
  // they must not leave a real file behind.
  if (process.env.VITEST && !opts?.dir) return
  const f = files(opts)
  await fs.mkdir(f.dir, { recursive: true, mode: 0o700 })
  const size = await fs.stat(f.live).then((s) => s.size).catch(() => 0)
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
  await fs.appendFile(f.live, add, { mode: 0o600 })
}

interface Line {
  body: string
  mac: string
  tries: number
}

/** Parses one stored line; null when it is not a line this code wrote. */
function parseLine(raw: string): Line | null {
  try {
    const o = JSON.parse(raw) as { body?: unknown; mac?: unknown; tries?: unknown }
    if (typeof o.body !== 'string' || typeof o.mac !== 'string' || !/^[0-9a-f]{64}$/.test(o.mac)) return null
    const tries = typeof o.tries === 'number' && Number.isInteger(o.tries) && o.tries >= 0 ? o.tries : 0
    return { body: o.body, mac: o.mac, tries }
  } catch {
    return null
  }
}

const macOk = (l: Line) => crypto.timingSafeEqual(Buffer.from(sign(l.body), 'hex'), Buffer.from(l.mac, 'hex'))
const lineText = (l: Line) => JSON.stringify(l.tries ? { body: l.body, mac: l.mac, tries: l.tries } : { body: l.body, mac: l.mac })

/** Replaces a file's content in one step (write a temp file, rename). */
async function writeWhole(file: string, lines: string[]): Promise<void> {
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, lines.length ? lines.join('\n') + '\n' : '', { mode: 0o600 })
  await fs.rename(tmp, file)
}

async function toQuarantine(file: string, entries: Array<{ raw: string; why: string }>): Promise<void> {
  if (!entries.length) return
  const at = new Date().toISOString()
  const text = entries.map((e) => JSON.stringify({ quarantined_at: at, why: e.why, line: e.raw })).join('\n') + '\n'
  await fs.appendFile(file, text, { mode: 0o600 })
  await fs.chmod(file, 0o600).catch(() => {})
}

/** Replays one .processing file account by account. */
async function replayFile(f: ReturnType<typeof files>, appendPrepared: (rows: never, replay: { ingestedAt: Date }) => Promise<void>) {
  const text = await fs.readFile(f.processing, 'utf8').catch(() => '')
  const out = { replayed: 0, refused: 0, quarantined: 0, pending: 0 }
  const bad: Array<{ raw: string; why: string }> = []
  // Remaining lines by account, in file order.
  const byAccount = new Map<string, Line[]>()
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    const l = parseLine(raw)
    if (!l || !macOk(l)) { bad.push({ raw, why: 'signature does not match' }); continue }
    let account = ''
    try {
      account = String((JSON.parse(l.body) as { account_id?: unknown }).account_id ?? '')
    } catch {
      bad.push({ raw, why: 'unreadable body' })
      continue
    }
    byAccount.set(account, [...(byAccount.get(account) ?? []), l])
  }
  out.refused = bad.length
  await toQuarantine(f.quarantine, bad)

  const remaining = () => [...byAccount.values()].flat().map(lineText)
  // Refused lines are now in quarantine: drop them from the file.
  if (bad.length) await writeWhole(f.processing, remaining())

  for (const [account, lines] of [...byAccount]) {
    const rows = lines.map((l) => {
      const row = JSON.parse(l.body) as Record<string, unknown>
      return { ...row, occurred_at: new Date(String(row.occurred_at)), meta: { ...((row.meta as object) ?? {}), replayed: true } }
    })
    try {
      await appendPrepared(rows as never, { ingestedAt: new Date() })
      out.replayed += lines.length
      byAccount.delete(account)
    } catch (err) {
      console.error(`[audit] replay failed for one account (${lines.length} event(s)):`, err instanceof Error ? err.message : err)
      const keep: Line[] = []
      const give: Array<{ raw: string; why: string }> = []
      for (const l of lines) {
        const next = { ...l, tries: l.tries + 1 }
        if (next.tries >= MAX_REPLAY_TRIES) give.push({ raw: lineText(next), why: `replay failed ${next.tries} times` })
        else keep.push(next)
      }
      await toQuarantine(f.quarantine, give)
      out.quarantined += give.length
      if (keep.length) byAccount.set(account, keep)
      else byAccount.delete(account)
    }
    // After each account: what is left, so a crash never repeats a committed account.
    await writeWhole(f.processing, remaining())
  }

  const left = remaining()
  out.pending = left.length
  if (!left.length) await fs.rm(f.processing, { force: true })
  return out
}

async function replayOnce(opts?: FallbackOptions): Promise<ReplayResult> {
  const f = files(opts)
  const droppedNow = dropped
  dropped = 0
  const total = { replayed: 0, refused: 0, quarantined: 0, pending: 0, dropped: droppedNow }
  const has = (p: string) => fs.stat(p).then((s) => s.size > 0).catch(() => false)
  const hasProcessing = await fs.stat(f.processing).then(() => true).catch(() => false)
  if (!hasProcessing && !(await has(f.live)) && !droppedNow) return total

  const { appendPrepared, audit } = await import('./write')
  // A .processing left by a crash first; then the current file, renamed so
  // events written during the replay land in a fresh file.
  for (let pass = 0; pass < 2; pass++) {
    const exists = await fs.stat(f.processing).then(() => true).catch(() => false)
    if (!exists) {
      if (!(await has(f.live))) break
      await fs.rename(f.live, f.processing)
    }
    const r = await replayFile(f, appendPrepared as never)
    total.replayed += r.replayed
    total.refused += r.refused
    total.quarantined += r.quarantined
    total.pending = r.pending
    // An account still failing: leave its lines for the next run.
    if (r.pending) break
  }

  if (total.refused || total.quarantined) {
    console.error(`[audit] fallback replay: ${total.refused} refused and ${total.quarantined} failed line(s) moved to ${f.quarantine}`)
  }
  if (total.replayed || total.refused || total.quarantined || total.dropped) {
    await audit(
      { accountId: null, actor: { type: 'system', id: 'audit-replay' }, source: 'system' },
      {
        action: 'system.audit_write_failed',
        outcome: total.refused || total.quarantined || total.dropped ? 'failure' : 'success',
        meta: { replayed: total.replayed, refused: total.refused, quarantined: total.quarantined, pending: total.pending, dropped: total.dropped },
      },
    )
  }
  return total
}

/** Replays the fallback file into the chains (see the top of this file).
 *  One replay at a time per process. Returns counts. */
export function replayAuditFallback(opts?: FallbackOptions): Promise<ReplayResult> {
  if (running) return running
  running = replayOnce(opts).finally(() => { running = null })
  return running
}
