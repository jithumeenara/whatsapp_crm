/**
 * "What did I register for?" — answered from every place a registration
 * can be, not only the rows a chat saved.
 *
 * A business takes registrations, bookings and orders through many doors:
 * WhatsApp, its website, a phone call typed in by staff, a Google Sheet the
 * office keeps. Only the WhatsApp ones carry the chat's contact, so a
 * customer who booked by phone was told they had nothing. This finds the
 * customer's rows by THEIR OWN WhatsApp number (last ten digits), in:
 *   1. the registration tables (rows with no chat, or another chat), and
 *   2. the Google Sheets those tables are routed to (Sheet routing) — rows
 *      typed straight into the sheet. Rows the CRM itself put there carry
 *      a "CRM ID" and are skipped: they are already found in step 1.
 *
 * Nothing here is particular to one business: no column is named. A row
 * belongs to the customer when one of its cells is a phone number equal to
 * theirs. Every row is checked again in code after the database query, so
 * a looser query can never hand over someone else's row. Read-only, and
 * identity-document / bank / password columns are never returned.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { isPlaceholderPhone } from '@/lib/contacts/validate'

const MAX_ROWS = 5
const MAX_SHEETS = 5
const MAX_TABS = 8
const CACHE_MS = 60_000

/** Last ten digits of a value that is plainly a phone number, else null. */
export function phoneOf(v: unknown): string | null {
  if (v === null || v === undefined || typeof v === 'object') return null
  const s = String(v).trim()
  if (!/^[+0-9 ()-]{10,20}$/.test(s)) return null
  const d = s.replace(/\D/g, '')
  // Ten digits, or with a country code — never a longer run such as a date range.
  return d.length >= 10 && d.length <= 13 ? d.slice(-10) : null
}

/** True when one of the row's values is this phone number. */
export function rowHasPhone(values: Record<string, unknown> | readonly unknown[], key: string): boolean {
  const list = Array.isArray(values) ? values : Object.values(values)
  return list.some((v) => phoneOf(v) === key)
}

/** Identity-document, bank and secret columns — never sent to a chat. */
const SENSITIVE = /aadh?aar|\bpan\b|pan\s*(no|number|card)|passport|voter|licen[cs]e\s*no|password|passcode|\bpin\b|otp|cvv|card\s*(no|number)|account\s*(no|number)|a\/c|ifsc|\bssn\b|social\s*security|bank/i

export function redactSensitive(details: Record<string, unknown>, labelOf: (key: string) => string = (k) => k): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE.test(k) || SENSITIVE.test(labelOf(k))) continue
    out[k] = v
  }
  return out
}

export interface FoundRegistration {
  registration_id: string
  form: string
  where: string
  registered_on: Date | null
  details: Record<string, unknown>
  /** Only rows this chat saved may be changed in chat. */
  can_change_in_chat: boolean
}

const cache = new Map<string, { at: number; rows: FoundRegistration[] }>()
const CACHE_MAX = 1000
export function clearRegistrationLookupCache(): void {
  cache.clear()
}

/** The customer's own phone key, or null (web chat, email, Instagram…). */
export async function contactPhoneKey(accountId: string, contactId: string): Promise<string | null> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, account_id: accountId }, select: { phone: true } })
  if (!c?.phone || isPlaceholderPhone(c.phone)) return null
  const d = c.phone.replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

/** Rows in these tables that carry this number — not saved by this chat
 *  when a contactId is given (the admin assistant gives none). */
export async function findTableRowsByPhone(args: {
  accountId: string
  contactId?: string | null
  key: string
  limit?: number
  tables: ReadonlyArray<{ table_id: string; name: string; labels: Map<string, string> }>
}): Promise<FoundRegistration[]> {
  if (args.tables.length === 0) return []
  const ids = args.tables.map((t) => t.table_id)
  const rows = await prisma.$queryRaw<Array<{ id: string; table_id: string; data: unknown; created_at: Date }>>`
    SELECT id, table_id, data, created_at FROM data_records
    WHERE account_id = ${args.accountId}::uuid
      AND table_id = ANY(${ids}::uuid[])
      ${args.contactId ? Prisma.sql`AND contact_id IS DISTINCT FROM ${args.contactId}::uuid` : Prisma.empty}
      AND EXISTS (
        SELECT 1 FROM jsonb_each_text(data) e
        WHERE btrim(e.value) ~ '^[+0-9 ()-]{10,20}$'
          AND length(regexp_replace(e.value, '\\D', '', 'g')) BETWEEN 10 AND 13
          AND right(regexp_replace(e.value, '\\D', '', 'g'), 10) = ${args.key}
      )
    ORDER BY created_at DESC
    LIMIT ${(args.limit ?? MAX_ROWS) * 2}`
  const out: FoundRegistration[] = []
  for (const r of rows) {
    const data = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>
    // Checked again here: only the customer's own number, whatever the query returned.
    if (!rowHasPhone(data, args.key)) continue
    const t = args.tables.find((x) => x.table_id === r.table_id)
    if (!t) continue
    out.push({
      registration_id: r.id,
      form: t.name,
      where: t.name,
      registered_on: r.created_at,
      details: redactSensitive(data, (k) => t.labels.get(k) ?? k),
      can_change_in_chat: false,
    })
  }
  return out.slice(0, args.limit ?? MAX_ROWS)
}

export interface SheetStats { sheets: number; tabs: number; problem: string | null }

/** Rows in the sheets these tables route to — typed in by the office, or
 *  put there by the CRM for a record the table no longer has. */
export async function findSheetRowsByPhone(
  args: { accountId: string; key: string; tableIds: readonly string[]; knownIds: ReadonlySet<string> },
  stats: SheetStats,
): Promise<FoundRegistration[]> {
  if (args.tableIds.length === 0) return []
  const routes = await prisma.sheetRoute.findMany({
    where: { account_id: args.accountId, table_id: { in: [...args.tableIds] }, enabled: true },
    select: { id: true, spreadsheet_id: true, spreadsheet_name: true },
  }).catch(() => [] as Array<{ id?: string; spreadsheet_id: string; spreadsheet_name: string | null }>)
  if (routes.length === 0) return []
  const targets = await prisma.sheetRouteTarget.findMany({
    where: { route_id: { in: routes.map((r) => r.id).filter((x): x is string => !!x) } },
    select: { spreadsheet_id: true, spreadsheet_name: true },
  }).catch(() => [] as Array<{ spreadsheet_id: string; spreadsheet_name: string | null }>)
  const sheets = new Map<string, string | null>()
  for (const s of [...routes, ...targets]) if (!sheets.has(s.spreadsheet_id)) sheets.set(s.spreadsheet_id, s.spreadsheet_name)

  const { googleAccessToken } = await import('@/lib/google/oauth')
  const { getSpreadsheet, readTab } = await import('@/lib/google/sheets')
  let token: string
  try {
    token = await googleAccessToken(args.accountId)
  } catch (err) {
    stats.problem = `Google not connected: ${err instanceof Error ? err.message : String(err)}`
    return []
  }
  const out: FoundRegistration[] = []
  for (const [id, savedName] of [...sheets.entries()].slice(0, MAX_SHEETS)) {
    try {
      const info = await getSpreadsheet(token, id)
      stats.sheets++
      // Only ordinary tabs: a chart or connected-data tab has no rows.
      const tabs = info.tabs.filter((t) => (!t.sheetType || t.sheetType === 'GRID') && t.title.toLowerCase() !== 'deleted')
      for (const tab of tabs.slice(0, MAX_TABS)) {
        let table: string[][]
        try {
          table = await readTab(token, id, tab.title)
        } catch (err) {
          // One unreadable tab (a dashboard) must not stop the tabs after it.
          stats.problem = `tab “${tab.title}” skipped: ${err instanceof Error ? err.message : String(err)}`
          continue
        }
        stats.tabs++
        // The header row: the first row with three or more names in it.
        const h = table.findIndex((r) => r.filter((c) => String(c ?? '').trim()).length >= 3)
        if (h < 0) continue
        const headers = table[h].map((c) => String(c ?? '').trim())
        const crmCol = headers.findIndex((x) => x.toLowerCase() === 'crm id')
        for (let i = h + 1; i < table.length && out.length < MAX_ROWS; i++) {
          const row = table[i] ?? []
          // A row the CRM put there is skipped only when that record was
          // found already — not when the table no longer has it.
          const crmId = crmCol >= 0 ? String(row[crmCol] ?? '').trim() : ''
          if (crmId && args.knownIds.has(crmId)) continue
          if (!rowHasPhone(row, args.key)) continue
          const details: Record<string, unknown> = {}
          headers.forEach((name, c) => {
            const v = String(row[c] ?? '').trim()
            if (name && v && c !== crmCol) details[name] = v
          })
          out.push({
            registration_id: `sheet:${id}:${tab.title}:${i + 1}`,
            form: savedName || info.title,
            where: `Google Sheet “${savedName || info.title}” › ${tab.title}`,
            registered_on: null,
            details: redactSensitive(details),
            can_change_in_chat: false,
          })
        }
        if (out.length >= MAX_ROWS) return out
      }
    } catch (err) {
      stats.problem = `sheet ${id} unreadable: ${err instanceof Error ? err.message : String(err)}`
      console.warn('[registration-lookup] sheet unreadable:', id, err instanceof Error ? err.message : err)
    }
  }
  return out
}

/**
 * This customer's registrations that no chat saved: by their own number,
 * in the registration tables and the sheets those tables route to.
 * Cached a minute — a customer asks twice, Google is read once.
 */
export async function registrationsByPhone(args: {
  accountId: string
  contactId: string
  tables: ReadonlyArray<{ table_id: string; name: string; labels: Map<string, string> }>
  /** Records already found (saved by this chat) — not counted twice. */
  knownIds?: readonly string[]
}): Promise<FoundRegistration[]> {
  const key = await contactPhoneKey(args.accountId, args.contactId)
  if (!key) {
    console.info('[registration-lookup] no phone number on this contact — only chat-saved rows are checked')
    return []
  }
  const cacheKey = `${args.accountId}:${args.contactId}:${key}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows
  if (hit) cache.delete(cacheKey)
  const a = await findTableRowsByPhone({ ...args, key }).catch((err) => {
    console.error('[registration-lookup] tables failed:', err instanceof Error ? err.message : err)
    return [] as FoundRegistration[]
  })
  const known = new Set([...(args.knownIds ?? []), ...a.map((r) => r.registration_id)])
  const stats: SheetStats = { sheets: 0, tabs: 0, problem: null }
  const b = await findSheetRowsByPhone({ accountId: args.accountId, key, tableIds: args.tables.map((t) => t.table_id), knownIds: known }, stats).catch((err) => {
    stats.problem = err instanceof Error ? err.message : String(err)
    return [] as FoundRegistration[]
  })
  // One line per lookup, so "it said I'm not registered" can be traced.
  console.info(`[registration-lookup] number …${key.slice(-4)}: table rows ${a.length}, sheet rows ${b.length} (sheets read ${stats.sheets}, tabs ${stats.tabs})${stats.problem ? ` — ${stats.problem}` : ''}`)
  const rows = [...a, ...b].slice(0, MAX_ROWS)
  cache.set(cacheKey, { at: Date.now(), rows })
  // Bounded: one entry per customer who asked, kept for the whole life of
  // the process, grew without end. The oldest goes first.
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return rows
}

