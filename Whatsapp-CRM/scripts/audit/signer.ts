/**
 * Hourly checkpoint signer (plan §11) — runs as the crm-audit Unix user,
 * never as the app:
 *
 *   node /opt/crm-audit/signer.cjs --config /etc/crm-audit/<app>.json
 *   node /opt/crm-audit/signer.cjs --config ... --at <account-uuid>:<seq>   (retention: sign a past point)
 *
 * For each account chain with new events it walks the rows added since
 * its own last signed point (kept in its state file, which the app cannot
 * write), checks they link up and end exactly at audit_chain_heads, then
 * signs (through_seq, through_hash, row_count) with the Ed25519 key only
 * crm-audit can read. The checkpoint goes to checkpoints.ndjson first,
 * then into audit_checkpoints. Any break is a red alarm and nothing is
 * signed for that chain.
 */

import path from 'path'
import { genesisHash } from '../../src/lib/audit/hash'
import { signCheckpoint, type Checkpoint } from '../../src/lib/audit/offsite/checkpoint'
import { argValue, loadConfig } from './lib/config'
import { connect, insertCheckpoint, minSeq, readHeads, readOnlySnapshot, walk } from './lib/db'
import { sendAlarm } from './lib/mail'
import { appendLine, checkpointsFile, ensureDir, loadKeys, readJson, readLocalCheckpoints, writeJsonAtomic } from './lib/state'

interface SignerState {
  accounts: Record<string, { seq: string; hash: string; at: string }>
  last_run?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function main() {
  const cfg = loadConfig()
  ensureDir(cfg.stateDir)
  const { privateKey, publicKey } = loadKeys(cfg.signingKey)
  const stateFile = path.join(cfg.stateDir, 'signer-state.json')
  const state = readJson<SignerState>(stateFile, { accounts: {} })
  const problems: string[] = []
  const signed: Checkpoint[] = []
  const db = await connect(cfg.dbUrl)

  const record = async (cp: Checkpoint) => {
    // The local file first: it is the copy the app can never touch.
    appendLine(checkpointsFile(cfg.stateDir), JSON.stringify(cp))
    try {
      await insertCheckpoint(db, cp)
    } catch (err) {
      problems.push(`checkpoint for ${cp.account_id} at seq ${cp.through_seq} was signed but could not be stored in the database: ${err instanceof Error ? err.message : err}`)
    }
    signed.push(cp)
  }

  try {
    const at = argValue('--at')
    if (at) {
      // A past point, for the retention job's "final checkpoint" before a month is archived.
      const [acc, seqText] = at.split(':')
      if (!UUID.test(acc ?? '') || !/^\d+$/.test(seqText ?? '')) throw new Error('--at must be <account-uuid>:<seq>')
      const target = BigInt(seqText)
      const local = readLocalCheckpoints(cfg.stateDir, publicKey).list.filter((c) => c.account_id === acc && BigInt(c.through_seq) <= target)
      local.sort((a, b) => (BigInt(a.through_seq) < BigInt(b.through_seq) ? 1 : -1))
      const from = local[0] ? { seq: BigInt(local[0].through_seq), hash: local[0].through_hash } : { seq: BigInt(0), hash: genesisHash(acc) }
      const w = await readOnlySnapshot(db, () => walk(db, acc, target, from))
      if (!w.ok) throw new Error(`chain ${acc} breaks at seq ${w.brokenAtSeq} (${w.why}) — not signing`)
      await record(signCheckpoint({ account_id: acc, through_seq: w.seq.toString(), through_hash: w.hash, row_count: (w.seq - from.seq).toString(), created_at: new Date().toISOString() }, privateKey))
      console.log(`signed ${acc} through ${w.seq}`)
      return
    }

    const plan = await readOnlySnapshot(db, async () => {
      const heads = await readHeads(db)
      const out: Array<{ acc: string; ok: true; seq: bigint; hash: string; from: bigint } | { acc: string; ok: false; why: string }> = []
      for (const h of heads) {
        const prev = state.accounts[h.account_id]
        const headSeq = BigInt(h.last_seq)
        let start: { seq: bigint; hash: string }
        if (prev) {
          start = { seq: BigInt(prev.seq), hash: prev.hash }
        } else {
          // First time this chain is seen: from genesis, unless older months were archived.
          const min = await minSeq(db, h.account_id)
          if (min !== null && min > BigInt(1)) {
            out.push({ acc: h.account_id, ok: false, why: `chain starts at seq ${min}, not 1, and the signer has no earlier point for it` })
            continue
          }
          start = { seq: BigInt(0), hash: genesisHash(h.account_id) }
        }
        if (headSeq < start.seq) {
          out.push({ acc: h.account_id, ok: false, why: `chain head went BACKWARDS: was ${start.seq}, now ${headSeq} — rows removed or database rolled back` })
          continue
        }
        if (headSeq === start.seq) {
          if (h.last_hash !== start.hash) out.push({ acc: h.account_id, ok: false, why: `head at seq ${headSeq} has a different hash than was signed — chain rewritten` })
          continue
        }
        const w = await walk(db, h.account_id, headSeq, start)
        if (!w.ok) {
          out.push({ acc: h.account_id, ok: false, why: `chain breaks at seq ${w.brokenAtSeq} (${w.why})` })
          continue
        }
        if (w.hash !== h.last_hash) {
          out.push({ acc: h.account_id, ok: false, why: `rows end at seq ${w.seq} with a hash that does not match audit_chain_heads` })
          continue
        }
        out.push({ acc: h.account_id, ok: true, seq: w.seq, hash: w.hash, from: start.seq })
      }
      // A chain the signer has signed before but whose head row is gone.
      for (const acc of Object.keys(state.accounts)) {
        if (!heads.some((h) => h.account_id === acc)) out.push({ acc, ok: false, why: 'chain head row is missing from audit_chain_heads' })
      }
      return out
    })

    for (const p of plan) {
      if (!p.ok) {
        problems.push(`${p.acc}: ${p.why}`)
        continue
      }
      const cp = signCheckpoint({ account_id: p.acc, through_seq: p.seq.toString(), through_hash: p.hash, row_count: (p.seq - p.from).toString(), created_at: new Date().toISOString() }, privateKey)
      await record(cp)
      state.accounts[p.acc] = { seq: cp.through_seq, hash: cp.through_hash, at: cp.created_at }
    }
    state.last_run = new Date().toISOString()
    writeJsonAtomic(stateFile, state)
    console.log(`[crm-audit signer] ${new Date().toISOString()} signed ${signed.length} chain(s), ${problems.length} problem(s)`)
  } finally {
    await db.end().catch(() => {})
    if (problems.length) {
      await sendAlarm(
        { smtp: cfg.smtp, recipients: cfg.recipients, label: cfg.label, stateDir: cfg.stateDir, throttleKey: `signer:${problems.join('|').slice(0, 300)}` },
        'The hourly audit check found a problem',
        problems,
      )
      process.exitCode = 2
    }
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`[crm-audit signer] failed: ${msg}`)
  try {
    const cfg = loadConfig()
    await sendAlarm({ smtp: cfg.smtp, recipients: cfg.recipients, label: cfg.label, stateDir: cfg.stateDir, throttleKey: `signer-crash:${msg.slice(0, 200)}` }, 'The audit signer could not run', [msg])
  } catch {
    /* config unreadable: cron mails stderr */
  }
  process.exitCode = 1
})
