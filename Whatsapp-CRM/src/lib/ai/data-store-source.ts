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

export async function serializeDataTable(accountId: string, tableId: string): Promise<SerializedTable> {
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

  const blocks: string[] = []
  if (table.description?.trim()) blocks.push(`${table.name}: ${table.description.trim()}`)

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

  if (blocks.length === 0) throw new Error('That table has no records with any content yet.')

  return {
    tableName: table.name,
    recordCount: used.length,
    truncated,
    text: blocks.join('\n\n').slice(0, MAX_TEXT_CHARS),
  }
}
