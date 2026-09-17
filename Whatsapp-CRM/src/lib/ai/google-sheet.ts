/**
 * Reading a Google Sheet the account has shared by link.
 *
 * The want behind this is "when the sheet changes, the assistant knows".
 * A shared sheet is the lowest-friction way to get there: the fee table,
 * the course calendar and the hostel rules already live in one, somebody
 * already maintains it, and asking them to re-type it into a CRM is
 * asking for two sources of truth that will disagree within a week.
 *
 * ── Why link-sharing and not OAuth, for now ─────────────────────────
 *
 * Google's CSV export endpoint serves any sheet set to "anyone with the
 * link can view", with no credentials at all. That means this works the
 * minute somebody pastes a URL. A connected Google account would also
 * reach private sheets, and is the better answer eventually, but it needs
 * an OAuth app, a consent screen and a token store — none of which help
 * the account that just wants their fee list in the bot today.
 *
 * The cost of the simple path is that a sheet which is *not* shared does
 * not fail cleanly. Google answers with a sign-in page, HTTP 200, HTML
 * body. Parsed naively that becomes a knowledge entry containing Google's
 * login markup, which embeds fine and answers questions wrongly forever.
 * Detecting that case is most of what this file does.
 */

/** Google will happily stream a very large sheet. This is knowledge-base
 *  material meant to fit in a prompt, so a cap that protects both the
 *  server and the context window is the honest place to stop. */
const MAX_BYTES = 2 * 1024 * 1024
const MAX_ROWS = 2_000
const FETCH_TIMEOUT_MS = 20_000

export interface SheetRef {
  spreadsheetId: string
  /** Which tab. Null means the first one, which is what Google serves
   *  when no gid is given. */
  gid: string | null
  csvUrl: string
}

export class SheetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SheetError'
  }
}

/**
 * Pulls the spreadsheet id and tab out of whatever the user pasted.
 *
 * Deliberately strict about the host. This URL is fetched by the server
 * on the account's behalf, which is a server-side request forgery if the
 * host is attacker-chosen — the one restriction that matters is that it
 * can only ever be Google's spreadsheet service.
 */
export function parseSheetUrl(raw: string): SheetRef {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new SheetError('That is not a link. Paste the sheet URL from your browser address bar.')
  }

  if (url.protocol !== 'https:') {
    throw new SheetError('The sheet link must start with https://')
  }
  if (url.hostname !== 'docs.google.com') {
    throw new SheetError(
      `Only Google Sheets links are supported here, and this one points at ${url.hostname}.`,
    )
  }

  const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!match) {
    throw new SheetError(
      'That Google link is not a spreadsheet. The URL should look like docs.google.com/spreadsheets/d/…',
    )
  }
  const spreadsheetId = match[1]

  // The tab id lives in the fragment on a normal browser URL
  // (#gid=123456) and in the query string on an export URL. Both are
  // pasted in practice.
  const gid =
    url.searchParams.get('gid') ??
    (url.hash.match(/gid=(\d+)/)?.[1] ?? null)

  const csvUrl =
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv` +
    (gid ? `&gid=${gid}` : '')

  return { spreadsheetId, gid, csvUrl }
}

/**
 * RFC 4180 CSV, including quoted fields containing commas and newlines.
 *
 * Hand-written rather than pulled in as a dependency: the format is
 * small, and the one thing a naive `split(',')` gets wrong — a quoted
 * address or a multi-line answer — is exactly what a knowledge sheet is
 * full of.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  // A byte-order mark at the start of the file otherwise ends up inside
  // the first column's header name, so "Question" never matches.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      // Swallow the \n of a \r\n pair rather than emitting a blank row.
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += c
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

export interface SheetContent {
  /** The tab's own name, when Google reports it. */
  title: string | null
  headers: string[]
  rows: string[][]
  truncated: boolean
}

/**
 * Fetches the sheet and returns its rows.
 *
 * Every failure mode here is one an account will actually hit, so each
 * gets a sentence saying what to do rather than a status code.
 */
export async function fetchSheet(raw: string): Promise<SheetContent> {
  const ref = parseSheetUrl(raw)

  let response: Response
  try {
    response = await fetch(ref.csvUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/csv,*/*' },
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError'
    throw new SheetError(
      timedOut
        ? 'Google did not respond in time. Try again, or split a very large sheet into smaller tabs.'
        : `Could not reach Google Sheets: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (response.status === 404) {
    throw new SheetError('No sheet with that link exists. Check the URL, or that it was not deleted.')
  }
  if (!response.ok) {
    throw new SheetError(`Google Sheets returned ${response.status} for that link.`)
  }

  // The failure this whole file exists to catch. An unshared sheet
  // answers 200 with a sign-in page, and that HTML would otherwise be
  // stored as knowledge and quoted at customers.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('csv')) {
    throw new SheetError(
      'That sheet is not shared. In Google Sheets open Share → General access → "Anyone with the link" → Viewer, then paste the link again. ' +
        '(A sheet that needs a sign-in returns Google’s login page instead of your data.)',
    )
  }

  const raw_text = await readCapped(response)
  const all = parseCsv(raw_text)
  if (all.length === 0) {
    throw new SheetError('That sheet is empty.')
  }

  const [headers, ...body] = all
  const truncated = body.length > MAX_ROWS

  return {
    // Google puts the tab name in the download filename, which is the
    // only place it appears in a CSV export.
    title: filenameFrom(response.headers.get('content-disposition')),
    headers: headers.map((h) => h.trim()),
    rows: truncated ? body.slice(0, MAX_ROWS) : body,
    truncated,
  }
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BYTES) {
      await reader.cancel()
      throw new SheetError(
        `That sheet is larger than ${Math.round(MAX_BYTES / 1024 / 1024)}MB. Keep the tab to the rows the assistant actually needs to answer from.`,
      )
    }
    chunks.push(value)
  }
  return new TextDecoder('utf-8').decode(await new Blob(chunks as BlobPart[]).arrayBuffer())
}

function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null
  const m = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]).replace(/\.csv$/i, '').trim() || null
  } catch {
    return m[1].replace(/\.csv$/i, '').trim() || null
  }
}

/**
 * Turns the rows into the text the model actually reads.
 *
 * Column-labelled rather than a CSV dump, because a chunk of retrieved
 * text has no header row above it. "Fee: 3540" survives being pulled out
 * of context; a bare "3540" in column four does not, and that is the
 * difference between the assistant quoting a fee and inventing one.
 */
export function serializeSheet(sheet: SheetContent, description?: string | null): string {
  const lines: string[] = []
  if (description?.trim()) lines.push(description.trim(), '')

  const headers = sheet.headers.map((h, i) => h || `Column ${i + 1}`)

  for (const row of sheet.rows) {
    const pairs = headers
      .map((h, i) => ({ h, v: (row[i] ?? '').trim() }))
      .filter((p) => p.v !== '')
    if (pairs.length === 0) continue
    lines.push(pairs.map((p) => `${p.h}: ${p.v}`).join(' | '))
  }

  if (sheet.truncated) {
    lines.push('', `(Only the first ${MAX_ROWS} rows of this sheet are included.)`)
  }

  return lines.join('\n')
}
