/**
 * The crm-audit scripts' own settings: /etc/crm-audit/<app>.json, mode
 * 0400, owned by the crm-audit Unix user. Never the app's .env, never the
 * database — an admin of the app cannot change where alarms go or read
 * the R2 or SMTP secrets.
 *
 * {
 *   "label": "ACSTI",
 *   "db_url": "postgresql://crm_audit_reader:...@localhost:5432/acsti",
 *   "signing_key": "/etc/crm-audit/acsti-ed25519.pem",
 *   "state_dir": "/var/lib/crm-audit/acsti",
 *   "r2": { "endpoint": "https://<id>.r2.cloudflarestorage.com", "bucket": "crm-audit-acsti",
 *           "access_key_id": "...", "secret_access_key": "..." },
 *   "r2_read": { ...same shape, a READ-ONLY token; optional... },
 *   "smtp": { "host": "smtp.zoho.in", "port": 465, "user": "info@scycon.com", "pass": "...", "from": "info@scycon.com" },
 *   "recipients": ["owner@example.com", "platform@example.com"]
 * }
 */

import fs from 'fs'
import path from 'path'
import type { R2Config } from '../../../src/lib/audit/offsite/r2'

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

export interface AuditConfig {
  label: string
  dbUrl: string
  signingKey: string
  stateDir: string
  r2: R2Config | null
  r2Read: R2Config | null
  smtp: SmtpConfig | null
  recipients: string[]
}

function str(o: Record<string, unknown>, k: string, required = true): string {
  const v = o[k]
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (required) throw new Error(`config: "${k}" is missing`)
  return ''
}

function r2Of(v: unknown, name: string): R2Config | null {
  if (!v) return null
  if (typeof v !== 'object') throw new Error(`config: "${name}" must be an object`)
  const o = v as Record<string, unknown>
  const endpoint = str(o, 'endpoint')
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/?$/i.test(endpoint)) throw new Error(`config: ${name}.endpoint must be https://<account-id>.r2.cloudflarestorage.com`)
  return { endpoint, bucket: str(o, 'bucket'), accessKeyId: str(o, 'access_key_id'), secretAccessKey: str(o, 'secret_access_key'), region: str(o, 'region', false) || 'auto' }
}

export function argValue(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

export function loadConfig(file = argValue('--config')): AuditConfig {
  if (!file) throw new Error('usage: --config /etc/crm-audit/<app>.json')
  const st = fs.statSync(file)
  // The file holds the R2 and SMTP secrets: nobody but its owner may read it.
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    throw new Error(`config ${file} is readable by others (mode ${(st.mode & 0o777).toString(8)}); run: chmod 400 ${file}`)
  }
  const o = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  const smtpRaw = o.smtp as Record<string, unknown> | undefined
  const smtp: SmtpConfig | null = smtpRaw
    ? { host: str(smtpRaw, 'host'), port: Number(smtpRaw.port ?? 465), user: str(smtpRaw, 'user'), pass: str(smtpRaw, 'pass'), from: str(smtpRaw, 'from') }
    : null
  const recipients = Array.isArray(o.recipients) ? o.recipients.filter((x): x is string => typeof x === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).map((x) => x.trim().toLowerCase()) : []
  const label = str(o, 'label')
  return {
    label,
    dbUrl: str(o, 'db_url'),
    signingKey: str(o, 'signing_key'),
    stateDir: str(o, 'state_dir', false) || path.join('/var/lib/crm-audit', label.toLowerCase().replace(/[^a-z0-9-]/g, '-')),
    r2: r2Of(o.r2, 'r2'),
    r2Read: r2Of(o.r2_read, 'r2_read'),
    smtp,
    recipients,
  }
}
