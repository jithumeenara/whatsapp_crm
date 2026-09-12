/**
 * Turns a Data Store table into plain text the knowledge base can chunk
 * and embed — the bridge that lets the bot answer from structured data
 * the account already maintains (a fee table, a course list, a branch
 * directory) instead of that content having to be retyped as Q&A pairs.
 *
 * Serialized as one labelled block per record ("Field: value" lines)
 * rather than as CSV: the retrieval layer chunks on blank lines, so
 * record-per-chunk means a match returns one complete, self-describing
 * record instead of a fragment of a row whose column headers were three
 * chunks earlier.
 */

import { prisma } from '@/lib/db'

/** Hard cap on how much one connected table contributes. A Data Store
 *  table can hold far more rows than belong in a prompt corpus; this
 *  keeps one big table from crowding out every other knowledge source
 *  and from making every sync an expensive embedding run. */
const MAX_RECORDS = 500
const MAX_TEXT_CHARS = 200_000

export interface SerializedTable {
  tableName: string
  recordCount: number
  truncated: boolean
  /** The field labels actually included, so the caller can show an
   *  account exactly what the AI will be able to read from this table
   *  rather than leaving them to guess. */
  fields: string[]
  text: string
}

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map((v) => formatValue(v)).filter(Boolean)
    return parts.length ? parts.join(', ') : null
  }
  if (typeof value === 'object') {
    // Relation/select values are stored as objects with a label-ish
    // field; prefer something human before falling back to JSON.
    const obj = value as Record<string, unknown>
    for (const key of ['label', 'name', 'title', 'value']) {
      const candidate = obj[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
    return JSON.stringify(value)
  }
  return null
}

/**
 * @param purpose What this table is for, in the account's own words,
 *   written into the serialized header so the model is told what the
 *   rows represent and when to use them. A "Programmes" table whose
 *   purpose says "course catalogue — use for questions about what we
 *   teach, duration or eligibility" is answerable; the same rows with
 *   no purpose are just nouns.
 */
export async function serializeDataTable(
  accountId: string,
  tableId: string,
  purpose?: string | null,
): Promise<SerializedTable> {
  const table = await prisma.dataTable.findFirst({
    where: { id: tableId, account_id: accountId },
    select: {
      name: true,
      description: true,
      fields: {
        orderBy: { sort_order: 'asc' },
        select: { field_key: true, label: true, field_type: true },
      },
    },
  })
  if (!table) throw new Error('That table no longer exists.')

  // Password-typed fields are excluded outright — whatever an account
  // stores in one, feeding it into a prompt (and an embedding, and
  // potentially a reply) is not something to do silently.
  const fields = table.fields.filter((f) => f.field_type !== 'password')
  if (fields.length === 0) throw new Error('That table has no fields to read.')

  const records = await prisma.dataRecord.findMany({
    where: { table_id: tableId, account_id: accountId },
    orderBy: { created_at: 'asc' },
    take: MAX_RECORDS + 1,
    select: { data: true },
  })

  const truncated = records.length > MAX_RECORDS
  const used = truncated ? records.slice(0, MAX_RECORDS) : records

  // A structured header, so the model knows what it is reading before
  // it reads it: what the table is, what it is for, and which fields
  // each record carries. Without it a retrieved record is a bare list of
  // label/value pairs with no indication of what the set represents.
  const header = [`TABLE: ${table.name}`]
  const purposeText = purpose?.trim() || table.description?.trim()
  if (purposeText) header.push(`PURPOSE: ${purposeText}`)
  header.push(`FIELDS: ${fields.map((f) => f.label).join(', ')}`)
  header.push('Each block below is one record from this table.')

  const blocks: string[] = [header.join('\n')]

  for (const record of used) {
    const data = (record.data ?? {}) as Record<string, unknown>
    const lines: string[] = []
    for (const field of fields) {
      const formatted = formatValue(data[field.field_key])
      if (formatted) lines.push(`${field.label}: ${formatted}`)
    }
    // A record where every field is empty carries nothing retrievable.
    if (lines.length > 0) blocks.push(lines.join('\n'))
  }

  // 1, not 0 — the header always occupies the first slot.
  if (blocks.length === 1) throw new Error('That table has no records with any content yet.')

  return {
    tableName: table.name,
    recordCount: used.length,
    truncated,
    fields: fields.map((f) => f.label),
    text: blocks.join('\n\n').slice(0, MAX_TEXT_CHARS),
  }
}
