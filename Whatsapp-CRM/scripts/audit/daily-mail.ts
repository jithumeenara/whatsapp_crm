/**
 * Once a day, as crm-audit:
 *
 *   node /opt/crm-audit/daily-mail.cjs --config /etc/crm-audit/<app>.json
 *   ... --test                    (setup: send a test summary)
 *   ... --alarm "what happened"   (other jobs, e.g. retention.sh: send a red alarm now)
 *
 * Walks every chain in full (checkChain, from genesis or from the signed
 * checkpoint a retired month left behind), and checks it against the
 * newest checkpoint in the local signed file AND the newest checkpoint
 * object in R2 (when a read-only R2 token is configured) — never against
 * the database's own checkpoint table alone, which a rollback brings back
 * too. Sends ONE "all good" summary, or a red alarm listing what failed.
 * Recipients are the fixed ones in the config file.
 */

import path from 'path'
import { genesisHash } from '../../src/lib/audit/hash'
import { keyFingerprint, parseCheckpoint, prettyFingerprint, verifyCheckpoint, type Checkpoint } from '../../src/lib/audit/offsite/checkpoint'
import { parseObjectKey } from '../../src/lib/audit/offsite/batch'
import { getObject, listKeys } from '../../src/lib/audit/offsite/r2'
import { argValue, hasFlag, loadConfig, type AuditConfig } from './lib/config'
import { connect, defaultPartitionRows, minSeq, readHeads, readOnlySnapshot, walk } from './lib/db'
import { sendAlarm, sendMail } from './lib/mail'
import { ensureDir, loadKeys, readJson, readLocalCheckpoints } from './lib/state'
import type { KeyObject } from 'crypto'

async function newestR2Checkpoint(cfg: AuditConfig, acc: string, publicKey: KeyObject): Promise<{ cp: Checkpoint | null; problem?: string }> {
  if (!cfg.r2Read) return { cp: null }
  const keys = (await listKeys(cfg.r2Read, `audit/${acc}/checkpoints/`)).filter((k) => parseObjectKey(k)?.kind === 'checkpoint').sort()
  if (!keys.length) return { cp: null }
  const raw = await getObject(cfg.r2Read, keys[keys.length - 1])
  let cp: Checkpoint | null = null
  try {
    cp = raw ? parseCheckpoint(JSON.parse(raw.toString('utf8'))) : null
  } catch {
    cp = null
  }
  if (!cp) return { cp: null, problem: `the newest R2 checkpoint (${keys[keys.length - 1]}) cannot be read` }
  if (!verifyCheckpoint(cp, publicKey)) return { cp: null, problem: `the newest R2 checkpoint at seq ${cp.through_seq} has a BAD SIGNATURE` }
  return { cp }
}

async function main() {
  const cfg = loadConfig()
  ensureDir(cfg.stateDir)
  const alarmOpts = { smtp: cfg.smtp, recipients: cfg.recipients, label: cfg.label, stateDir: cfg.stateDir }

  const alarmText = argValue('--alarm')
  if (alarmText !== null) {
    await sendAlarm(alarmOpts, alarmText.slice(0, 200) || 'Alarm', [alarmText.slice(0, 2000)])
    return
  }

  const { publicKey } = loadKeys(cfg.signingKey)
  const fingerprint = keyFingerprint(publicKey)
  const local = readLocalCheckpoints(cfg.stateDir, publicKey)
  const problems: string[] = []
  const lines: string[] = []
  if (local.bad) problems.push(`${local.bad} line(s) in the local checkpoint file have a bad signature or cannot be read`)

  const byAccount = new Map<string, Checkpoint[]>()
  for (const c of local.list) byAccount.set(c.account_id, [...(byAccount.get(c.account_id) ?? []), c])
  const newestOf = (list: Checkpoint[] | undefined) =>
    (list ?? []).reduce<Checkpoint | null>((a, c) => (!a || BigInt(c.through_seq) > BigInt(a.through_seq) ? c : a), null)

  const db = await connect(cfg.dbUrl)
  try {
    await readOnlySnapshot(db, async () => {
      const heads = await readHeads(db)
      const seen = new Set<string>()
      for (const h of heads) {
        const acc = h.account_id
        seen.add(acc)
        const headSeq = BigInt(h.last_seq)
        const mine = byAccount.get(acc)
        const newestLocal = newestOf(mine)
        let r2: { cp: Checkpoint | null; problem?: string } = { cp: null }
        try {
          r2 = await newestR2Checkpoint(cfg, acc, publicKey)
        } catch (err) {
          r2 = { cp: null, problem: `R2 could not be read: ${err instanceof Error ? err.message : err}` }
        }
        if (r2.problem) problems.push(`${acc}: ${r2.problem}`)

        // Where the chain starts: genesis, or the signed point a retired month left.
        const min = await minSeq(db, acc)
        let start = { seq: BigInt(0), hash: genesisHash(acc) }
        if (min !== null && min > BigInt(1)) {
          const anchor = (mine ?? []).find((c) => BigInt(c.through_seq) === min - BigInt(1))
          if (!anchor) {
            problems.push(`${acc}: the chain starts at seq ${min} and there is no signed checkpoint at seq ${min - BigInt(1)} — early rows are missing`)
            continue
          }
          start = { seq: BigInt(anchor.through_seq), hash: anchor.through_hash }
        }

        const want = new Set<string>()
        if (newestLocal) want.add(newestLocal.through_seq)
        if (r2.cp) want.add(r2.cp.through_seq)
        const w = await walk(db, acc, headSeq, start, want)
        if (!w.ok) {
          problems.push(`${acc}: chain breaks at seq ${w.brokenAtSeq} (${w.why})`)
          continue
        }
        if (w.hash !== h.last_hash) problems.push(`${acc}: rows end in a hash that does not match audit_chain_heads`)
        for (const [name, cp] of [['local', newestLocal], ['R2', r2.cp]] as const) {
          if (!cp) continue
          const t = BigInt(cp.through_seq)
          if (t > w.seq) problems.push(`${acc}: the database chain (${w.seq}) is SHORTER than the newest ${name} checkpoint (${t}) — rows removed or rolled back`)
          else if (t >= start.seq && w.hashes.get(cp.through_seq) !== cp.through_hash) problems.push(`${acc}: the database differs from the newest ${name} checkpoint at seq ${t} — chain rewritten`)
        }
        lines.push(`${acc}: ${w.seq} events, chain OK${newestLocal ? `, last checkpoint seq ${newestLocal.through_seq}` : ', no checkpoint yet'}${r2.cp ? `, R2 checkpoint seq ${r2.cp.through_seq}` : ''}`)
      }
      for (const acc of byAccount.keys()) {
        if (!seen.has(acc)) problems.push(`${acc}: signed checkpoints exist but the chain head row is GONE from the database`)
      }
      const def = await defaultPartitionRows(db)
      if (def) problems.push(`${def} event(s) sit in the default partition — a month's partition was missing`)
    })
  } finally {
    await db.end().catch(() => {})
  }

  // The other two jobs still running?
  const now = Date.now()
  const signer = readJson<{ last_run?: string }>(path.join(cfg.stateDir, 'signer-state.json'), {})
  const upload = readJson<{ last_success?: string }>(path.join(cfg.stateDir, 'upload-state.json'), {})
  const hoursSince = (iso?: string) => (iso ? (now - Date.parse(iso)) / 3600_000 : Infinity)
  if (hoursSince(signer.last_run) > 2) problems.push(`the hourly signer has not run since ${signer.last_run ?? 'ever'}`)
  if (cfg.r2 && hoursSince(upload.last_success) > 1) problems.push(`the off-server upload has not succeeded since ${upload.last_success ?? 'ever'}`)
  if (!cfg.r2Read) lines.push('R2 checkpoints not compared here (no read-only R2 token in the config); the GitHub check does it.')

  const today = local.list.filter((c) => now - Date.parse(c.created_at) < 24 * 3600_000)
  const summary = [
    `Audit log — ${cfg.label} — ${new Date().toISOString().slice(0, 10)}`,
    '',
    ...lines,
    '',
    `Checkpoints signed in the last 24 h (${today.length}):`,
    ...today.map((c) => `  ${c.created_at}  ${c.account_id}  through seq ${c.through_seq}  ${c.through_hash.slice(0, 16)}…  (+${c.row_count})`),
    '',
    `Signing key fingerprint (SHA-256): ${prettyFingerprint(fingerprint)}`,
    'Compare it with the fingerprint you wrote down at setup (kept OFF the server). If it differs, treat this mail as an alarm.',
  ].join('\n')

  if (problems.length) {
    await sendAlarm(alarmOpts, 'The daily audit check FAILED', [...problems, '', summary])
    process.exitCode = 2
    return
  }
  const subject = hasFlag('--test') ? `Audit log — ${cfg.label} — test mail, all good` : `Audit log — ${cfg.label} — all good`
  await sendMail(cfg.smtp, cfg.recipients, `✅ ${subject}`, summary)
  console.log(`[crm-audit daily] ${new Date().toISOString()} all good, mailed ${cfg.recipients.length} recipient(s)`)
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[crm-audit daily] failed: ${msg}`)
  process.exitCode = 1
  try {
    const cfg = loadConfig()
    await sendAlarm({ smtp: cfg.smtp, recipients: cfg.recipients, label: cfg.label, stateDir: cfg.stateDir }, 'The daily audit check could not run', [msg])
  } catch {
    /* cron mails stderr */
  }
})
