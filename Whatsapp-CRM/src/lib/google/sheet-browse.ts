/**
 * Every spreadsheet in the connected Google account, for the Data Store's
 * import screen — and, for one of them, its tabs and a preview.
 *
 * Needs the "Google Sheets — browse all" service (drive.metadata.readonly
 * to list file names, spreadsheets.readonly to read them). Read-only on
 * purpose: importing never needs to change the sheet.
 *
 * Column types are guessed from the header and the values (guessFieldType),
 * so a sheet can go into a table that has no fields yet — the import
 * screen shows each guess and lets it be changed.
 */

import { googleAccessToken, isGoogleServiceEnabled } from './oauth'
import { SheetsApiError } from './sheets'
import { readDropdowns } from './sheet-dropdowns'
import { disabledApi, isApiDisabled, type DisabledApi } from './api-disabled'

const DRIVE = 'https://www.googleapis.com/drive/v3/files'

/** A Google API this needs is switched off in the Cloud project — kept
 *  structured, so the import screen can show the Enable button. */
export class ApiDisabledError extends SheetsApiError {
  constructor(readonly disabled: DisabledApi) {
    super(`The ${disabled.api} is switched off in your Google Cloud project.`, 400)
    this.name = 'ApiDisabledError'
  }
}
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'

export interface SheetFile {
  id: string
  name: string
  modified_at: string | null
  owner: string | null
  owned_by_me: boolean
}

async function get<T>(token: string, url: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  } catch (err) {
    throw new SheetsApiError(`Could not reach Google: ${err instanceof Error ? err.message : String(err)}`, 502)
  }
  if (res.ok) return (await res.json()) as T
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  const msg = body.error?.message ?? `Google returned ${res.status}`
  if (isApiDisabled(msg)) {
    throw new ApiDisabledError(disabledApi(msg, url.includes('drive') ? 'Google Drive API' : 'Google Sheets API'))
  }
  if (res.status === 403 || res.status === 404) throw new SheetsApiError('That sheet could not be opened — it may have been deleted or unshared.', 404)
  if (res.status === 429) throw new SheetsApiError('Google is busy (rate limit). Try again in a minute.', 429)
  throw new SheetsApiError(msg, res.status >= 400 && res.status < 500 ? res.status : 502)
}

export async function canBrowseSheets(accountId: string): Promise<boolean> {
  return isGoogleServiceEnabled(accountId, 'sheets_browse').catch(() => false)
}

/** Newest first; a search matches the file name. */
export async function listSpreadsheets(
  accountId: string,
  opts: { search?: string; pageToken?: string } = {},
): Promise<{ files: SheetFile[]; next: string | null }> {
  const token = await googleAccessToken(accountId)
  const term = (opts.search ?? '').trim().slice(0, 100).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const q = [`mimeType='application/vnd.google-apps.spreadsheet'`, 'trashed=false', ...(term ? [`name contains '${term}'`] : [])].join(' and ')
  const params = new URLSearchParams({
    q,
    pageSize: '50',
    orderBy: term ? 'name' : 'modifiedTime desc',
    fields: 'nextPageToken,files(id,name,modifiedTime,ownedByMe,owners(displayName))',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    corpora: 'allDrives',
  })
  if (opts.pageToken) params.set('pageToken', opts.pageToken)
  const data = await get<{ nextPageToken?: string; files?: Array<{ id: string; name: string; modifiedTime?: string; ownedByMe?: boolean; owners?: Array<{ displayName?: string }> }> }>(
    token,
    `${DRIVE}?${params}`,
  )
  return {
    files: (data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      modified_at: f.modifiedTime ?? null,
      owner: f.ownedByMe ? 'me' : (f.owners?.[0]?.displayName ?? null),
      owned_by_me: Boolean(f.ownedByMe),
    })),
    next: data.nextPageToken ?? null,
  }
}

export interface TabInfo {
  title: string
  rows: number
  columns: number
}

export interface SheetPreview {
  id: string
  title: string
  tabs: TabInfo[]
  tab: string
  headers: string[]
  sample: string[][]
  /** Data rows (not counting the header) that have anything in them. */
  total_rows: number
  /** Column index → the sheet's own dropdown choices for that column. */
  dropdowns: Record<number, string[]>
}

/** The spreadsheet's tabs, and the chosen tab's header and first rows. */
export async function previewSpreadsheet(accountId: string, spreadsheetId: string, tab?: string | null): Promise<SheetPreview> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(spreadsheetId)) throw new SheetsApiError('That is not a Google Sheet.', 400)
  const token = await googleAccessToken(accountId)
  const meta = await get<{ properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }> }>(
    token,
    `${SHEETS}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(title,gridProperties)`,
  )
  const tabs: TabInfo[] = (meta.sheets ?? [])
    .map((s) => ({
      title: s.properties?.title ?? '',
      rows: s.properties?.gridProperties?.rowCount ?? 0,
      columns: s.properties?.gridProperties?.columnCount ?? 0,
    }))
    .filter((t) => t.title)
  const chosen = (tab && tabs.find((t) => t.title === tab)) || tabs[0]
  if (!chosen) throw new SheetsApiError('That spreadsheet has no tabs.', 400)

  const range = `'${chosen.title.replace(/'/g, "''")}'`
  const values = await get<{ values?: unknown[][] }>(
    token,
    `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
  )
  const rows = (values.values ?? []).map((r) => r.map((v) => (v == null ? '' : String(v)))).filter((r) => r.some((c) => c.trim() !== ''))
  // The tab's dropdown columns, so the import screen suggests them as dropdowns.
  const dropdowns = Object.fromEntries(await readDropdowns(token, spreadsheetId, chosen.title))
  const [head = [], ...body] = rows
  const width = Math.max(head.length, ...body.slice(0, 50).map((r) => r.length), 0)
  const headers = Array.from({ length: width }, (_, i) => head[i]?.trim() || `Column ${i + 1}`)
  return {
    id: spreadsheetId,
    title: meta.properties?.title ?? 'Spreadsheet',
    tabs,
    tab: chosen.title,
    headers,
    sample: body.slice(0, 50).map((r) => headers.map((_, i) => r[i] ?? '')),
    total_rows: body.length,
    dropdowns,
  }
}

// ── Guessing a column's type ───────────────────────────────────────────

export type GuessedType = 'text' | 'textarea' | 'number' | 'email' | 'phone' | 'date' | 'url' | 'select'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^\+?[\d\s()-]{7,18}$/
const NUMBER = /^-?[\d,]*\.?\d+$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const URL_RE = /^https?:\/\/\S+$/i

/** A field type for a column, from its header and up to 50 values. */
export function guessFieldType(header: string, values: readonly string[]): { type: GuessedType; options: string[] } {
  const h = header.toLowerCase()
  const vals = values.map((v) => v.trim()).filter(Boolean)
  const all = (re: RegExp) => vals.length > 0 && vals.every((v) => re.test(v))
  const digits = (v: string) => v.replace(/\D/g, '').length

  if (/e-?mail/.test(h) || all(EMAIL)) return { type: 'email', options: [] }
  if (/phone|mobile|whats ?app|contact no|cell/.test(h) || (all(PHONE) && vals.every((v) => digits(v) >= 7 && digits(v) <= 15) && vals.some((v) => digits(v) >= 10))) {
    return { type: 'phone', options: [] }
  }
  if (all(URL_RE) || /website|url|link/.test(h)) return { type: 'url', options: [] }
  if (all(ISO_DATE)) return { type: 'date', options: [] }
  // Ids and pin codes look like numbers but are not amounts.
  if (all(NUMBER) && !/\b(id|code|pin|zip|no|number)\b/.test(h)) return { type: 'number', options: [] }
  if (vals.length > 0 && vals.reduce((n, v) => n + v.length, 0) / vals.length > 80) return { type: 'textarea', options: [] }
  const distinct = [...new Set(vals)]
  if (vals.length >= 8 && distinct.length >= 2 && distinct.length <= 8 && distinct.length <= vals.length / 2 && distinct.every((d) => d.length <= 40)) {
    return { type: 'select', options: distinct.sort() }
  }
  return { type: 'text', options: [] }
}
