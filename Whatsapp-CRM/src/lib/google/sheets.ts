/**
 * Google Sheets API v4, over plain fetch.
 *
 * No googleapis package: it is large, and the VPS build already runs at
 * the edge of its memory. Five calls are all this needs.
 *
 * Values are written RAW, never USER_ENTERED. A Data Store row carries
 * what customers typed; with USER_ENTERED, a name typed as
 * =HYPERLINK("…") or =IMPORTXML(…) would become a live formula in the
 * business's sheet. RAW stores it as the text it is.
 */

const API = 'https://sheets.googleapis.com/v4/spreadsheets'

/** Same ceiling as the public-link reader (google-sheet.ts). */
export const SHEET_MAX_ROWS = 2_000

export class SheetsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'SheetsApiError'
  }
}

async function call<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    throw new SheetsApiError(`Could not reach Google Sheets: ${err instanceof Error ? err.message : String(err)}`, 0)
  }
  if (res.ok) return (await res.json().catch(() => ({}))) as T
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  if (res.status === 403 || res.status === 404) {
    throw new SheetsApiError(
      'The CRM cannot open that sheet. Choose it with "Choose from Google Drive" (Google only lets the CRM open sheets picked there or created by it), or check it was not deleted.',
      res.status,
    )
  }
  if (res.status === 429) throw new SheetsApiError('Google Sheets is busy (rate limit). Try again in a minute.', 429)
  throw new SheetsApiError(body.error?.message || `Google Sheets returned ${res.status}.`, res.status)
}

/** A1 range for a whole tab: the title quoted, quotes doubled. */
export function tabRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`
}

export interface SpreadsheetInfo {
  id: string
  title: string
  /** sheetType: GRID for ordinary rows and columns; OBJECT (a chart) and
   *  DATA_SOURCE (connected data) have no cells to read. */
  tabs: Array<{ sheetId: number; title: string; sheetType?: string }>
}

export async function getSpreadsheet(token: string, spreadsheetId: string): Promise<SpreadsheetInfo> {
  const data = await call<{ properties?: { title?: string }; sheets?: Array<{ properties?: { sheetId?: number; title?: string; sheetType?: string } }> }>(
    token,
    `${API}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(sheetId,title,sheetType)`,
  )
  return {
    id: spreadsheetId,
    title: data.properties?.title ?? 'Spreadsheet',
    tabs: (data.sheets ?? [])
      .map((s) => ({ sheetId: s.properties?.sheetId ?? 0, title: s.properties?.title ?? '', sheetType: s.properties?.sheetType }))
      .filter((t) => t.title),
  }
}

/** Every row of a tab, as text, header row first. */
export async function readTab(token: string, spreadsheetId: string, title: string): Promise<string[][]> {
  const data = await call<{ values?: unknown[][] }>(
    token,
    `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(tabRange(title))}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`,
  )
  return (data.values ?? []).map((row) => row.map((v) => (v == null ? '' : String(v))))
}

/**
 * Rows below the tab's table, always starting in column A.
 *
 * Google's own `values:append` was not used: it guesses "the table" by
 * itself, and below a row that begins with empty cells it starts the next
 * row further right — rows came out as a staircase across the sheet.
 * Here the row is chosen and written to exactly.
 *
 * `atRow`: the 1-based row to start at (the caller has read the tab).
 * Otherwise the row below the last filled one, and not above `fromRow`.
 * Empty cells are skipped, so a template's ready-made rows keep their
 * checkboxes, dropdowns and formulas; rows are added when the grid ends.
 */
export async function appendRows(
  token: string,
  spreadsheetId: string,
  title: string,
  rows: string[][],
  opts: { fromRow?: number; atRow?: number } = {},
): Promise<void> {
  if (rows.length === 0) return
  let start = opts.atRow && opts.atRow > 0 ? Math.floor(opts.atRow) : 0
  if (!start) {
    const filled = (await readTab(token, spreadsheetId, title)).length
    start = Math.max(filled, (opts.fromRow ?? 1) - 1) + 1
  }
  const width = Math.max(1, ...rows.map((r) => r.length))
  const end = start + rows.length - 1
  await ensureGridSize(token, spreadsheetId, title, end, width)
  const range = `${tabRange(title)}!A${start}:${columnLetter(width - 1)}${end}`
  await call(token, `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
    method: 'PUT',
    // null leaves that cell as it is.
    body: JSON.stringify({ values: rows.map((r) => Array.from({ length: width }, (_, i) => (String(r[i] ?? '') === '' ? null : String(r[i])))) }),
  })
}

/** Adds rows or columns to the tab when it is smaller than this. */
async function ensureGridSize(token: string, spreadsheetId: string, title: string, rows: number, columns: number): Promise<void> {
  const data = await call<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }> }>(
    token,
    `${API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title,gridProperties)`,
  )
  const tab = (data.sheets ?? []).find((s) => (s.properties?.title ?? '').toLowerCase() === title.toLowerCase())?.properties
  if (!tab) return
  const sheetId = tab.sheetId ?? 0
  const requests: unknown[] = []
  const haveRows = tab.gridProperties?.rowCount ?? 0
  const haveCols = tab.gridProperties?.columnCount ?? 0
  if (rows > haveRows) requests.push({ appendDimension: { sheetId, dimension: 'ROWS', length: rows - haveRows } })
  if (columns > haveCols) requests.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: columns - haveCols } })
  if (requests.length) await call(token, `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) })
}

/** Replaces a tab's contents: cleared, then written from A1. */
export async function writeTab(token: string, spreadsheetId: string, title: string, rows: string[][]): Promise<void> {
  const range = encodeURIComponent(tabRange(title))
  await call(token, `${API}/${encodeURIComponent(spreadsheetId)}/values/${range}:clear`, { method: 'POST', body: '{}' })
  if (rows.length === 0) return
  await call(token, `${API}/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: rows }),
  })
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** Single cells, RAW, in as few calls as Google allows. `row` is the
 *  sheet's own 1-based row number. */
export async function writeCells(
  token: string,
  spreadsheetId: string,
  title: string,
  cells: ReadonlyArray<{ row: number; col: number; value: string }>,
): Promise<void> {
  for (let i = 0; i < cells.length; i += 500) {
    const chunk = cells.slice(i, i + 500)
    await call(token, `${API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: chunk.map((c) => ({ range: `${tabRange(title)}!${columnLetter(c.col)}${c.row}`, values: [[c.value]] })),
      }),
    })
  }
}

/** Removes whole rows (1-based sheet row numbers), bottom first so the
 *  numbers stay true while deleting. */
export async function deleteRows(token: string, spreadsheetId: string, sheetGid: number, rows: readonly number[]): Promise<void> {
  if (rows.length === 0) return
  const requests = [...new Set(rows)]
    .sort((a, b) => b - a)
    .map((r) => ({ deleteDimension: { range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } }))
  await call(token, `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) })
}

/** A new spreadsheet owned by the connected account. Files the CRM creates
 *  are reachable under drive.file without being picked. */
export async function createSpreadsheet(token: string, title: string, tabTitle: string): Promise<SpreadsheetInfo> {
  const data = await call<{ spreadsheetId?: string; sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }>(
    token,
    API,
    { method: 'POST', body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: tabTitle } }] }) },
  )
  if (!data.spreadsheetId) throw new SheetsApiError('Google did not return the new spreadsheet.', 500)
  return {
    id: data.spreadsheetId,
    title,
    tabs: (data.sheets ?? []).map((s) => ({ sheetId: s.properties?.sheetId ?? 0, title: s.properties?.title ?? tabTitle })),
  }
}

export function spreadsheetUrl(spreadsheetId: string, sheetId?: number): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${sheetId !== undefined ? `#gid=${sheetId}` : ''}`
}

/**
 * The tab's gid, adding the tab when the spreadsheet lacks it (and, when
 * it is new, its header row). Two callers racing to add the same tab is
 * fine: Google refuses the second, which then finds the first's.
 */
export async function ensureTab(
  token: string,
  spreadsheetId: string,
  title: string,
  headers: readonly string[] = [],
): Promise<{ sheetId: number; created: boolean }> {
  const find = async () => (await getSpreadsheet(token, spreadsheetId)).tabs.find((t) => t.title.toLowerCase() === title.toLowerCase())
  const existing = await find()
  if (existing) return { sheetId: existing.sheetId, created: false }
  try {
    const data = await call<{ replies?: Array<{ addSheet?: { properties?: { sheetId?: number } } }> }>(
      token,
      `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) },
    )
    const sheetId = data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0
    if (headers.length) await writeHeaderRow(token, spreadsheetId, title, headers)
    return { sheetId, created: true }
  } catch (err) {
    const again = await find().catch(() => undefined)
    if (again) return { sheetId: again.sheetId, created: false }
    throw err
  }
}

/** The header row (row 1 unless given) set to these headers, RAW. */
export async function writeHeaderRow(token: string, spreadsheetId: string, title: string, headers: readonly string[], row = 1): Promise<void> {
  if (headers.length === 0) return
  await call(token, `${API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tabRange(title)}!A${Math.max(1, row)}`)}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [headers.map((h) => String(h))] }),
  })
}

/** Google said "busy" (429), had a hiccup (5xx), or could not be reached. */
export function isTransientSheetsError(err: unknown): boolean {
  return err instanceof SheetsApiError && (err.status === 0 || err.status === 429 || err.status >= 500)
}
