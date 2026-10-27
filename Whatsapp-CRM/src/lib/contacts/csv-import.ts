/**
 * Reading a contacts CSV for import — pure, so the browser can show a
 * preview of exactly what the server will do with each row.
 *
 * Handles what real files contain: Excel's byte-order mark before the
 * first header, quoted cells with commas and "" inside, headers written
 * as "Mobile", "WhatsApp No" or "Full Name", blank lines.
 */
import { checkEmail, checkPhone } from './validate'

export interface ImportRow {
  phone: string
  name?: string
  email?: string
  company?: string
}

export type RowStatus = 'ready' | 'duplicate' | 'bad_phone'

export interface CheckedRow extends ImportRow {
  /** Line number in the file (the header is line 1). */
  line: number
  status: RowStatus
  /** Why the row is left out, or what was dropped from it. */
  note?: string
}

export const MAX_IMPORT_ROWS = 10_000
const MAX_TEXT = 200

const HEADERS: Record<keyof ImportRow, string[]> = {
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'mobile no', 'whatsapp', 'whatsapp number', 'whatsapp no', 'contact number', 'contact no', 'number'],
  name: ['name', 'full name', 'contact name', 'customer name'],
  email: ['email', 'email address', 'e-mail', 'email id', 'mail'],
  company: ['company', 'company name', 'organisation', 'organization', 'business', 'business name'],
}

/** The template offered for download: the columns the import reads. */
export const CONTACTS_TEMPLATE_CSV =
  'phone,name,email,company\r\n' +
  '+91 98765 43210,Anu Thomas,anu@example.com,Example Traders\r\n' +
  '+91 94470 12345,Biju Kumar,,\r\n'

/** One CSV line into cells: quotes, "" escapes, commas inside quotes. */
function cells(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { out.push(cur.trim()); cur = '' }
    else cur += ch
  }
  out.push(cur.trim())
  return out
}

const norm = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[_.]+/g, ' ').replace(/\s+/g, ' ')

/** Same person: compared on the last ten digits (country code optional). */
function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, '')
  return d.length > 10 ? d.slice(-10) : d
}

export function parseContactsCsv(text: string): { rows: CheckedRow[]; missingPhoneColumn: boolean; tooMany: boolean } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const header = cells(lines[0] ?? '').map(norm)
  const col = (k: keyof ImportRow) => header.findIndex((h) => HEADERS[k].includes(h))
  const idx = { phone: col('phone'), name: col('name'), email: col('email'), company: col('company') }
  if (idx.phone === -1) return { rows: [], missingPhoneColumn: true, tooMany: false }

  const rows: CheckedRow[] = []
  const seen = new Set<string>()
  let tooMany = false
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    if (rows.length >= MAX_IMPORT_ROWS) { tooMany = true; break }
    const v = cells(lines[i])
    const get = (k: keyof ImportRow) => (idx[k] >= 0 ? (v[idx[k]] ?? '').trim().slice(0, MAX_TEXT) : '')
    const rawPhone = get('phone')
    const name = get('name') || undefined
    const company = get('company') || undefined
    let email: string | undefined
    let note: string | undefined
    const rawEmail = get('email')
    if (rawEmail) {
      const e = checkEmail(rawEmail)
      if (e.ok) email = e.value
      else note = `Email “${rawEmail}” is not valid — imported without it.`
    }
    const p = checkPhone(rawPhone)
    if (!p.ok) {
      rows.push({ line: i + 1, phone: rawPhone, name, email, company, status: 'bad_phone', note: rawPhone ? p.error : 'No phone number.' })
      continue
    }
    const key = phoneKey(p.value)
    if (seen.has(key)) {
      rows.push({ line: i + 1, phone: p.value, name, email, company, status: 'duplicate', note: 'Same number as an earlier row.' })
      continue
    }
    seen.add(key)
    rows.push({ line: i + 1, phone: p.value, name, email, company, status: 'ready', note })
  }
  return { rows, missingPhoneColumn: false, tooMany }
}

/** The fields the server accepts for one row, checked again there. */
export function cleanImportRow(raw: unknown): ImportRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (x: unknown) => (typeof x === 'string' ? x.trim().slice(0, MAX_TEXT) : '')
  const p = checkPhone(str(r.phone))
  if (!p.ok) return null
  const e = str(r.email) ? checkEmail(str(r.email)) : null
  return {
    phone: p.value,
    name: str(r.name) || undefined,
    email: e && e.ok ? e.value : undefined,
    company: str(r.company) || undefined,
  }
}
