/**
 * Off-server copy (plan §20a) — every 15 minutes, as crm-audit:
 *
 *   node /opt/crm-audit/upload.cjs --config /etc/crm-audit/<app>.json
 *   ... --stdin --key audit/archive/2025-09.dump   (retention: one file from stdin)
 *
 * Uploads every event since the last uploaded seq of each chain to
 * Cloudflare R2 as audit/<account>/<yyyy>/<mm>/<from>-<to>.ndjson, then
 * the newest signed checkpoint as audit/<account>/checkpoints/<seq>.json.
 * PUT only, always with If-None-Match: * — nothing is ever overwritten or
 * deleted (Bucket Lock refuses that anyway). Rows go up exactly as stored
 * (masked at write time), so their hashes verify off the server. Progress
 * lives in upload-state.json, owned by crm-audit.
 */

import path from 'path'
import { checkChain, genesisHash } from '../../src/lib/audit/hash'
import { checkpointObjectKey, planObjects, toNdjson, MAX_ROWS_PER_OBJECT, type StoredRow } from '../../src/lib/audit/offsite/batch'
import { putObjectOnce } from '../../src/lib/audit/offsite/r2'
import { argValue, hasFlag, loadConfig } from './lib/config'
import { connect, readHeads, readOnlySnapshot, readRows } from './lib/db'
import { sendAlarm } from './lib/mail'
import { ensureDir, loadKeys, newestLocal, readJson, writeJsonAtomic } from './lib/state'

interface UploadState {
  accounts: Record<string, { seq: string; hash: string }>
  checkpoints: Record<string, string>
  last_run?: string
  last_success?: string
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

async function main() {
  const cfg = loadConfig()
  if (!cfg.r2) throw new Error('config has no "r2" section')
  const r2 = cfg.r2
  ensureDir(cfg.stateDir)

  if (hasFlag('--stdin')) {
    const key = argValue('--key') ?? ''
    if (!/^audit\/archive\/\d{4}-\d{2}\.dump$/.test(key)) throw new Error('--key must be audit/archive/YYYY-MM.dump')
    const body = await readStdin()
    if (!body.length) throw new Error('nothing on stdin')
    const r = await putObjectOnce(r2, key, body, 'application/octet-stream')
    console.log(`${key}: ${r} (${body.length} bytes)`)
    return
  }

  const { publicKey } = loadKeys(cfg.signingKey)
  const stateFile = path.join(cfg.stateDir, 'upload-state.json')
  const state = readJson<UploadState>(stateFile, { accounts: {}, checkpoints: {} })
  state.checkpoints ??= {}
  const problems: string[] = []
  let objects = 0
  let rowsUp = 0
  const db = await connect(cfg.dbUrl)
  try {
    // Checkpoints are read before rows, so rows uploaded in this run reach at least as far.
    const newest = newestLocal(cfg.stateDir, publicKey)
    const heads = await readOnlySnapshot(db, () => readHeads(db))
    for (const h of heads) {
      const acc = h.account_id
      const prev = state.accounts[acc]
      let cur = prev ? { seq: BigInt(prev.seq), hash: prev.hash } : { seq: BigInt(0), hash: genesisHash(acc) }
      const headSeq = BigInt(h.last_seq)
      if (headSeq < cur.seq) {
        problems.push(`${acc}: chain head went BACKWARDS (uploaded through ${cur.seq}, head now ${headSeq})`)
        continue
      }
      while (cur.seq < headSeq) {
        const rows: StoredRow[] = await readOnlySnapshot(db, () => readRows(db, acc, cur.seq, headSeq, MAX_ROWS_PER_OBJECT))
        if (!rows.length) {
          problems.push(`${acc}: rows after seq ${cur.seq} are missing (head says ${headSeq})`)
          break
        }
        const c = checkChain(acc, rows, cur)
        if (!c.ok) {
          problems.push(`${acc}: chain breaks at seq ${c.brokenAtSeq} (${c.why}) — not uploading past seq ${cur.seq}`)
          break
        }
        for (const o of planObjects(acc, rows)) {
          const result = await putObjectOnce(r2, o.key, Buffer.from(toNdjson(o.rows), 'utf8'), 'application/x-ndjson')
          // "exists": a run that stopped after the PUT and before saving progress.
          // The external check compares contents, so a stale object cannot hide.
          objects += result === 'created' ? 1 : 0
          rowsUp += o.rows.length
          cur = { seq: o.to, hash: o.rows[o.rows.length - 1].row_hash }
          state.accounts[acc] = { seq: cur.seq.toString(), hash: cur.hash }
          writeJsonAtomic(stateFile, state)
        }
      }
      const cp = newest.get(acc)
      if (cp && (!state.checkpoints[acc] || BigInt(cp.through_seq) > BigInt(state.checkpoints[acc]))) {
        await putObjectOnce(r2, checkpointObjectKey(acc, cp.through_seq), Buffer.from(JSON.stringify(cp) + '\n', 'utf8'), 'application/json')
        state.checkpoints[acc] = cp.through_seq
        objects++
        writeJsonAtomic(stateFile, state)
      }
    }
    state.last_run = new Date().toISOString()
    if (!problems.length) state.last_success = state.last_run
    writeJsonAtomic(stateFile, state)
    console.log(`[crm-audit upload] ${state.last_run} ${objects} object(s), ${rowsUp} row(s), ${problems.length} problem(s)`)
  } finally {
    await db.end().catch(() => {})
    if (problems.length) {
      await sendAlarm(
        { smtp: cfg.smtp, recipients: cfg.recipients, label: cfg.label, stateDir: cfg.stateDir, throttleKey: `upload:${problems.join('|').slice(0, 300)}` },
        'The off-server audit upload found a problem',
        problems,
      )
      process.exitCode = 2
    }
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[crm-audit upload] failed: ${msg}`)
  process.exitCode = 1
  try {
    const cfg = loadConfig()
    // Network blips happen: alarm only once uploads have failed for 2 h,
    // then at most every 6 h.
    const st = readJson<UploadState>(path.join(cfg.stateDir, 'upload-state.json'), { accounts: {}, checkpoints: {} })
    const since = st.last_success ? Date.now() - Date.parse(st.last_success) : Infinity
    if (since < 2 * 3600_000) return
    await sendAlarm({ smtp: cfg.smtp, recipients: cfg.recipients, label: cfg.label, stateDir: cfg.stateDir, throttleKey: 'upload-crash' }, 'The off-server audit upload could not run', [msg])
  } catch {
    /* cron mails stderr */
  }
  process.exitCode = 1
})
