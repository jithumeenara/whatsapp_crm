/**
 * Two-way sync between a Data Store table and a Google Sheet tab — the
 * decisions, with no database and no Google in sight (sheet-two-way.ts
 * does the reading and writing).
 *
 * Three pictures go in: the sheet as it is, the table as it is, and the
 * snapshot — what each synced row looked like on both sides when they last
 * agreed. A cell that differs from the snapshot was changed on that side.
 * So a change on one side is copied to the other, and a field nobody
 * touched is never overwritten by a stale copy. When both sides changed
 * the same field since the last sync, the sheet wins (it is the edit the
 * CRM has not seen yet; a CRM edit reaches the sheet within seconds).
 *
 * Rows are matched by the record id in the "CRM ID" column, which the sync
 * fills in. A row without one is new — unless it equals a record that is
 * not linked yet (the first sync of a sheet that was imported or exported
 * before), which it adopts instead of duplicating.
 *
 * Deleting is the dangerous part, so it is guarded: rows that vanish from
 * the sheet in a bulk (more than a few, or every row) are held — nothing
 * is deleted in the CRM until a person confirms. And when the "CRM ID"
 * column itself is gone, nothing at all is done.
 */

import crypto from 'crypto'

export const ID_HEADER = 'CRM ID'

/** Never synced: layout, files, secrets, and structured values a cell
 *  cannot hold. A password must never reach a spreadsheet. */
export const NOT_SYNCED = new Set([
  'section_header', 'html_block', 'hidden', 'signature', 'file', 'image', 'password', 'relation', 'address',
])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Field key → cell text. */
export type Snapshot = Record<string, string>

export interface PlanField {
  field_key: string
  field_type: string
}

export interface PlanInput {
  /** Row 1 as read (may be shorter than the data rows). */
  header: string[]
  /** Rows 2… as read; index 0 is sheet row 2. */
  rows: string[][]
  /** Sheet header → field key ("" = not synced). */
  columnMap: Record<string, string>
  fields: PlanField[]
  records: Array<{ id: string; data: Record<string, unknown> }>
  snapshots: Map<string, Snapshot>
  /** Records already waiting for a person's decision. */
  heldDeletes: Set<string>
  /** The person confirmed: delete the records whose rows are gone. */
  allowDeletes: boolean
  newId: () => string
}

export interface PlanStats {
  fromSheet: { created: number; updated: number; deleted: number }
  toSheet: { added: number; updated: number; deleted: number }
}

export interface Plan {
  /** Nothing is applied when set — said on the panel. */
  stopped: string | null
  idCol: number
  writeIdHeader: boolean
  createRecords: Array<{ id: string; data: Record<string, unknown> }>
  /** Full new data for each changed record. */
  updateRecords: Array<{ id: string; data: Record<string, unknown> }>
  deleteRecords: string[]
  /** row = index into PlanInput.rows. */
  cellWrites: Array<{ row: number; col: number; value: string }>
  appendRows: string[][]
  /** Indexes into PlanInput.rows. */
  deleteSheetRows: number[]
  snapshots: Map<string, Snapshot>
  held: string[]
  warnings: string[]
  stats: PlanStats
}

/** One cell's text for a stored value (same as the export). */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(cellText).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).trim()
}

/** A cell's text as the value a field of this type stores. */
export function parseCell(fieldType: string, text: string): unknown {
  const t = text.trim()
  if (fieldType === 'number') {
    const n = t.replace(/,/g, '')
    return /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : t
  }
  if (fieldType === 'boolean') {
    if (/^(yes|true|1|y|✓|✔)$/i.test(t)) return true
    if (/^(no|false|0|n)$/i.test(t)) return false
    return t
  }
  if (fieldType === 'multiselect') return t.split(/\s*,\s*/).filter(Boolean)
  return t
}

/**
 * Two cell texts mean the same value for this field type. A sheet shows
 * "5,000" for the 5000 the CRM stores, "TRUE" for Yes; treating those as
 * different would rewrite the business's formatted cells as plain text on
 * every sync.
 */
export function sameValue(fieldType: string, a: string, b: string): boolean {
  if (a === b) return true
  if (fieldType === 'number' || fieldType === 'boolean') {
    return JSON.stringify(parseCell(fieldType, a)) === JSON.stringify(parseCell(fieldType, b))
  }
  if (fieldType === 'multiselect') {
    const norm = (s: string) => (parseCell('multiselect', s) as string[]).map((x) => x.toLowerCase()).sort().join('\n')
    return norm(a) === norm(b)
  }
  return false
}

/** The same values always give the same key, whatever their order or
 *  formatting ("5,000" and 5000, "TRUE" and Yes give one key). */
export function valuesKey(values: Snapshot, typeOf: (key: string) => string = () => 'text'): string {
  const sorted = Object.keys(values)
    .filter((k) => values[k] !== '')
    .sort()
    .map((k) => {
      const type = typeOf(k)
      const v = parseCell(type, values[k])
      return [k, Array.isArray(v) ? v.map((x) => String(x).toLowerCase()).sort() : v]
    })
  return crypto.createHash('sha1').update(JSON.stringify(sorted)).digest('hex').slice(0, 20)
}

/** Header cells as the CRM names them: a blank header is "Column N". */
export function effectiveHeaders(header: string[], width: number): string[] {
  return Array.from({ length: width }, (_, i) => (header[i] ?? '').trim() || `Column ${i + 1}`)
}

const isIdHeader = (h: string) => h.trim().toLowerCase() === ID_HEADER.toLowerCase()

/** Rows that vanish from the sheet at once beyond this are held for a person. */
export function bulkDeleteThreshold(linkedRows: number): number {
  return Math.max(3, Math.floor(linkedRows * 0.2))
}

export function planSync(input: PlanInput): Plan {
  const stats: PlanStats = { fromSheet: { created: 0, updated: 0, deleted: 0 }, toSheet: { added: 0, updated: 0, deleted: 0 } }
  const plan: Plan = {
    stopped: null,
    idCol: -1,
    writeIdHeader: false,
    createRecords: [],
    updateRecords: [],
    deleteRecords: [],
    cellWrites: [],
    appendRows: [],
    deleteSheetRows: [],
    snapshots: new Map(input.snapshots),
    held: [],
    warnings: [],
    stats,
  }

  const width = Math.max(input.header.length, ...input.rows.map((r) => r.length), 0)
  const headers = effectiveHeaders(input.header, width)
  const typeOf = new Map(input.fields.map((f) => [f.field_key, f.field_type]))

  // ── Which column is which field ─────────────────────────────────────
  let idCol = headers.findIndex(isIdHeader)
  const columns: Array<{ col: number; key: string }> = []
  const usedKeys = new Set<string>()
  headers.forEach((h, col) => {
    if (col === idCol) return
    const key = input.columnMap[h]
    if (!key || usedKeys.has(key)) return
    const type = typeOf.get(key)
    if (!type || NOT_SYNCED.has(type)) return
    usedKeys.add(key)
    columns.push({ col, key })
  })
  // A mapped column renamed or removed in the sheet: left out on both
  // sides (never read as "emptied"), and said on the panel.
  const missing = Object.entries(input.columnMap)
    .filter(([, key]) => key && !usedKeys.has(key) && typeOf.has(key) && !NOT_SYNCED.has(typeOf.get(key)!))
    .map(([header]) => header)
  if (missing.length) {
    plan.warnings.push(
      `Not synced: the column${missing.length === 1 ? '' : 's'} ${missing.map((h) => `"${h}"`).join(', ')} ${missing.length === 1 ? 'is' : 'are'} no longer in the sheet (renamed or removed). Rename it back, or choose the sheet again to map it.`,
    )
  }
  if (columns.length === 0) {
    plan.stopped = 'None of the sheet\'s columns is linked to a field any more. Choose the sheet again to map the columns.'
    return plan
  }

  if (idCol === -1) {
    if (input.snapshots.size > 0) {
      plan.stopped = `The "${ID_HEADER}" column was removed from the sheet, so rows can no longer be matched to records. Put it back (Undo in Google Sheets) — nothing has been changed on either side.`
      return plan
    }
    idCol = width
    plan.writeIdHeader = true
  }
  plan.idCol = idCol

  const valuesOf = (row: string[]): Snapshot => {
    const v: Snapshot = {}
    for (const { col, key } of columns) v[key] = (row[col] ?? '').trim()
    return v
  }
  const crmValues = (data: Record<string, unknown>): Snapshot => {
    const v: Snapshot = {}
    for (const { key } of columns) v[key] = cellText(data[key])
    return v
  }
  const toData = (base: Record<string, unknown>, patch: Snapshot): Record<string, unknown> => {
    const out = { ...base }
    for (const [key, text] of Object.entries(patch)) {
      if (text === '') delete out[key]
      else out[key] = parseCell(typeOf.get(key) ?? 'text', text)
    }
    return out
  }

  const records = new Map(input.records.map((r) => [r.id, r]))
  const seen = new Set<string>()

  // Records not linked to a row yet, by their values — a row with no id
  // that equals one of them is that record, not a new one.
  const keyType = (k: string) => typeOf.get(k) ?? 'text'
  // Identical records queue up, so identical rows each adopt their own.
  const unlinked = new Map<string, string[]>()
  for (const r of input.records) {
    if (input.snapshots.has(r.id)) continue
    const key = valuesKey(crmValues(r.data), keyType)
    unlinked.set(key, [...(unlinked.get(key) ?? []), r.id])
  }

  let rowsWithContent = 0
  input.rows.forEach((row, i) => {
    const id = (row[idCol] ?? '').trim()
    const vals = valuesOf(row)
    const hasValues = Object.values(vals).some((v) => v !== '')
    if (hasValues || id) rowsWithContent++

    const known = UUID.test(id) && !seen.has(id) && (records.has(id) || input.snapshots.has(id))
    if (known) {
      seen.add(id)
      const rec = records.get(id)
      const snap = input.snapshots.get(id)
      if (!rec) {
        // Deleted in the CRM: the row goes too.
        plan.deleteSheetRows.push(i)
        plan.snapshots.delete(id)
        stats.toSheet.deleted++
        return
      }
      const crm = crmValues(rec.data)
      // Linked by id but never synced (snapshots lost): the CRM's values are
      // the base, so whatever the sheet shows differently counts as an edit.
      const base = snap ?? crm
      const next: Snapshot = { ...(snap ?? {}) }
      const patch: Snapshot = {}
      let wroteCell = false
      for (const { col, key } of columns) {
        const type = typeOf.get(key) ?? 'text'
        const s = vals[key]
        const c = crm[key]
        const b = base[key] ?? ''
        if (sameValue(type, s, c)) {
          next[key] = s
          continue
        }
        if (!sameValue(type, s, b)) {
          patch[key] = s
          next[key] = s
        } else {
          plan.cellWrites.push({ row: i, col, value: c })
          next[key] = c
          wroteCell = true
        }
      }
      if (Object.keys(patch).length) {
        plan.updateRecords.push({ id, data: toData(rec.data, patch) })
        stats.fromSheet.updated++
      }
      if (wroteCell) stats.toSheet.updated++
      plan.snapshots.set(id, next)
      return
    }

    // No usable id: a blank row, a new row typed or pasted into the sheet,
    // or a copy of another row (its id already taken above).
    if (!hasValues) return
    const match = unlinked.get(valuesKey(vals, keyType))?.shift()
    if (match && !seen.has(match)) {
      seen.add(match)
      plan.cellWrites.push({ row: i, col: idCol, value: match })
      plan.snapshots.set(match, { ...vals })
      return
    }
    const newId = input.newId()
    seen.add(newId)
    const nonEmpty: Snapshot = {}
    for (const [k, v] of Object.entries(vals)) if (v !== '') nonEmpty[k] = v
    plan.createRecords.push({ id: newId, data: toData({}, nonEmpty) })
    plan.cellWrites.push({ row: i, col: idCol, value: newId })
    plan.snapshots.set(newId, { ...vals })
    stats.fromSheet.created++
  })

  // ── Records with no row ──────────────────────────────────────────────
  const goneFromSheet: string[] = []
  const rowWidth = Math.max(width, idCol + 1)
  for (const r of input.records) {
    if (seen.has(r.id)) continue
    if (input.snapshots.has(r.id)) {
      goneFromSheet.push(r.id)
      continue
    }
    // New in the CRM (or never synced): added to the sheet.
    const crm = crmValues(r.data)
    const row = Array.from({ length: rowWidth }, () => '')
    for (const { col, key } of columns) row[col] = crm[key]
    row[idCol] = r.id
    plan.appendRows.push(row)
    plan.snapshots.set(r.id, crm)
    stats.toSheet.added++
  }
  // Gone from both sides: nothing left to remember.
  for (const id of input.snapshots.keys()) {
    if (!records.has(id) && !seen.has(id)) plan.snapshots.delete(id)
  }

  // ── Rows deleted in the sheet ────────────────────────────────────────
  if (goneFromSheet.length) {
    const bulk =
      goneFromSheet.length > bulkDeleteThreshold(input.snapshots.size) ||
      (rowsWithContent === 0 && input.snapshots.size > 0)
    if (input.allowDeletes || (!bulk && input.heldDeletes.size === 0)) {
      plan.deleteRecords = goneFromSheet
      for (const id of goneFromSheet) plan.snapshots.delete(id)
      stats.fromSheet.deleted = goneFromSheet.length
    } else {
      // Kept, snapshots and all, so they are neither deleted nor re-added
      // until a person decides.
      plan.held = goneFromSheet
    }
  }

  return plan
}
