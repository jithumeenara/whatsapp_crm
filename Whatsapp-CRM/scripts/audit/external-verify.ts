/**
 * The check that runs OFF the server (plan §20a), daily in GitHub Actions
 * (.github/workflows/audit-verify.yml):
 *
 *   npx tsx scripts/audit/external-verify.ts
 *
 * Reads the R2 copy with a READ-ONLY token, asks the server for its chain
 * heads (GET /api/audit/head, bearer AUDIT_HEAD_TOKEN), and checks per
 * account that the copy is a valid chain, its newest checkpoint is signed
 * by the audit key and sits on it, and the server still holds everything
 * the copy holds (seq at least as far, same hash at the copy's end).
 * Any mismatch fails the job and mails the alarm. A hacked server cannot
 * silence this: nothing here runs on it or reads its secrets.
 *
 * Environment (GitHub secrets):
 *   AUDIT_LABEL               "ACSTI"
 *   AUDIT_HEAD_URL            https://crm.example.com/api/audit/head
 *   AUDIT_HEAD_TOKEN          the same value as AUDIT_HEAD_TOKEN in the app's .env
 *   AUDIT_PUBLIC_KEY          the PEM public key printed at setup
 *   R2_ENDPOINT, R2_BUCKET, R2_READ_ACCESS_KEY_ID, R2_READ_SECRET_ACCESS_KEY
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, ALARM_TO (comma-separated)
 */

import fs from 'fs'
import { fromNdjson, parseObjectKey, type StoredRow } from '../../src/lib/audit/offsite/batch'
import { keyFingerprint, parseCheckpoint, prettyFingerprint, type Checkpoint } from '../../src/lib/audit/offsite/checkpoint'
import { verifyOffsite, type OffsiteResult, type ServerHead } from '../../src/lib/audit/offsite/compare'
import { getObject, listKeys, type R2Config } from '../../src/lib/audit/offsite/r2'
import { sendAlarm } from './lib/mail'
import type { SmtpConfig } from './lib/config'

const env = (k: string, required = true): string => {
  const v = (process.env[k] ?? '').trim()
  if (!v && required) throw new Error(`missing ${k}`)
  return v
}

async function fetchHeads(url: string, token: string, at: Array<[string, string]>): Promise<ServerHead[]> {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error('AUDIT_HEAD_URL must be https')
  for (const [acc, seq] of at) u.searchParams.append('at', `${acc}:${seq}`)
  const res = await fetch(u, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`server head: HTTP ${res.status}`)
  const body = (await res.json()) as { accounts?: ServerHead[] }
  if (!Array.isArray(body.accounts)) throw new Error('server head: unexpected answer')
  return body.accounts
}

async function main() {
  const label = env('AUDIT_LABEL', false) || 'server'
  const smtp: SmtpConfig | null = env('SMTP_HOST', false)
    ? { host: env('SMTP_HOST'), port: Number(env('SMTP_PORT', false) || 465), user: env('SMTP_USER'), pass: env('SMTP_PASS'), from: env('SMTP_FROM') }
    : null
  const recipients = env('ALARM_TO', false).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  const alarm = (title: string, lines: string[]) => sendAlarm({ smtp, recipients, label, stateDir: null }, title, lines)

  try {
    const r2: R2Config = {
      endpoint: env('R2_ENDPOINT'),
      bucket: env('R2_BUCKET'),
      accessKeyId: env('R2_READ_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_READ_SECRET_ACCESS_KEY'),
      region: 'auto',
    }
    const publicKey = env('AUDIT_PUBLIC_KEY', false).replace(/\\n/g, '\n') || null

    // 1. Everything in the copy, grouped by account.
    const keys = await listKeys(r2, 'audit/')
    const rowsKeys = new Map<string, string[]>()
    const cpKeys = new Map<string, string[]>()
    for (const k of keys) {
      const p = parseObjectKey(k)
      if (!p) continue
      const m = p.kind === 'rows' ? rowsKeys : cpKeys
      m.set(p.accountId, [...(m.get(p.accountId) ?? []), k])
    }
    const accounts = new Set([...rowsKeys.keys(), ...cpKeys.keys()])
    const objects = new Map<string, Array<{ key: string; rows: StoredRow[] }>>()
    const checkpoints = new Map<string, Checkpoint | null>()
    const r2Last = new Map<string, string>()
    for (const acc of accounts) {
      const list: Array<{ key: string; rows: StoredRow[] }> = []
      for (const k of (rowsKeys.get(acc) ?? []).sort()) {
        const buf = await getObject(r2, k)
        list.push({ key: k, rows: buf ? fromNdjson(buf.toString('utf8')) : [] })
      }
      objects.set(acc, list)
      const cks = (cpKeys.get(acc) ?? []).sort()
      let cp: Checkpoint | null = null
      if (cks.length) {
        const buf = await getObject(r2, cks[cks.length - 1])
        try {
          cp = buf ? parseCheckpoint(JSON.parse(buf.toString('utf8'))) : null
        } catch {
          cp = null
        }
      }
      checkpoints.set(acc, cp)
      // The copy's last contiguous seq, to ask the server for its hash there.
      let last = BigInt(0)
      for (const o of list.map((x) => parseObjectKey(x.key)).filter((p): p is Extract<ReturnType<typeof parseObjectKey>, { kind: 'rows' }> => p?.kind === 'rows').sort((a, b) => (a.from < b.from ? -1 : 1))) {
        if (o.from <= last + BigInt(1) && o.to > last) last = o.to
      }
      r2Last.set(acc, last.toString())
    }

    // 2. The server's heads, with its hash at each copy's last seq.
    const heads = await fetchHeads(env('AUDIT_HEAD_URL'), env('AUDIT_HEAD_TOKEN'), [...r2Last.entries()].filter(([, s]) => s !== '0'))
    const headBy = new Map(heads.map((h) => [h.account_id, h]))
    for (const h of heads) accounts.add(h.account_id)

    // 3. Compare.
    const results: OffsiteResult[] = []
    for (const acc of [...accounts].sort()) {
      results.push(verifyOffsite({ accountId: acc, objects: objects.get(acc) ?? [], checkpoint: checkpoints.get(acc) ?? null, publicKey, server: headBy.get(acc) ?? null, now: new Date() }))
    }

    const report = [
      `Off-server audit check — ${label} — ${new Date().toISOString()}`,
      publicKey ? `Key fingerprint: ${prettyFingerprint(keyFingerprint(publicKey))}` : 'No AUDIT_PUBLIC_KEY: signatures NOT checked',
      '',
      ...results.map((r) => `${r.ok ? 'OK  ' : 'FAIL'} ${r.accountId}: copy ${r.rows} rows through seq ${r.r2LastSeq}${r.problems.length ? `\n     - ${r.problems.join('\n     - ')}` : ''}${r.notes.length ? `\n     (${r.notes.join('; ')})` : ''}`),
    ].join('\n')
    console.log(report)
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```\n' + report + '\n```\n')

    const failed = results.filter((r) => !r.ok)
    if (failed.length) {
      await alarm('The off-server audit check FAILED', failed.flatMap((r) => r.problems.map((p) => `${r.accountId}: ${p}`)))
      process.exitCode = 2
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`external verify failed: ${msg}`)
    await alarm('The off-server audit check could not run', [msg])
    process.exitCode = 1
  }
}

void main()
