/**
 * Sheet routing — the worker. Data Store rows to Google Sheets by rules
 * (sheet-route-rules.ts), from every source, without losing any.
 *
 * How a row gets there:
 *  1. Something changes a table (any of its nine doors calls
 *     afterRecordsChanged / afterRecordCreated) → `routeTableSoon`.
 *     Writers that never call it are caught by the minute sweep, which
 *     reads data_records.updated_at past a cursor — so a source nobody
 *     thought of still routes.
 *  2. Each changed row becomes a job in sheet_jobs (one waiting job per
 *     row however many edits). A deleted row is found because its
 *     placement (sheet_route_rows) has no record any more.
 *  3. Jobs are worked in batches: every tab touched is read once, its
 *     changes written in at most four calls (header, cells, append,
 *     delete). Rows are found by their "CRM ID", never by row number, so
 *     sorting or editing the sheet breaks nothing, and a retry never adds
 *     a duplicate.
 *  4. Google busy (429) or down: the job waits and tries again — 1, 2,
 *     5, 15, 30 minutes, then hourly — and after 8 tries it is "failed",
 *     shown on the screen with a Retry button. Nothing is dropped.
 *
 * Loaded by server.ts (the sweep) — so no next/server anywhere below.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { googleAccessToken } from './oauth'
import { appendRows, createSpreadsheet, deleteRows, ensureTab, isTransientSheetsError, readTab, writeCells, writeHeaderRow, SheetsApiError } from './sheets'
import { sheetLockKey, withSheetLock } from './sheet-lock'
import { findColumn, safeTabTitle } from './sheet-rows'
import { destinationsFor, planTabWrite, type RouteField, type RouteRule } from './sheet-route-rules'
import { businessNow } from './sheet-step'

const MAX_ATTEMPTS = 8
const BACKOFF_MIN = [1, 2, 5, 15, 30, 60, 60, 60]
/** Google allows 60 writes a minute per user; stay well under, reads included. */
const CALLS_PER_TICK = 45
const CLAIM = 150

// ── Enqueueing ──────────────────────────────────────────────────────

async function enqueueRecords(accountId: string, tableId: string, recordIds: readonly string[]): Promise<number> {
  if (recordIds.length === 0) return 0
  const n = await prisma.$executeRaw`
    INSERT INTO sheet_jobs (account_id, kind, table_id, record_id)
    SELECT ${accountId}::uuid, 'record', ${tableId}::uuid, x::uuid FROM unnest(${[...recordIds]}::text[]) AS x
    ON CONFLICT (record_id) WHERE kind = 'record' AND status = 'pending' DO NOTHING`
  return Number(n)
}

/** "Send existing rows": every row of the table, queued. */
export async function enqueueBackfill(tableId: string, accountId: string): Promise<number> {
  const n = await prisma.$executeRaw`
    INSERT INTO sheet_jobs (account_id, kind, table_id, record_id)
    SELECT account_id, 'record', table_id, id FROM data_records
    WHERE table_id = ${tableId}::uuid AND account_id = ${accountId}::uuid
    ON CONFLICT (record_id) WHERE kind = 'record' AND status = 'pending' DO NOTHING`
  routeTableSoon(tableId, accountId, 200)
  return Number(n)
}

/** Failed jobs back in the queue, now. */
export async function retryFailed(tableId: string, accountId: string): Promise<number> {
  // A failed job whose record already has a waiting one is simply dropped.
  await prisma.$executeRaw`
    DELETE FROM sheet_jobs f WHERE f.table_id = ${tableId}::uuid AND f.account_id = ${accountId}::uuid AND f.status = 'failed'
      AND f.kind = 'record' AND EXISTS (SELECT 1 FROM sheet_jobs p WHERE p.record_id = f.record_id AND p.kind = 'record' AND p.status = 'pending')`
  const n = await prisma.sheetJob.updateMany({
    where: { table_id: tableId, account_id: accountId, status: 'failed' },
    data: { status: 'pending', attempts: 0, run_after: new Date() },
  })
  routeTableSoon(tableId, accountId, 200)
  return n.count
}

// ── Finding changes ─────────────────────────────────────────────────

const ZERO_UUID = '00000000-0000-0000-0000-000000000000'

/** Rows changed since the last scan, and rows deleted since they were placed. */
async function scanTable(tableId: string): Promise<void> {
  const state = await prisma.sheetRouteTable.findUnique({ where: { table_id: tableId } })
  if (!state) return
  const live = await prisma.sheetRoute.count({ where: { table_id: tableId, enabled: true } })
  if (live === 0) return
  // A minute of overlap: a transaction that committed late with an older
  // timestamp is still seen. Re-queued rows that did not change cost no
  // Google call (their row hash is unchanged).
  let fromAt = new Date(state.cursor_at.getTime() - 60_000)
  let fromId = ZERO_UUID
  let maxAt = state.cursor_at
  for (let page = 0; page < 20; page++) {
    const rows = await prisma.$queryRaw<Array<{ id: string; updated_at: Date }>>`
      SELECT id, updated_at FROM data_records
      WHERE table_id = ${tableId}::uuid AND (updated_at, id) > (${fromAt}, ${fromId}::uuid)
      ORDER BY updated_at, id LIMIT 500`
    if (rows.length === 0) break
    await enqueueRecords(state.account_id, tableId, rows.map((r) => r.id))
    const last = rows[rows.length - 1]
    fromAt = last.updated_at
    fromId = last.id
    if (last.updated_at > maxAt) maxAt = last.updated_at
    if (rows.length < 500) break
  }
  const gone = await prisma.$queryRaw<Array<{ record_id: string }>>`
    SELECT DISTINCT r.record_id FROM sheet_route_rows r
    LEFT JOIN data_records d ON d.id = r.record_id
    WHERE r.table_id = ${tableId}::uuid AND d.id IS NULL LIMIT 500`
  await enqueueRecords(state.account_id, tableId, gone.map((g) => g.record_id))
  // updateMany: the table may have been deleted while this ran.
  await prisma.sheetRouteTable.updateMany({ where: { table_id: tableId }, data: { cursor_at: maxAt, last_run_at: new Date() } })
}

// ── Working the queue ───────────────────────────────────────────────

interface Job {
  id: string
  account_id: string
  kind: string
  table_id: string | null
  record_id: string | null
  payload: Prisma.JsonValue
  attempts: number
}

async function claim(limit: number, tableId?: string): Promise<Job[]> {
  const only = tableId ? Prisma.sql`AND table_id = ${tableId}::uuid` : Prisma.empty
  return prisma.$queryRaw<Job[]>`
    UPDATE sheet_jobs SET status = 'running', updated_at = now()
    WHERE id IN (
      SELECT id FROM sheet_jobs WHERE status = 'pending' AND run_after <= now() ${only}
      ORDER BY run_after LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING id, account_id, kind, table_id, record_id, payload, attempts`
}

async function finish(jobIds: readonly string[]): Promise<void> {
  if (jobIds.length) await prisma.sheetJob.deleteMany({ where: { id: { in: [...jobIds] }, status: 'running' } })
}

/** Back to waiting, later — or "failed" after the last try. `noCount`: not
 *  its fault (this tick's Google budget ran out), so no attempt is used. */
async function later(jobs: readonly Job[], error: string, noCount = false): Promise<void> {
  for (const j of jobs) {
    const attempts = noCount ? j.attempts : j.attempts + 1
    const failed = attempts >= MAX_ATTEMPTS
    const wait = noCount ? 1 : BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1] ?? 60
    // A newer waiting job for the same row already covers it.
    if (j.kind === 'record' && j.record_id && !failed) {
      const dup = await prisma.sheetJob.count({ where: { record_id: j.record_id, kind: 'record', status: 'pending' } })
      if (dup > 0) {
        await prisma.sheetJob.deleteMany({ where: { id: j.id } })
        continue
      }
    }
    await prisma.sheetJob.update({
      where: { id: j.id },
      data: { status: failed ? 'failed' : 'pending', attempts, last_error: error.slice(0, 500), run_after: new Date(Date.now() + wait * 60_000) },
    }).catch(() => {})
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface TabOp {
  spreadsheetId: string
  tab: string
  upserts: Array<{ job: Job; ruleId: string; recordId: string; tableId: string; headers: string[]; row: string[]; hash: string }>
  removes: Array<{ job: Job; ruleId: string; recordId: string }>
}

class Budget {
  used = 0
  take(n = 1): boolean {
    if (this.used + n > CALLS_PER_TICK) return false
    this.used += n
    return true
  }
}

async function runAccount(accountId: string, jobs: Job[]): Promise<void> {
  const budget = new Budget()
  let token: string
  try {
    const { canWriteSheets } = await import('./sheet-two-way')
    if (!(await canWriteSheets(accountId))) {
      await later(jobs, 'Google Sheets is switched off in Settings → Google.')
      return
    }
    token = await googleAccessToken(accountId)
  } catch (err) {
    await later(jobs, `Google is not connected: ${errText(err)}`)
    return
  }
  const { businessTimezone } = await import('@/lib/ai/human-date')
  const now = businessNow(await businessTimezone(accountId))
  const { isGoogleServiceEnabled } = await import('./oauth')
  const canEditAny = await isGoogleServiceEnabled(accountId, 'sheets_sync').catch(() => false)

  // ── Chatbot rows Google refused earlier ──
  const appends = jobs.filter((j) => j.kind === 'append')
  const bySheet = new Map<string, Job[]>()
  for (const j of appends) {
    const p = (j.payload ?? {}) as { spreadsheet_id?: string; tab?: string }
    const k = sheetLockKey(String(p.spreadsheet_id ?? ''), String(p.tab ?? ''))
    bySheet.set(k, [...(bySheet.get(k) ?? []), j])
  }
  for (const group of bySheet.values()) {
    const p = (group[0].payload ?? {}) as { spreadsheet_id?: string; tab?: string }
    const id = String(p.spreadsheet_id ?? '')
    if (!budget.take(2)) { await later(group, 'Waiting for Google’s per-minute limit.', true); continue }
    try {
      await withSheetLock(sheetLockKey(id, String(p.tab ?? '')), async () => {
        const { getSpreadsheet } = await import('./sheets')
        const tabs = (await getSpreadsheet(token, id)).tabs
        const tab = (p.tab && tabs.find((t) => t.title.toLowerCase() === String(p.tab).toLowerCase())?.title) || tabs[0]?.title
        if (!tab) throw new SheetsApiError('The spreadsheet has no tabs.', 400)
        const header = ((await readTab(token, id, tab))[0] ?? []).map(String)
        const rows = group.map((j) => {
          const rec = ((j.payload ?? {}) as { record?: Record<string, string> }).record ?? {}
          const line = header.map(() => '')
          for (const [k, v] of Object.entries(rec)) {
            const c = findColumn(header, k)
            if (c >= 0) line[c] = String(v)
          }
          return line
        })
        await appendRows(token, id, tab, rows)
      })
      await finish(group.map((j) => j.id))
    } catch (err) {
      await later(group, errText(err))
    }
  }

  // ── Routed Data Store rows ──
  const recordJobs = jobs.filter((j) => j.kind === 'record' && j.table_id && j.record_id)
  const byTable = new Map<string, Job[]>()
  for (const j of recordJobs) byTable.set(j.table_id!, [...(byTable.get(j.table_id!) ?? []), j])

  for (const [tableId, tjobs] of byTable) {
    const [state, routes, fields] = await Promise.all([
      prisma.sheetRouteTable.findUnique({ where: { table_id: tableId } }),
      prisma.sheetRoute.findMany({ where: { table_id: tableId, account_id: accountId }, orderBy: [{ position: 'asc' }, { created_at: 'asc' }] }),
      prisma.dataField.findMany({ where: { table_id: tableId }, orderBy: { sort_order: 'asc' }, select: { field_key: true, label: true, field_type: true, options: true } }),
    ])
    const rules: RouteRule[] = routes.map(toRule)
    const ruleById = new Map(routes.map((r) => [r.id, r]))
    const recordIds = tjobs.map((j) => j.record_id!)
    const [records, placements, targets] = await Promise.all([
      prisma.dataRecord.findMany({ where: { id: { in: recordIds }, table_id: tableId, account_id: accountId }, select: { id: true, data: true, created_at: true } }),
      prisma.sheetRouteRow.findMany({ where: { table_id: tableId, record_id: { in: recordIds } } }),
      prisma.sheetRouteTarget.findMany({ where: { route_id: { in: routes.map((r) => r.id) } } }),
    ])
    const recById = new Map(records.map((r) => [r.id, r]))
    const sheetFor = new Map(targets.map((t) => [`${t.route_id}\u0000${t.group_key}`, t.spreadsheet_id]))
    const ops = new Map<string, TabOp>()
    const opFor = (spreadsheetId: string, tab: string) => {
      const k = sheetLockKey(spreadsheetId, tab)
      let op = ops.get(k)
      if (!op) { op = { spreadsheetId, tab, upserts: [], removes: [] }; ops.set(k, op) }
      return op
    }
    const failedJobs = new Map<string, string>()

    for (const job of tjobs) {
      const rec = recById.get(job.record_id!)
      const mine = placements.filter((p) => p.record_id === job.record_id)
      try {
        const dests = rec
          ? destinationsFor({
            rules, fields: fields as RouteField[], mode: state?.mode === 'all' ? 'all' : 'first', nowWall: now.nowWall,
            rec: { id: rec.id, data: (rec.data ?? {}) as Record<string, unknown>, created_at: rec.created_at },
            sheetForGroup: (ruleId, group) => sheetFor.get(`${ruleId}\u0000${group}`) ?? null,
          })
          : []
        for (const d of dests) {
          let spreadsheetId = d.spreadsheet_id
          if (!spreadsheetId) {
            // A spreadsheet of its own for this group — made once.
            if (!budget.take(2)) throw new Error('__budget__')
            const title = `${d.rule.name} – ${d.group}`.slice(0, 120)
            const made = await createSpreadsheet(token, title, safeTabTitle(d.rule.tab_title || 'Sheet1'))
            await prisma.sheetRouteTarget.upsert({
              where: { route_id_group_key: { route_id: d.rule.id, group_key: d.group! } },
              create: { route_id: d.rule.id, group_key: d.group!, spreadsheet_id: made.id, spreadsheet_name: title },
              update: {},
            })
            spreadsheetId = (await prisma.sheetRouteTarget.findUnique({ where: { route_id_group_key: { route_id: d.rule.id, group_key: d.group! } } }))?.spreadsheet_id ?? made.id
            sheetFor.set(`${d.rule.id}\u0000${d.group}`, spreadsheetId)
          }
          const was = mine.find((p) => p.route_id === d.rule.id)
          const sameDest = was && was.spreadsheet_id === spreadsheetId && was.tab_title === d.tab
          if (sameDest && was.row_hash === d.hash) continue
          if (was && !sameDest) opFor(was.spreadsheet_id, was.tab_title).removes.push({ job, ruleId: was.route_id, recordId: job.record_id! })
          opFor(spreadsheetId, d.tab).upserts.push({ job, ruleId: d.rule.id, recordId: job.record_id!, tableId, headers: d.headers, row: d.row, hash: d.hash })
        }
        // Placements of rules this row no longer belongs to.
        for (const p of mine) {
          if (dests.some((d) => d.rule.id === p.route_id)) continue
          const route = ruleById.get(p.route_id)
          if (route && !route.move_on_edit) {
            // Kept in that sheet on purpose; forget it only once the row is deleted.
            if (!rec) await prisma.sheetRouteRow.deleteMany({ where: { route_id: p.route_id, record_id: p.record_id } })
            continue
          }
          opFor(p.spreadsheet_id, p.tab_title).removes.push({ job, ruleId: p.route_id, recordId: p.record_id })
        }
      } catch (err) {
        failedJobs.set(job.id, errText(err))
      }
    }

    for (const op of ops.values()) {
      const live = {
        upserts: op.upserts.filter((u) => !failedJobs.has(u.job.id)),
        removes: op.removes.filter((r) => !failedJobs.has(r.job.id)),
      }
      if (!live.upserts.length && !live.removes.length) continue
      if (!budget.take(5)) {
        for (const u of [...live.upserts, ...live.removes]) failedJobs.set(u.job.id, '__budget__')
        continue
      }
      try {
        const write = await withSheetLock(sheetLockKey(op.spreadsheetId, op.tab), async () => {
          const { sheetId } = await ensureTab(token, op.spreadsheetId, op.tab, [])
          const table = await readTab(token, op.spreadsheetId, op.tab)
          const plan = planTabWrite(table, live.upserts.map((u) => ({ id: u.recordId, headers: u.headers, row: u.row })), live.removes.map((r) => r.recordId))
          if (plan.header) await writeHeaderRow(token, op.spreadsheetId, op.tab, plan.header)
          if (plan.cells.length) await writeCells(token, op.spreadsheetId, op.tab, plan.cells)
          if (plan.appends.length) await appendRows(token, op.spreadsheetId, op.tab, plan.appends)
          // Deleted last: the rows above were found by the same read.
          if (plan.deletes.length) await deleteRows(token, op.spreadsheetId, sheetId, plan.deletes)
          return plan
        })
        // The sheet is right — remember where each row now is.
        for (const u of live.upserts) {
          await prisma.sheetRouteRow.upsert({
            where: { route_id_record_id: { route_id: u.ruleId, record_id: u.recordId } },
            create: { route_id: u.ruleId, record_id: u.recordId, account_id: accountId, table_id: u.tableId, spreadsheet_id: op.spreadsheetId, tab_title: op.tab, row_hash: u.hash },
            update: { spreadsheet_id: op.spreadsheetId, tab_title: op.tab, row_hash: u.hash, updated_at: new Date() },
          })
        }
        for (const r of live.removes) {
          await prisma.sheetRouteRow.deleteMany({ where: { route_id: r.ruleId, record_id: r.recordId, spreadsheet_id: op.spreadsheetId, tab_title: op.tab } })
        }
        const addedByRule = new Map<string, number>()
        for (const u of live.upserts) if (write.added.includes(u.recordId)) addedByRule.set(u.ruleId, (addedByRule.get(u.ruleId) ?? 0) + 1)
        for (const ruleId of new Set(live.upserts.map((u) => u.ruleId))) {
          await prisma.sheetRoute.update({
            where: { id: ruleId },
            data: { delivered_count: { increment: addedByRule.get(ruleId) ?? 0 }, last_delivered_at: new Date(), last_error: null },
          }).catch(() => {})
        }
      } catch (err) {
        let msg = errText(err)
        // Google hides a sheet the CRM may not edit as "not found" / "no access".
        if (err instanceof SheetsApiError && (err.status === 403 || err.status === 404) && !canEditAny) {
          msg = 'Google does not let the CRM edit this sheet yet. In Sheet routing press “Allow editing” (Google permission to edit sheets), then Retry.'
        }
        for (const u of [...live.upserts, ...live.removes]) failedJobs.set(u.job.id, msg)
        const ruleIds = new Set([...live.upserts.map((u) => u.ruleId), ...live.removes.map((r) => r.ruleId)])
        if (!isTransientSheetsError(err)) {
          await prisma.sheetRoute.updateMany({ where: { id: { in: [...ruleIds] } }, data: { last_error: msg.slice(0, 500), last_error_at: new Date() } })
        }
        console.error('[sheet-routing] write failed:', msg)
      }
    }

    const ok = tjobs.filter((j) => !failedJobs.has(j.id))
    await finish(ok.map((j) => j.id))
    const budgetWait = tjobs.filter((j) => failedJobs.get(j.id) === '__budget__')
    const bad = tjobs.filter((j) => failedJobs.has(j.id) && failedJobs.get(j.id) !== '__budget__')
    if (budgetWait.length) await later(budgetWait, 'Waiting for Google’s per-minute limit.', true)
    for (const j of bad) await later([j], failedJobs.get(j.id)!)
    await prisma.sheetRouteTable.update({
      where: { table_id: tableId },
      data: { last_run_at: new Date(), last_error: bad.length ? failedJobs.get(bad[0].id)!.slice(0, 500) : null },
    }).catch(() => {})
  }
}

export function toRule(r: {
  id: string; name: string; enabled: boolean; is_fallback: boolean; match: string; conditions: Prisma.JsonValue
  spreadsheet_id: string; tab_title: string; split_template: string | null; split_into: string; columns: Prisma.JsonValue
}): RouteRule {
  return {
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    is_fallback: r.is_fallback,
    match: r.match === 'any' ? 'any' : 'all',
    conditions: Array.isArray(r.conditions) ? (r.conditions as unknown as RouteRule['conditions']) : [],
    spreadsheet_id: r.spreadsheet_id,
    tab_title: r.tab_title,
    split_template: r.split_template,
    split_into: r.split_into === 'sheet' ? 'sheet' : 'tab',
    columns: Array.isArray(r.columns) ? (r.columns as unknown as RouteRule['columns']) : [],
  }
}

let working = false
let workAgain = false

/** Work what is due. One pass at a time in this process. */
export async function processSheetJobs(opts: { tableId?: string } = {}): Promise<void> {
  if (working) { workAgain = true; return }
  working = true
  try {
    do {
      workAgain = false
      const jobs = await claim(CLAIM, opts.tableId)
      if (jobs.length === 0) break
      const byAccount = new Map<string, Job[]>()
      for (const j of jobs) byAccount.set(j.account_id, [...(byAccount.get(j.account_id) ?? []), j])
      for (const [accountId, list] of byAccount) {
        try {
          await runAccount(accountId, list)
        } catch (err) {
          console.error('[sheet-routing] account pass failed:', errText(err))
          await later(list, errText(err)).catch(() => {})
        }
      }
    } while (workAgain)
  } finally {
    working = false
  }
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** A table changed: scan and route in a moment, once for a whole burst. */
export function routeTableSoon(tableId: string, accountId: string, delayMs = 2000): void {
  void accountId
  const t = timers.get(tableId)
  if (t) clearTimeout(t)
  timers.set(tableId, setTimeout(() => {
    timers.delete(tableId)
    void (async () => {
      try {
        await scanTable(tableId)
        await processSheetJobs({ tableId })
      } catch (err) {
        console.error('[sheet-routing] soon failed:', errText(err))
      }
    })()
  }, delayMs))
}

/** Every minute (server.ts): stuck jobs back, every routed table scanned, queue worked. */
export async function sweepSheetRouting(): Promise<void> {
  const has = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT to_regclass('sheet_jobs') IS NOT NULL AS ok`.catch(() => [])
  if (!has[0]?.ok) return
  // A job left "running" by a restart.
  const stuck = await prisma.sheetJob.findMany({ where: { status: 'running', updated_at: { lt: new Date(Date.now() - 10 * 60_000) } }, take: 500 })
  if (stuck.length) await later(stuck as Job[], 'Interrupted (server restart) — tried again.', true)
  const tables = await prisma.sheetRouteTable.findMany({ select: { table_id: true } })
  for (const t of tables) await scanTable(t.table_id).catch((err) => console.error('[sheet-routing] scan failed:', errText(err)))
  await processSheetJobs()
}
