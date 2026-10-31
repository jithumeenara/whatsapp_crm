/**
 * The server half of people checking their own details from a Google
 * Sheet (sheet-verify.ts has the rules). Reads and writes the sheet with
 * the account's own Google connection; keeps per person only a reference,
 * a state and how each message went.
 */

import { prisma } from '@/lib/db'
import { googleAccessToken } from '@/lib/google/oauth'
import { appendRows, columnLetter, ensureTab, readRange, readRowDropdowns, readTab, tabRange, writeCells, writeHeaderRow } from '@/lib/google/sheets'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveWhatsAppConfig } from '@/lib/whatsapp/resolve-config'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { templateSafe } from '@/lib/whatsapp/staff-alert'
import { sendSmsText } from '@/lib/messaging/channels/sms'
import { sendEmail } from '@/lib/messaging/channels/email'
import { businessTimezone } from '@/lib/ai/human-date'
import { businessDial } from '@/lib/data-store/form-confirm'
import { whatsappNumber } from '@/lib/data-store/form-group'
import {
  cannotSend,
  cleanSetup,
  columnOf,
  fillText,
  inScope,
  maskValue,
  templateValues,
  LOG_HEADERS,
  LOG_TAB,
  MAX_ROWS,
  REF_HEADER,
  STATUS_HEADER,
  type Change,
  type MessageValues,
  type RowDropdowns,
  type VerifySetup,
} from './sheet-verify'
import { makeRef, signLink } from './sheet-verify-link'

export type Verification = NonNullable<Awaited<ReturnType<typeof prisma.sheetVerification.findFirst>>>
export type Channel = 'whatsapp' | 'sms' | 'email'

export function setupOf(v: Verification): VerifySetup {
  return cleanSetup(v as unknown as Record<string, unknown>)
}

export function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '')
}

export function linkFor(v: Pick<Verification, 'id' | 'key_version'>, ref: string): string {
  return `${appOrigin()}/v/${signLink({ v: v.id, r: ref, k: v.key_version })}`
}

/** Still taking answers: switched on and before its deadline. */
export function isOpen(v: Pick<Verification, 'status' | 'deadline'>, now = new Date()): boolean {
  return v.status === 'active' && (!v.deadline || v.deadline.getTime() > now.getTime())
}

export async function businessName(accountId: string): Promise<string> {
  const [company, account] = await Promise.all([
    prisma.companyProfile.findUnique({ where: { account_id: accountId }, select: { display_name: true, legal_name: true } }).catch(() => null),
    prisma.account.findUnique({ where: { id: accountId }, select: { name: true } }).catch(() => null),
  ])
  return company?.display_name?.trim() || company?.legal_name?.trim() || account?.name?.trim() || ''
}

/** A date in the business's own zone, for messages and the sheet. */
export async function businessDate(accountId: string, d: Date | null, withTime = false): Promise<string> {
  if (!d) return ''
  const timeZone = await businessTimezone(accountId)
  return new Intl.DateTimeFormat('en-IN', { timeZone, day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(d)
}

export interface Sheet {
  token: string
  headers: string[]
  /** Data rows; `rows[i]` is sheet row `i + 2`. */
  rows: string[][]
  /** More rows than MAX_ROWS: the rest are not read. */
  tooMany?: boolean
}

/** A short memory of each list's sheet: a bulk send makes hundreds of
 *  people open their links at once, and Google allows a Google account
 *  only so many reads a minute. Every write checks the row afresh first
 *  (confirmRowRef), so a slightly old read can never send an edit astray. */
const sheetCache = new Map<string, { at: number; sheet: Sheet }>()
const SHEET_CACHE_MS = 15_000

export async function readSheet(v: Verification, opts: { fresh?: boolean } = {}): Promise<Sheet> {
  const key = `${v.id}:${v.spreadsheet_id}:${v.tab_title}`
  const hit = sheetCache.get(key)
  if (!opts.fresh && hit && Date.now() - hit.at < SHEET_CACHE_MS) return hit.sheet
  const token = await googleAccessToken(v.account_id)
  const all = await readTab(token, v.spreadsheet_id, v.tab_title)
  const headers = (all[0] ?? []).map((h) => String(h ?? ''))
  const sheet = { token, headers, rows: all.slice(1, MAX_ROWS + 1), tooMany: all.length - 1 > MAX_ROWS }
  sheetCache.set(key, { at: Date.now(), sheet })
  if (sheetCache.size > 200) sheetCache.delete(sheetCache.keys().next().value as string)
  return sheet
}

export function forgetSheet(v: Pick<Verification, 'id' | 'spreadsheet_id' | 'tab_title'>): void {
  sheetCache.delete(`${v.id}:${v.spreadsheet_id}:${v.tab_title}`)
}

/** Dropdown lists change rarely; a person's page and their answer a
 *  minute later share one read. */
const dropdownCache = new Map<string, { at: number; value: RowDropdowns }>()
const DROPDOWN_CACHE_MS = 60_000

/**
 * The sheet's own dropdown lists on a person's row, for the columns they
 * may correct. Only read when the list has editable columns; a failure
 * means plain text boxes, never a broken page.
 */
export async function rowDropdowns(v: Verification, sheet: Sheet, rowNumber: number, opts: { fresh?: boolean } = {}): Promise<RowDropdowns> {
  const setup = setupOf(v)
  const editCols = setup.edit_columns.map((h) => columnOf(sheet.headers, h)).filter((i) => i >= 0)
  if (!editCols.length) return new Map()
  const key = `${v.id}:${v.tab_title}:${rowNumber}`
  const hit = dropdownCache.get(key)
  if (!opts.fresh && hit && Date.now() - hit.at < DROPDOWN_CACHE_MS) return hit.value
  try {
    const all = await readRowDropdowns(sheet.token, v.spreadsheet_id, v.tab_title, rowNumber, Math.max(...editCols) + 1)
    const value: RowDropdowns = new Map([...all].filter(([col]) => editCols.includes(col)))
    dropdownCache.set(key, { at: Date.now(), value })
    if (dropdownCache.size > 2000) dropdownCache.delete(dropdownCache.keys().next().value as string)
    return value
  } catch (err) {
    console.error('[sheet-verify] dropdowns not read:', err instanceof Error ? err.message : err)
    // Plain boxes then (or the last list read). Only while Google cannot be
    // read is a strict dropdown left to the sheet's own rule.
    return hit?.value ?? new Map()
  }
}

export type Found = { kind: 'one'; row: string[]; rowNumber: number } | { kind: 'none' } | { kind: 'many' }

/**
 * The one row in this list with this reference. A copied row brings its
 * reference along, so a reference on two rows opens neither — the link
 * could belong to either person. Rows outside the list's filter never count.
 */
export function findRow(sheet: Sheet, ref: string, setup: VerifySetup): Found {
  const col = columnOf(sheet.headers, REF_HEADER)
  if (col < 0 || !ref) return { kind: 'none' }
  const hits: number[] = []
  sheet.rows.forEach((r, i) => {
    if (String(r[col] ?? '').trim() === ref && inScope(setup, sheet.headers, r)) hits.push(i)
  })
  if (hits.length > 1) return { kind: 'many' }
  if (!hits.length) return { kind: 'none' }
  return { kind: 'one', row: sheet.rows[hits[0]], rowNumber: hits[0] + 2 }
}

/** Rows may be sorted, inserted or deleted while a person has the page
 *  open: their row is read again right before anything is written. */
export class RowMovedError extends Error {
  constructor() {
    super('The list was changed just now. Reload the page and try again.')
  }
}

async function confirmRowRef(v: Verification, sheet: Sheet, rowNumber: number, ref: string): Promise<void> {
  const col = columnOf(sheet.headers, REF_HEADER)
  if (col < 0) throw new RowMovedError()
  const cell = await readRange(sheet.token, v.spreadsheet_id, `${tabRange(v.tab_title)}!${columnLetter(col)}${rowNumber}`)
  if (String(cell[0]?.[0] ?? '').trim() !== ref) {
    forgetSheet(v)
    throw new RowMovedError()
  }
}

/** References on more than one row of the list (rows copied with theirs). */
export function duplicateRefs(sheet: Sheet, setup: VerifySetup): Set<string> {
  const col = columnOf(sheet.headers, REF_HEADER)
  const seen = new Set<string>()
  const twice = new Set<string>()
  if (col < 0) return twice
  for (const r of sheet.rows) {
    if (!inScope(setup, sheet.headers, r)) continue
    const ref = String(r[col] ?? '').trim()
    if (!ref) continue
    if (seen.has(ref)) twice.add(ref)
    seen.add(ref)
  }
  return twice
}

/**
 * Gets the sheet ready: adds the "Verify ref" and "Verify status" columns
 * when missing, and a reference to every row in scope that has none. A
 * reference found on several rows (copied rows) is replaced on all of
 * them — nobody can tell which person the link already sent belongs to;
 * they get new links. Running it again changes nothing else.
 */
export async function prepareSheet(v: Verification): Promise<{ added: number; total: number; replaced: number }> {
  const setup = setupOf(v)
  const sheet = await readSheet(v, { fresh: true })
  if (sheet.tooMany) throw new Error(`The list has more than ${MAX_ROWS} rows. Use “Only rows where” to check it in parts.`)
  const headers = [...sheet.headers]
  for (const h of [REF_HEADER, STATUS_HEADER]) if (columnOf(headers, h) < 0) headers.push(h)
  if (headers.length !== sheet.headers.length) await writeHeaderRow(sheet.token, v.spreadsheet_id, v.tab_title, headers)
  const refCol = columnOf(headers, REF_HEADER)
  const twice = duplicateRefs({ ...sheet, headers }, setup)
  const cells: Array<{ row: number; col: number; value: string }> = []
  let total = 0
  let replaced = 0
  sheet.rows.forEach((r, i) => {
    if (!inScope(setup, headers, r)) return
    total++
    const have = String(r[refCol] ?? '').trim()
    if (have && !twice.has(have)) return
    if (have) replaced++
    cells.push({ row: i + 2, col: refCol, value: makeRef() })
  })
  if (cells.length) await writeCells(sheet.token, v.spreadsheet_id, v.tab_title, cells)
  forgetSheet(v)
  return { added: cells.length - replaced, total, replaced }
}
export interface PersonRow {
  ref: string
  rowNumber: number
  name: string
  phone: string | null
  email: string | null
  state: string
  wa: { status: string | null; error: string | null }
  sms: { status: string | null; error: string | null }
  email_send: { status: string | null; error: string | null }
  cannot: string | null
  duplicate: boolean
  last_sent_at: string | null
  send_count: number
  sheet_status: string
}

/** Every person in scope, from the sheet with their progress beside it.
 *  Numbers and emails are masked: the screen only needs to recognise them. */
export async function listPeople(v: Verification, opts: { fresh?: boolean } = {}): Promise<{ people: PersonRow[]; missingRefs: number; sharedRefs: number; tooMany: boolean; headers: string[] }> {
  const setup = setupOf(v)
  const sheet = await readSheet(v, opts)
  const twice = duplicateRefs(sheet, setup)
  const dial = await businessDial(v.account_id)
  const refCol = columnOf(sheet.headers, REF_HEADER)
  const statusCol = columnOf(sheet.headers, STATUS_HEADER)
  const nameCol = columnOf(sheet.headers, setup.name_column)
  const phoneCol = columnOf(sheet.headers, setup.phone_column)
  const emailCol = columnOf(sheet.headers, setup.email_column)
  const progress = await prisma.sheetVerificationPerson.findMany({ where: { verification_id: v.id, account_id: v.account_id } })
  const byRef = new Map(progress.map((p) => [p.ref, p]))
  const phones = new Map<string, number>()
  let missingRefs = 0
  const raw = sheet.rows.flatMap((r, i) => {
    if (!inScope(setup, sheet.headers, r)) return []
    const ref = refCol >= 0 ? String(r[refCol] ?? '').trim() : ''
    if (!ref) { missingRefs++; return [] }
    const phone = phoneCol >= 0 ? whatsappNumber(r[phoneCol], dial) : null
    if (phone) phones.set(phone, (phones.get(phone) ?? 0) + 1)
    return [{ r, i, ref, phone }]
  })
  const people = raw.map(({ r, i, ref, phone }) => {
    const p = byRef.get(ref)
    const email = emailCol >= 0 ? String(r[emailCol] ?? '').trim() || null : null
    return {
      ref,
      rowNumber: i + 2,
      name: nameCol >= 0 ? String(r[nameCol] ?? '').trim() : '',
      phone: phone ? maskValue(phone) : null,
      email: email ? maskValue(email) : null,
      state: p?.state ?? 'pending',
      wa: { status: p?.wa_status ?? null, error: p?.wa_error ?? null },
      sms: { status: p?.sms_status ?? null, error: p?.sms_error ?? null },
      email_send: { status: p?.email_status ?? null, error: p?.email_error ?? null },
      cannot: twice.has(ref) ? 'Same reference as another row (a copied row) — press “Get the sheet ready”' : phone ? null : 'No valid phone number',
      duplicate: !!phone && (phones.get(phone) ?? 0) > 1,
      last_sent_at: p?.last_sent_at?.toISOString() ?? null,
      send_count: p?.send_count ?? 0,
      sheet_status: statusCol >= 0 ? String(r[statusCol] ?? '').trim() : '',
    }
  })
  return { people, missingRefs, sharedRefs: twice.size, tooMany: !!sheet.tooMany, headers: sheet.headers }
}

// ── Sending ───────────────────────────────────────────────────────────

/** WhatsApp is ready to send this list's links: the number, and an
 *  approved template. Checked before a send is claimed, so the admin hears
 *  why at once instead of seeing nothing happen. */
export async function whatsAppSender(v: Verification) {
  const config = await resolveWhatsAppConfig({ accountId: v.account_id })
  const template = v.template_name
    ? await prisma.messageTemplate.findFirst({ where: { account_id: v.account_id, name: v.template_name, status: 'APPROVED' } })
    : null
  if (!template || !isMessageTemplate(template)) {
    throw new Error('The chosen WhatsApp template is not approved on this account. Choose an approved one in Settings.')
  }
  const buttons = Array.isArray(template.buttons) ? (template.buttons as Array<{ type?: string; url?: string }>) : []
  const urlButton = buttons.findIndex((b) => String(b?.type ?? '').toUpperCase() === 'URL' && /\{\{\s*1\s*\}\}/.test(String(b?.url ?? '')))
  return { phoneNumberId: config.phone_number_id, accessToken: decrypt(config.access_token), template, urlButton: urlButton >= 0 ? urlButton : null }
}

/** Not yet confirmed or corrected — the ones a send or reminder is for. */
export function needsAnswer(state: string | undefined): boolean {
  return !state || state === 'pending' || state === 'opened'
}

/**
 * Sends the private links on one channel, one person at a time. Claims the
 * verification first (a second press while it runs is refused), and frees
 * it at the end whatever happened. Each person's outcome is recorded; a
 * failure is a sentence the admin can act on, never thrown.
 */
export async function runSend(v: Verification, channel: Channel, refs: string[], claimedUntil: Date): Promise<void> {
  const setup = setupOf(v)
  // This run's own claim: renewed and freed only while it is still this
  // run's, so a run that went long never frees a newer one's.
  let lock = claimedUntil
  try {
    const sheet = await readSheet(v, { fresh: true })
    const twice = duplicateRefs(sheet, setup)
    const dial = await businessDial(v.account_id)
    const business = await businessName(v.account_id)
    const deadline = await businessDate(v.account_id, v.deadline)
    const nameCol = columnOf(sheet.headers, setup.name_column)
    const phoneCol = columnOf(sheet.headers, setup.phone_column)
    const emailCol = columnOf(sheet.headers, setup.email_column)
    const wanted = new Set(refs)

    const wa = channel === 'whatsapp' ? await whatsAppSender(v) : null

    const sentTo = new Set<string>()
    let n = 0
    for (const r of sheet.rows) {
      const refCol = columnOf(sheet.headers, REF_HEADER)
      const ref = refCol >= 0 ? String(r[refCol] ?? '').trim() : ''
      if (!ref || !wanted.has(ref) || twice.has(ref) || !inScope(setup, sheet.headers, r)) continue
      // Every so often: keep the send's claim, and stop if the business
      // closed the list or cancelled its links meanwhile — those links would not work.
      if (n++ % 20 === 0) {
        const now = await prisma.sheetVerification.findUnique({ where: { id: v.id }, select: { key_version: true, status: true, deadline: true } })
        if (!now || now.key_version !== v.key_version || !isOpen(now)) {
          throw new Error('Stopped: the list was closed, passed its deadline, or its links were cancelled while sending.')
        }
        const next = new Date(Date.now() + 10 * 60_000)
        const renewed = await prisma.sheetVerification.updateMany({ where: { id: v.id, sending_until: lock }, data: { sending_until: next } })
        if (!renewed.count) {
          lock = new Date(0)
          throw new Error('Stopped: another send started for this list.')
        }
        lock = next
      }
      const link = linkFor(v, ref)
      const values: MessageValues = { name: nameCol >= 0 ? String(r[nameCol] ?? '').trim() : '', link, deadline, business, ref }
      const address = channel === 'email'
        ? (emailCol >= 0 ? String(r[emailCol] ?? '').trim() : '') || null
        : phoneCol >= 0 ? whatsappNumber(r[phoneCol], dial) : null
      let status = 'sent'
      let error: string | null = cannotSend(channel, address)
      let messageId: string | null = null
      // The same number twice in one run gets one message (two people sharing a phone).
      if (!error && address && sentTo.has(`${channel}:${address}`)) error = 'Same number as another person — sent once'
      if (!error && address) {
        try {
          if (channel === 'whatsapp' && wa) {
            const body = templateValues(Array.isArray(v.template_params) ? v.template_params : [], values, sheet.headers, r).map((x) => templateSafe(x, 500))
            const res = await sendTemplateMessage({
              phoneNumberId: wa.phoneNumberId,
              accessToken: wa.accessToken,
              to: address,
              templateName: wa.template.name,
              language: wa.template.language ?? 'en_US',
              template: wa.template,
              messageParams: { body, ...(wa.urlButton !== null ? { buttonParams: { [wa.urlButton]: link.split('/v/')[1] } } : {}) },
              accountId: v.account_id,
            })
            messageId = res.messageId
          } else if (channel === 'sms') {
            if (!v.sms_text?.trim()) throw new Error('Write the SMS text first.')
            await sendSmsText({ accountId: v.account_id, to: address, text: fillText(v.sms_text, values) })
          } else if (channel === 'email') {
            if (!v.email_text?.trim()) throw new Error('Write the email first.')
            await sendEmail({ accountId: v.account_id, to: address, subject: fillText(v.email_subject || 'Please check your details', values), text: fillText(v.email_text, values) })
          }
          sentTo.add(`${channel}:${address}`)
        } catch (err) {
          error = (err instanceof Error ? err.message : String(err)).slice(0, 300)
          console.error(`[sheet-verify] ${channel} to …${address.slice(-4)} failed:`, error)
        }
      }
      if (error) status = 'failed'
      const fields =
        channel === 'whatsapp' ? { wa_status: status, wa_error: error, wa_message_id: messageId }
        : channel === 'sms' ? { sms_status: status, sms_error: error }
        : { email_status: status, email_error: error }
      await prisma.sheetVerificationPerson.upsert({
        where: { verification_id_ref: { verification_id: v.id, ref } },
        create: { verification_id: v.id, account_id: v.account_id, ref, ...fields, last_sent_at: status === 'sent' ? new Date() : null, send_count: status === 'sent' ? 1 : 0 },
        update: { ...fields, ...(status === 'sent' ? { last_sent_at: new Date(), send_count: { increment: 1 } } : {}) },
      })
      // Meta and SMS gateways rate-limit per number; a short gap costs nothing.
      await new Promise((res) => setTimeout(res, 150))
    }
  } catch (err) {
    // Said on the screen, not only in the log: the admin pressed Send and is waiting.
    const why = (err instanceof Error ? err.message : String(err)).slice(0, 300)
    console.error('[sheet-verify] send stopped:', why)
    await prisma.sheetVerification.updateMany({ where: { id: v.id }, data: { last_send_error: why } }).catch(() => {})
  } finally {
    await prisma.sheetVerification.updateMany({ where: { id: v.id, sending_until: lock }, data: { sending_until: null } }).catch(() => {})
  }
}

// ── Answers ───────────────────────────────────────────────────────────

/**
 * Writes a confirmation or corrections to the person's row: the changed
 * cells, the "Verify status" cell, and one line per change in the
 * "Verification log" tab. RAW, so nothing typed becomes a formula.
 */
export async function recordAnswer(args: {
  v: Verification
  sheet: Sheet
  rowNumber: number
  ref: string
  changes: Change[]
  by: string
  state: 'verified' | 'corrected' | 'phone'
  userId?: string | null
}): Promise<void> {
  const { v, sheet } = args
  await confirmRowRef(v, sheet, args.rowNumber, args.ref)
  const statusCol = columnOf(sheet.headers, STATUS_HEADER)
  const when = await businessDate(v.account_id, new Date(), true)
  const word = args.state === 'corrected' ? 'Corrected' : args.state === 'phone' ? 'Verified by phone' : 'Verified'
  const cells = args.changes.map((c) => ({ row: args.rowNumber, col: c.col, value: c.after }))
  if (statusCol >= 0) cells.push({ row: args.rowNumber, col: statusCol, value: `${word} · ${when}` })
  if (cells.length) await writeCells(sheet.token, v.spreadsheet_id, v.tab_title, cells)
  forgetSheet(v)
  if (args.changes.length) {
    await ensureTab(sheet.token, v.spreadsheet_id, LOG_TAB, LOG_HEADERS)
    await appendRows(sheet.token, v.spreadsheet_id, LOG_TAB, args.changes.map((c) => [when, args.ref, c.header, c.before, c.after, args.by]))
  }
  await prisma.sheetVerificationPerson.upsert({
    where: { verification_id_ref: { verification_id: v.id, ref: args.ref } },
    create: { verification_id: v.id, account_id: v.account_id, ref: args.ref, state: args.state, done_at: new Date(), done_by: args.userId ?? null },
    update: { state: args.state, done_at: new Date(), done_by: args.userId ?? null },
  })
}

/** The first time a person opens their link. */
export async function markOpened(v: Verification, ref: string): Promise<void> {
  await prisma.sheetVerificationPerson.upsert({
    where: { verification_id_ref: { verification_id: v.id, ref } },
    create: { verification_id: v.id, account_id: v.account_id, ref, state: 'opened', opened_at: new Date() },
    update: {},
  })
  await prisma.sheetVerificationPerson.updateMany({
    where: { verification_id: v.id, ref, state: 'pending' },
    data: { state: 'opened', opened_at: new Date() },
  })
}
