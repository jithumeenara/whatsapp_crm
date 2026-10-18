/**
 * Two-way sync between a Data Store table and a Google Sheet tab — the
 * reading and writing. What to change is decided in sheet-two-way-plan.ts.
 *
 * When it runs:
 *   - within ~2 s of any change in the CRM (record-events.ts, every writer)
 *   - within ~2 s of a change in the sheet, when the sheet has the small
 *     Apps Script that pings /api/google/sheet-ping (optional)
 *   - every minute regardless (every 10 minutes once the script is pinging),
 *     which also catches anything a failed call missed
 *
 * One run per link at a time; changes arriving during a run trigger one
 * more run after it. Each run reads the whole tab once, so a burst of
 * edits costs one read.
 *
 * Order of writes: the database first, then the sheet, then the
 * snapshots. A run that dies halfway is put right by the next one: a
 * record created without its id reaching the sheet is adopted back by
 * value, and a row whose id names no record becomes a new one.
 */

import crypto from 'crypto'
import { syncDropdownFields } from './sheet-dropdowns'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { googleAccessToken, isGoogleServiceEnabled } from './oauth'
import { SHEET_MAX_ROWS, SheetsApiError, appendRows, deleteRows, getSpreadsheet, readTab, writeCells } from './sheets'
import { ensureGoogleTables } from './store'
import { ID_HEADER, planSync, type Snapshot } from './sheet-two-way-plan'
import { columnMapOf } from './sheet-sync'

export { ID_HEADER }

export interface SyncResult {
  ok: boolean
  stats?: { fromSheet: { created: number; updated: number; deleted: number }; toSheet: { added: number; updated: number; deleted: number } }
  held?: number
  warning?: string | null
  error?: string
}

/** Two-way needs to write to the sheet: the two-way permission, or the
 *  basic one for a sheet picked in Google's window / created by the CRM. */
export async function canWriteSheets(accountId: string): Promise<boolean> {
  return (
    (await isGoogleServiceEnabled(accountId, 'sheets_sync').catch(() => false)) ||
    (await isGoogleServiceEnabled(accountId, 'sheets').catch(() => false))
  )
}

function friendly(err: unknown): string {
  if (err instanceof SheetsApiError && err.status === 403) {
    return 'The CRM can read this sheet but not change it. In Settings → Google, connect "Google Sheets — two-way sync" (or choose the sheet in Google\'s own file window).'
  }
  return err instanceof Error ? err.message : String(err)
}

// ── Running ────────────────────────────────────────────────────────────

const running = new Set<string>()
const again = new Map<string, boolean>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Sync one link now. `allowDeletes` is a person confirming held deletions.
 * Never throws: problems are kept on the link for the panel.
 */
export async function runSheetSync(linkId: string, accountId: string, opts: { allowDeletes?: boolean } = {}): Promise<SyncResult> {
  if (running.has(linkId)) {
    again.set(linkId, again.get(linkId) || Boolean(opts.allowDeletes))
    return { ok: true }
  }
  running.add(linkId)
  try {
    return await syncOnce(linkId, accountId, Boolean(opts.allowDeletes))
  } finally {
    running.delete(linkId)
    if (again.has(linkId)) {
      const allow = again.get(linkId)
      again.delete(linkId)
      void runSheetSync(linkId, accountId, { allowDeletes: allow })
    }
  }
}

/** A change happened: sync in a moment, once for a whole burst. */
export function syncSoon(linkId: string, accountId: string, delayMs = 1500): void {
  const t = timers.get(linkId)
  if (t) clearTimeout(t)
  timers.set(
    linkId,
    setTimeout(() => {
      timers.delete(linkId)
      void runSheetSync(linkId, accountId)
    }, delayMs),
  )
}

/** For record writers: this table changed. One indexed lookup when the
 *  table has no two-way sheet. */
export async function syncTableSoon(tableId: string, accountId: string): Promise<void> {
  await ensureGoogleTables().catch(() => {})
  const link = await prisma.googleSheetLink
    .findUnique({ where: { table_id_direction: { table_id: tableId, direction: 'sync' } }, select: { id: true, account_id: true } })
    .catch(() => null)
  if (link && link.account_id === accountId) syncSoon(link.id, accountId)
}

async function syncOnce(linkId: string, accountId: string, allowDeletes: boolean): Promise<SyncResult> {
  await ensureGoogleTables()
  const link = await prisma.googleSheetLink.findFirst({ where: { id: linkId, account_id: accountId, direction: 'sync' } })
  if (!link) return { ok: false, error: 'That sheet link no longer exists.' }

  const fail = async (message: string): Promise<SyncResult> => {
    await prisma.googleSheetLink.update({ where: { id: link.id }, data: { last_error: message } }).catch(() => {})
    return { ok: false, error: message }
  }

  if (!(await canWriteSheets(accountId))) return fail('Google Sheets is switched off in Settings → Google.')
  const columnMap = columnMapOf(link.column_map)
  if (!columnMap) return fail('This link has no column mapping. Choose the sheet again.')

  try {
    const [token, fields, records, snapshotRows] = await Promise.all([
      googleAccessToken(accountId),
      prisma.dataField.findMany({ where: { table_id: link.table_id }, select: { field_key: true, field_type: true } }),
      prisma.dataRecord.findMany({
        where: { table_id: link.table_id, account_id: accountId },
        orderBy: { created_at: 'asc' },
        take: SHEET_MAX_ROWS + 1,
        select: { id: true, data: true },
      }),
      prisma.googleSheetRow.findMany({ where: { link_id: link.id }, select: { record_id: true, snapshot: true } }),
    ])
    if (records.length > SHEET_MAX_ROWS) {
      return fail(`Two-way sync handles up to ${SHEET_MAX_ROWS.toLocaleString('en-IN')} records; this table has more. Use "Send new records to a sheet" instead.`)
    }

    const all = await readTab(token, link.spreadsheet_id, link.sheet_title)
    if (all.length - 1 > SHEET_MAX_ROWS) {
      return fail(`The sheet has more than ${SHEET_MAX_ROWS.toLocaleString('en-IN')} rows; two-way sync handles up to that many.`)
    }
    const [header = [], ...rows] = all

    // The sheet's dropdowns become the fields' choices (at most every 10 min).
    await syncDropdownFields({
      accountId, tableId: link.table_id, token, spreadsheetId: link.spreadsheet_id, sheetTitle: link.sheet_title,
      columnKeys: header.map((h) => columnMap[String(h).trim()] || null), rows,
    })

    const snapshots = new Map<string, Snapshot>()
    for (const s of snapshotRows) snapshots.set(s.record_id, (s.snapshot as Snapshot) ?? {})

    const plan = planSync({
      header,
      rows,
      columnMap,
      fields,
      records: records.map((r) => ({
        id: r.id,
        data: r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : {},
      })),
      snapshots,
      heldDeletes: new Set(link.held_deletes),
      allowDeletes,
      newId: () => crypto.randomUUID(),
    })

    if (plan.stopped) return fail(plan.stopped)

    // 1 · The CRM.
    if (plan.createRecords.length) {
      await prisma.dataRecord.createMany({
        data: plan.createRecords.map((r) => ({
          id: r.id,
          table_id: link.table_id,
          account_id: accountId,
          data: r.data as Prisma.InputJsonValue,
          source: 'google_sheet',
        })),
      })
    }
    for (const r of plan.updateRecords) {
      await prisma.dataRecord.updateMany({
        where: { id: r.id, table_id: link.table_id, account_id: accountId },
        data: { data: r.data as Prisma.InputJsonValue },
      })
    }
    if (plan.deleteRecords.length) {
      // Only rows that were synced, then removed from the sheet, under the
      // bulk guard (sheet-two-way-plan.ts) — never a table-wide delete.
      await prisma.dataRecord.deleteMany({
        where: { id: { in: plan.deleteRecords }, table_id: link.table_id, account_id: accountId },
      })
      console.log(`[sheet-sync] ${link.id}: ${plan.deleteRecords.length} record(s) deleted because their rows were removed from the sheet`)
    }

    // 2 · The sheet. Cells before row deletions, so row numbers hold.
    const cells = plan.cellWrites.map((c) => ({ row: c.row + 2, col: c.col, value: c.value }))
    if (plan.writeIdHeader) cells.unshift({ row: 1, col: plan.idCol, value: ID_HEADER })
    if (cells.length) await writeCells(token, link.spreadsheet_id, link.sheet_title, cells)
    if (plan.deleteSheetRows.length) {
      const info = await getSpreadsheet(token, link.spreadsheet_id)
      const tab = info.tabs.find((t) => t.title === link.sheet_title)
      if (tab) await deleteRows(token, link.spreadsheet_id, tab.sheetId, plan.deleteSheetRows.map((i) => i + 2))
    }
    if (plan.appendRows.length) await appendRows(token, link.spreadsheet_id, link.sheet_title, plan.appendRows)

    // 3 · What both sides now agree on.
    await saveSnapshots(link.id, snapshots, plan.snapshots)

    const changedCrm = plan.createRecords.length + plan.updateRecords.length + plan.deleteRecords.length
    if (changedCrm) {
      const { scheduleKnowledgeRefresh } = await import('@/lib/ai/knowledge-refresh')
      scheduleKnowledgeRefresh(accountId, link.table_id)
    }

    const warning = plan.warnings[0] ?? null
    await prisma.googleSheetLink.update({
      where: { id: link.id },
      data: {
        last_synced_at: new Date(),
        last_error: null,
        sync_warning: warning,
        held_deletes: plan.held,
        sync_stats: { ...plan.stats, at: new Date().toISOString() } as Prisma.InputJsonValue,
      },
    })
    return { ok: true, stats: plan.stats, held: plan.held.length, warning }
  } catch (err) {
    const message = friendly(err)
    console.error('[sheet-sync] run failed:', message)
    return fail(message)
  }
}

async function saveSnapshots(linkId: string, before: Map<string, Snapshot>, after: Map<string, Snapshot>): Promise<void> {
  const removed = [...before.keys()].filter((id) => !after.has(id))
  const changed = [...after.entries()].filter(([id, snap]) => {
    const old = before.get(id)
    return !old || JSON.stringify(old) !== JSON.stringify(snap)
  })
  if (removed.length === 0 && changed.length === 0) return
  const touched = [...removed, ...changed.map(([id]) => id)]
  await prisma.$transaction([
    prisma.googleSheetRow.deleteMany({ where: { link_id: linkId, record_id: { in: touched } } }),
    prisma.googleSheetRow.createMany({
      data: changed.map(([record_id, snapshot]) => ({ link_id: linkId, record_id, snapshot: snapshot as Prisma.InputJsonValue })),
    }),
  ])
}

/**
 * Every minute from server.ts. A link whose sheet pings on every change
 * (the Apps Script) is only checked every 10 minutes; one with an error
 * every 15, so a broken permission doesn't spend the account's quota.
 */
export async function sweepTwoWaySheets(now: Date = new Date()): Promise<void> {
  await ensureGoogleTables().catch(() => {})
  const links = await prisma.googleSheetLink
    .findMany({
      where: { direction: 'sync' },
      select: { id: true, account_id: true, last_synced_at: true, instant_ping_at: true, last_error: true, updated_at: true },
    })
    .catch(() => [])
  for (const l of links) {
    const pinging = l.instant_ping_at && now.getTime() - l.instant_ping_at.getTime() < 24 * 60 * 60_000
    const every = l.last_error ? 15 : pinging ? 10 : 1
    const last = (l.last_error ? l.updated_at : l.last_synced_at)?.getTime() ?? 0
    if (now.getTime() - last < every * 60_000 - 5_000) continue
    await runSheetSync(l.id, l.account_id).catch((err) =>
      console.error('[sheet-sync] scheduled run failed:', err instanceof Error ? err.message : err),
    )
  }
}

// ── Instant updates from the sheet (optional Apps Script) ───────────────

/** The link's ping secret, made on first use and kept encrypted. */
export async function pingToken(linkId: string): Promise<string> {
  const link = await prisma.googleSheetLink.findUnique({ where: { id: linkId }, select: { sync_token_enc: true } })
  if (link?.sync_token_enc) {
    try {
      return decrypt(link.sync_token_enc)
    } catch {
      // unreadable (key rotated): a new one below
    }
  }
  const token = crypto.randomBytes(24).toString('base64url')
  await prisma.googleSheetLink.update({ where: { id: linkId }, data: { sync_token_enc: encrypt(token) } })
  return token
}

/** True when the token belongs to this link. Constant-time. */
export async function checkPing(linkId: string, token: string): Promise<{ ok: boolean; accountId?: string }> {
  const link = await prisma.googleSheetLink
    .findFirst({ where: { id: linkId, direction: 'sync' }, select: { account_id: true, sync_token_enc: true } })
    .catch(() => null)
  if (!link?.sync_token_enc) return { ok: false }
  let expected: string
  try {
    expected = decrypt(link.sync_token_enc)
  } catch {
    return { ok: false }
  }
  const a = crypto.createHash('sha256').update(expected).digest()
  const b = crypto.createHash('sha256').update(token).digest()
  return crypto.timingSafeEqual(a, b) ? { ok: true, accountId: link.account_id } : { ok: false }
}

/** The script a person pastes into the sheet (Extensions → Apps Script).
 *  It only says "changed" — no data leaves the sheet through it. */
export function appsScriptFor(origin: string, linkId: string, token: string): string {
  return [
    '// WhatsApp CRM — instant two-way sync.',
    '// Tells the CRM "this sheet changed"; the CRM then reads the sheet itself.',
    '// No sheet data is sent by this script.',
    `const CRM_URL = '${origin}/api/google/sheet-ping';`,
    `const LINK = '${linkId}';`,
    `const TOKEN = '${token}';`,
    '',
    '// Run this once (▶ Run), and allow access when Google asks.',
    'function install() {',
    '  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });',
    '  ScriptApp.newTrigger(\'notifyCrm\').forSpreadsheet(SpreadsheetApp.getActive()).onChange().create();',
    '  ScriptApp.newTrigger(\'notifyCrm\').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();',
    '  notifyCrm();',
    '}',
    '',
    'function notifyCrm() {',
    '  UrlFetchApp.fetch(CRM_URL, {',
    "    method: 'post',",
    "    contentType: 'application/json',",
    '    payload: JSON.stringify({ link: LINK, token: TOKEN }),',
    '    muteHttpExceptions: true,',
    '  });',
    '}',
    '',
  ].join('\n')
}
