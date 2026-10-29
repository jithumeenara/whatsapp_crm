/**
 * WhatsApp confirmations after a public form is sent: one to the person
 * who filled it (listing everyone they added), and one to each person on
 * their own number. Both optional, both an approved template — these
 * numbers have never written to the business, so plain text would never
 * arrive (see staff-alert.ts on the 24-hour rule).
 *
 * The form is public, so whoever fills it chooses the numbers. What keeps
 * that from becoming a way to message strangers at the business's cost:
 * only the business's own approved template goes out (never the
 * stranger's words as the message), at most one message per number per
 * submission, the people-per-submission cap, the route's per-address
 * limit, and a per-form ceiling here. Never throws: the rows are saved.
 */

import { prisma } from '@/lib/db'
import { sendStaffAlert } from '@/lib/whatsapp/staff-alert'
import { COUNTRY_CODES, DEFAULT_COUNTRY_ISO, splitE164 } from '@/lib/country-codes'
import { confirmParams, whatsappNumber, type FormConfirm } from './form-group'

/** Past these the rows are still saved; only the messages stop.
 *  Per form: 20 in 10 minutes. Per address that sent the form: 5 an hour.
 *  Per number: one a day, whichever form or person asks for it. */
const PER_FORM = { limit: 20, windowMs: 10 * 60_000 }
const PER_SENDER = { limit: 5, windowMs: 60 * 60_000 }
const PER_NUMBER_MS = 24 * 60 * 60_000
// Counted here, not through lib/rate-limit, for the reason record-events.ts gives.
const recent = new Map<string, number[]>()
const lastToNumber = new Map<string, number>()

function room(key: string, limit: { limit: number; windowMs: number }, now: number): number {
  const list = (recent.get(key) ?? []).filter((t) => now - t < limit.windowMs)
  recent.set(key, list)
  return Math.max(0, limit.limit - list.length)
}

function spend(key: string, n: number, now: number) {
  const list = recent.get(key) ?? []
  for (let i = 0; i < n; i++) list.push(now)
  recent.set(key, list)
}

/** Which of these numbers may be sent to now; counts what it allows. */
function allowed(tableId: string, sender: string, numbers: string[]): Set<string> {
  const now = Date.now()
  if (lastToNumber.size > 50_000) for (const [k, t] of lastToNumber) if (now - t > PER_NUMBER_MS) lastToNumber.delete(k)
  const fresh = numbers.filter((n) => now - (lastToNumber.get(`${tableId}:${n}`) ?? 0) > PER_NUMBER_MS)
  const n = Math.min(fresh.length, room(`form:${tableId}`, PER_FORM, now), room(`sender:${sender}`, PER_SENDER, now))
  const ok = fresh.slice(0, n)
  spend(`form:${tableId}`, ok.length, now)
  spend(`sender:${sender}`, ok.length, now)
  for (const to of ok) lastToNumber.set(`${tableId}:${to}`, now)
  return new Set(ok)
}

/** The business's country dial code ("+91"), from its owner's number. */
export async function businessDial(accountId: string): Promise<string> {
  const fallback = COUNTRY_CODES.find((c) => c.iso === DEFAULT_COUNTRY_ISO)?.dial ?? '+91'
  try {
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { owner_user_id: true } })
    const owner = account ? await prisma.profile.findUnique({ where: { user_id: account.owner_user_id }, select: { phone: true } }) : null
    const digits = (owner?.phone ?? '').replace(/\D/g, '')
    const iso = digits ? splitE164(`+${digits}`)?.iso : undefined
    return COUNTRY_CODES.find((c) => c.iso === iso)?.dial ?? fallback
  } catch {
    return fallback
  }
}

export interface ConfirmRow {
  data: Record<string, unknown>
}

export async function sendFormConfirmations(args: {
  accountId: string
  tableId: string
  business: string
  reference: string
  rows: ConfirmRow[]
  /** The per-person question that names each person. */
  nameKey: string | null
  /** A contact from a signed personal link: their number is the submitter's. */
  contactPhone: string | null
  submitter: FormConfirm | null
  person: FormConfirm | null
  /** The address the form came from, for the per-sender limit. */
  sender: string
  /** Questions never sent in a message (ID numbers, bank details). */
  sensitive: ReadonlySet<string>
}): Promise<void> {
  try {
    if (args.rows.length === 0 || (!args.submitter && !args.person)) return
    const dial = await businessDial(args.accountId)
    const names = args.rows.map((r) => String(r.data[args.nameKey ?? ''] ?? '').trim()).filter(Boolean)
    const sends: Array<{ to: string; spec: FormConfirm; params: string[] }> = []
    const used = new Set<string>()

    if (args.submitter) {
      const s = args.submitter
      const to = args.contactPhone
        ? whatsappNumber(`+${args.contactPhone.replace(/\D/g, '')}`, dial)
        : s.phone_key ? whatsappNumber(args.rows[0].data[s.phone_key], dial) : null
      if (to) {
        used.add(to)
        sends.push({ to, spec: s, params: confirmParams(s, { data: args.rows[0].data, names, count: args.rows.length, reference: args.reference, business: args.business, sensitive: args.sensitive }) })
      }
    }
    if (args.person && args.person.phone_key) {
      const p = args.person
      for (const row of args.rows) {
        const to = whatsappNumber(row.data[p.phone_key], dial)
        // One message per number: the person who filled the form already has theirs.
        if (!to || used.has(to)) continue
        used.add(to)
        const personName = String(row.data[args.nameKey ?? ''] ?? '').trim()
        sends.push({ to, spec: p, params: confirmParams(p, { data: row.data, names, count: args.rows.length, reference: args.reference, business: args.business, personName, sensitive: args.sensitive }) })
      }
    }

    const ok = allowed(args.tableId, args.sender, sends.map((s) => s.to))
    if (ok.size < sends.length) console.warn(`[form-confirm] ${args.tableId}: ${sends.length - ok.size} confirmation(s) held back by the limits — rows saved`)
    for (const s of sends.filter((x) => ok.has(x.to))) {
      const r = await sendStaffAlert({
        accountId: args.accountId,
        numbers: [s.to],
        template: s.spec.template,
        templateParams: s.params,
        text: '',
        label: 'form-confirm',
      })
      if (r.failed.length) console.warn('[form-confirm] not delivered:', r.failed.map((f) => f.error).join('; '))
    }
  } catch (err) {
    console.error('[form-confirm] failed:', err instanceof Error ? err.message : err)
  }
}
