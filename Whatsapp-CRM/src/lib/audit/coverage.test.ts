import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { AUDIT_ACTIONS } from './actions'

/**
 * Coverage guard (docs/plans/audit-log-plan.md §5 "A coverage test that
 * cannot be fooled"). Every API route that can change something must
 * either use the audit log or be listed below with the reason it does not.
 * A new mutating route with neither fails here — decide, then add one.
 *
 * Exempt only routes that write nothing durable, or only presence / a
 * preview / a test / an AI suggestion, or whose write is audited in the
 * library they call (named in the reason).
 */
const EXEMPT: Record<string, string> = {
  'account/mfa/enroll/start/route.ts': 'start only: a short-lived challenge; enrolment is audited in enroll/confirm',
  'account/profile/email/verify/start/route.ts': 'start only: a short-lived token; the verification is audited in auth/verify-email',
  'account/profile/phone/verify/start/route.ts': 'start only: a short-lived challenge; the verification is audited in phone/verify/confirm',
  'ai-config/admin-test/route.ts': 'AI preview: answers a test question, writes nothing',
  'ai-config/live-voice/route.ts': 'issues a short-lived voice ticket, writes nothing durable',
  'ai-config/test/route.ts': 'AI test reply with an unsaved key held in memory; only usage is counted',
  'automations/engine/route.ts': 'manual trigger; each step an automation writes is audited in lib/automations/engine.ts (agentRecordWritten)',
  'broadcasts/audience-count/route.ts': 'preview: counts an audience, writes nothing',
  'broadcasts/parse-excel/route.ts': 'preview: parses an uploaded sheet, writes nothing',
  'catalog/discover/route.ts': 'lists catalogs from Meta, writes nothing',
  'contacts/import/check/route.ts': 'preview: checks rows before an import, writes nothing (the import is audited)',
  'csp-report/route.ts': 'browser CSP violation report, logged to the console only',
  'data-tables/[id]/find-row/route.ts': 'preview: finds matching rows, writes nothing',
  'data-tables/[id]/form/translate/route.ts': 'AI suggestion: returns translations; saving the form is audited in data-tables/[id]/form',
  'google/sheet-ping/route.ts': 'Apps Script ping: stamps instant_ping_at; the sync it starts is audited in lib/google/sheet-two-way.ts',
  'google/sheets/step-test/route.ts': 'test run of a chatbot sheet step from the builder',
  'heartbeat/route.ts': 'presence: last-seen timestamp only',
  'integrations/test/route.ts': 'test only: fetches sample rows without saving anything',
  'leads/views/route.ts': "a person's own saved lead filter, no business data",
  'messages/ai-suggest/route.ts': 'AI suggestion shown in the composer; nothing is sent or saved',
  'messages/translate/route.ts': 'caches a translation and detected language on the message; no business data changed',
  'meta-ads/track/route.ts': 'public pixel relay: forwards a web event to Meta, writes nothing',
  'presence/leave/route.ts': 'presence: marks the person offline',
  'push/subscribe/route.ts': "a person's own browser push subscription",
  'razorpay/verify-payment/route.ts': 'checks a payment signature and answers; writes nothing (saving the payment is audited in razorpay/save-payment)',
  'service-categories/suggest/route.ts': 'AI suggestion, writes nothing',
  'sms/config/test-message/route.ts': 'test message to the admin, writes nothing',
  'voice/context/route.ts': 'voice server reads caller context, writes nothing',
  'webchat/handoff/route.ts': 'website visitor asks for a person; the lead it makes is audited in lib/leads/handoff-lead.ts and lib/leads/auto-create.ts',
  'webchat/messages/route.ts': 'website visitor chat message (inbound customer message, like a WhatsApp webhook message)',
  'webchat/session/route.ts': 'website visitor chat session; expiry sweep audited in lib/webchat/session.ts',
  'whatsapp/react/route.ts': 'an emoji reaction on a message, no business data changed',
  'whatsapp/templates/suggest/route.ts': 'AI suggestion of template drafts, writes nothing',
  'whatsapp/validate-contacts/route.ts': 'checks numbers with Meta, writes nothing',
}

const ROOT = process.cwd()
const API = path.join(ROOT, 'src', 'app', 'api')
const MUTATING = /export\s+(async\s+)?(function|const)\s+(POST|PATCH|PUT|DELETE)\b|export\s*\{[^}]*\b(POST|PATCH|PUT|DELETE)\b/
const USES_AUDIT = /@\/lib\/audit|lib\/audit\/|auditFlowAction/

function walk(dir: string, match: (name: string) => boolean, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, match, out)
    } else if (match(e.name)) out.push(p)
  }
  return out
}

// Reads every source file: slow on a busy Windows disk, so a generous limit.
const SLOW = 120_000

const rel = (p: string, base: string) => path.relative(base, p).split(path.sep).join('/')

describe('audit coverage', () => {
  const routes = walk(API, (n) => n === 'route.ts')

  it('finds the API routes', () => {
    expect(routes.length).toBeGreaterThan(100)
  }, SLOW)

  it('every mutating route is audited or exempt with a reason', () => {
    const missing: string[] = []
    for (const file of routes) {
      const src = fs.readFileSync(file, 'utf8')
      if (!MUTATING.test(src)) continue
      const key = rel(file, API)
      if (USES_AUDIT.test(src)) continue
      if (EXEMPT[key]?.trim()) continue
      missing.push(key)
    }
    expect(missing, `Add an audit() call, or an EXEMPT entry with a reason, for:\n${missing.join('\n')}`).toEqual([])
  }, SLOW)

  it('the exempt list holds only real, mutating, unaudited routes', () => {
    const stale: string[] = []
    for (const key of Object.keys(EXEMPT)) {
      const file = path.join(API, ...key.split('/'))
      if (!fs.existsSync(file)) {
        stale.push(`${key} (no such file)`)
        continue
      }
      const src = fs.readFileSync(file, 'utf8')
      if (!MUTATING.test(src)) stale.push(`${key} (no longer mutating)`)
      else if (USES_AUDIT.test(src)) stale.push(`${key} (now audited — remove from EXEMPT)`)
    }
    expect(stale).toEqual([])
  }, SLOW)

  it('every literal audit action name in src/ is a registered action', () => {
    const known = new Set<string>(AUDIT_ACTIONS)
    const files = walk(path.join(ROOT, 'src'), (n) => /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n))
    const ACTION = /\baction:\s*['"]([a-z_]+\.[a-z_]+)['"]/g
    const unknown: string[] = []
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      for (const m of src.matchAll(ACTION)) {
        if (!known.has(m[1])) unknown.push(`${rel(file, ROOT)}: ${m[1]}`)
      }
    }
    expect(unknown).toEqual([])
  }, SLOW)
})
