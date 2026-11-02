/**
 * Audit mail: the daily summary and the red alarm. Sent by crm-audit (or
 * the GitHub job), never by the app — the app's email settings live in the
 * database and an admin can change them; these recipients are fixed in a
 * root-made file.
 *
 * nodemailer is loaded at run time from /opt/crm-audit/node_modules (the
 * setup script installs a pinned version there; the GitHub job installs it
 * with --no-save). It is not part of the app's own bundle.
 */

import path from 'path'
import { createRequire } from 'module'
import type { SmtpConfig } from './config'
import { appendLine, readJson, writeJsonAtomic } from './state'

interface Transport {
  sendMail(m: { from: string; to: string; subject: string; text: string }): Promise<unknown>
}

type MailerModule = { default?: { createTransport: (o: unknown) => Transport }; createTransport?: (o: unknown) => Transport }

/** Finds nodemailer outside the app: AUDIT_NODE_MODULES, /opt/crm-audit, NODE_PATH, then normal lookup.
 *  Paths are built at run time so neither tsc nor the bundler tries to resolve it. */
function loadMailer(): MailerModule {
  const req = createRequire(path.join(process.cwd(), 'crm-audit.js'))
  const bases = [process.env.AUDIT_NODE_MODULES, '/opt/crm-audit/node_modules', ...(process.env.NODE_PATH ?? '').split(path.delimiter)].filter((b): b is string => !!b)
  for (const base of bases) {
    try {
      return req(path.join(base, 'nodemailer')) as MailerModule
    } catch {
      /* next place */
    }
  }
  const name = ['node', 'mailer'].join('')
  return req(name) as MailerModule
}

async function transport(smtp: SmtpConfig): Promise<Transport> {
  let mod: MailerModule
  try {
    mod = loadMailer()
  } catch {
    throw new Error('nodemailer is not installed (npm install --prefix /opt/crm-audit nodemailer@6.9.16)')
  }
  const create = mod.createTransport ?? mod.default?.createTransport
  if (!create) throw new Error('nodemailer is not installed (npm install --prefix /opt/crm-audit nodemailer@6.9.16)')
  return create({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: true,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
  })
}

export async function sendMail(smtp: SmtpConfig | null, to: string[], subject: string, text: string): Promise<void> {
  if (!smtp) throw new Error('no SMTP settings')
  if (!to.length) throw new Error('no recipients')
  const t = await transport(smtp)
  await t.sendMail({ from: smtp.from, to: to.join(', '), subject: subject.replace(/[\r\n]+/g, ' ').slice(0, 200), text })
}

export interface AlarmOptions {
  smtp: SmtpConfig | null
  recipients: string[]
  label: string
  /** Where the alarm log and throttle live; null in the GitHub job. */
  stateDir: string | null
  /** The same alarm is mailed again only after this long (default 6 h). */
  throttleKey?: string
  throttleHours?: number
}

/**
 * The red alarm. Always written to stderr and the local alarm log; mailed
 * unless the same alarm went out within the throttle window. Never throws:
 * an alarm that cannot be mailed is still printed (and cron mails stderr).
 */
export async function sendAlarm(o: AlarmOptions, title: string, lines: string[]): Promise<boolean> {
  const now = new Date()
  const body = [`🔴 Audit alarm — ${o.label}`, '', title, '', ...lines.map((l) => `• ${l}`), '', `Time (UTC): ${now.toISOString()}`, '',
    'What to do: do not restart or "fix" anything yet. Read docs/deploy/audit-setup.md, section "If an alarm arrives".'].join('\n')
  console.error(body)
  if (o.stateDir) {
    try {
      appendLine(path.join(o.stateDir, 'alarms.log'), JSON.stringify({ at: now.toISOString(), title, lines }))
    } catch {
      /* the alarm itself still goes out */
    }
  }
  const throttleFile = o.stateDir ? path.join(o.stateDir, 'alarm-throttle.json') : null
  if (o.throttleKey && throttleFile) {
    const seen = readJson<Record<string, string>>(throttleFile, {})
    const last = seen[o.throttleKey] ? Date.parse(seen[o.throttleKey]) : 0
    if (now.getTime() - last < (o.throttleHours ?? 6) * 3600_000) return false
  }
  try {
    await sendMail(o.smtp, o.recipients, `🔴 Audit alarm — ${o.label}: ${title}`, body)
    if (o.throttleKey && throttleFile) {
      const seen = readJson<Record<string, string>>(throttleFile, {})
      seen[o.throttleKey] = now.toISOString()
      writeJsonAtomic(throttleFile, seen)
    }
    return true
  } catch (err) {
    console.error(`[crm-audit] alarm mail FAILED: ${err instanceof Error ? err.message : err}`)
    return false
  }
}
