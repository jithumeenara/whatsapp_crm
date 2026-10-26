/**
 * A broadcast audience from a Data Store table — for any business:
 * "MDP Registrations: Fee status is Not paid", "Appointments: Status is
 * No-show", "Orders: Payment is Pending". A table kept in two-way sync
 * with a Google Sheet works the same: the rows are the sheet's rows.
 *
 * A row reaches a contact two ways: the chat that saved it (contact_id),
 * or a phone number anywhere in the row, compared on its last ten digits
 * with the contact's number. Rows whose number is no contact's are
 * counted, so the screen can say "4 people in the table aren't contacts".
 *
 * Comparisons ignore case and surrounding spaces ("Paid", "paid ").
 * "is not" includes empty cells: a blank fee status is not "Paid".
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type TableOp = 'is' | 'is_not' | 'contains' | 'is_empty' | 'is_not_empty'
export const TABLE_OPS: readonly TableOp[] = ['is', 'is_not', 'contains', 'is_empty', 'is_not_empty']

export interface TableAudience {
  tableId?: string
  fieldKey?: string
  operator?: TableOp
  value?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIELD_KEY = /^[A-Za-z0-9_\-. ]{1,100}$/
/** Field types a broadcast may filter on: no secrets, files or layout. */
const FILTERABLE = new Set([
  'text', 'textarea', 'number', 'email', 'phone', 'url', 'date', 'time', 'datetime', 'boolean',
  'select', 'radio', 'country', 'state', 'district', 'address', 'hidden',
])
export const MAX_CONTACTS = 20_000

export function isFilterableField(type: string): boolean {
  return FILTERABLE.has(type)
}

const PHONE_NAME = /phone|mobile|whats ?app|contact|cell|ph[._ ]?no/i
const NEVER_PHONE = /aadh?aa?r|pan\b|account|a\/c|ifsc|pin ?code|pincode|zip|amount|fee|reg(istration)? ?no|id ?no/i

/**
 * The columns whose numbers are people's phone numbers: phone-type
 * columns, else ones named like a phone ("WhatsApp No", "Mobile").
 * Never an Aadhaar, account or PIN column — twelve digits there would
 * otherwise pass for a number. None found: every column, as the
 * registration lookup does.
 */
export function phoneColumns(fields: ReadonlyArray<{ field_key: string; label: string; field_type: string }>): string[] | null {
  const keys = fields
    .filter((f) =>
      !NEVER_PHONE.test(`${f.field_key} ${f.label}`) &&
      (f.field_type === 'phone' || PHONE_NAME.test(`${f.field_key} ${f.label}`)))
    .map((f) => f.field_key)
  return keys.length ? keys : null
}

const needsValue = (op: TableOp) => op === 'is' || op === 'is_not' || op === 'contains'

/** Why these rules cannot be used, in plain words — or null. */
export function tableRuleError(a: TableAudience | undefined): string | null {
  if (!a || typeof a !== 'object') return 'Choose a table and a column.'
  if (typeof a.tableId !== 'string' || !UUID.test(a.tableId)) return 'Choose a table.'
  if (typeof a.fieldKey !== 'string' || !FIELD_KEY.test(a.fieldKey)) return 'Choose a column.'
  if (!TABLE_OPS.includes(a.operator as TableOp)) return 'Choose how to compare.'
  if (needsValue(a.operator as TableOp)) {
    if (typeof a.value !== 'string' || !a.value.trim()) return 'Enter the value to look for.'
    if (a.value.length > 200) return 'The value is too long.'
  }
  return null
}

/** The table and column, checked against this account. */
export async function loadTableRule(accountId: string, a: TableAudience) {
  const table = await prisma.dataTable.findFirst({
    where: { id: a.tableId, account_id: accountId },
    select: { id: true, name: true, fields: { select: { field_key: true, label: true, field_type: true } } },
  })
  if (!table) return { error: 'That table no longer exists.' as const }
  const field = table.fields.find((f) => f.field_key === a.fieldKey)
  if (!field || !isFilterableField(field.field_type)) return { error: 'That column cannot be used here.' as const }
  return { table, field }
}

function conditionSql(a: Required<Pick<TableAudience, 'fieldKey' | 'operator'>> & { value?: string }): Prisma.Sql {
  const cell = Prisma.sql`lower(btrim(coalesce(r.data ->> ${a.fieldKey}, '')))`
  const v = (a.value ?? '').trim().toLowerCase()
  switch (a.operator) {
    case 'is':
      return Prisma.sql`${cell} = ${v}`
    case 'is_not':
      return Prisma.sql`${cell} <> ${v}`
    case 'contains':
      return Prisma.sql`strpos(${cell}, ${v}) > 0`
    case 'is_empty':
      return Prisma.sql`${cell} = ''`
    case 'is_not_empty':
      return Prisma.sql`${cell} <> ''`
  }
}

export interface TableMatch {
  contactIds: string[]
  /** More people match than one broadcast may take: nothing is cut off
   *  silently — the caller refuses and asks for a narrower rule. */
  tooMany: boolean
  /** Rows that met the rule. */
  rows: number
  /** Phone numbers in those rows that are no contact's. */
  notContacts: number
}

/** Contacts (inside this account) whose rows meet the rule. Call after
 *  tableRuleError and loadTableRule. */
export async function tableAudienceMatch(accountId: string, a: TableAudience, phoneKeys: string[] | null): Promise<TableMatch> {
  const cond = conditionSql({ fieldKey: a.fieldKey!, operator: a.operator!, value: a.value })
  const onlyPhoneColumns = phoneKeys ? Prisma.sql`AND e.key = ANY(${phoneKeys}::text[])` : Prisma.empty
  const [res] = await prisma.$queryRaw<Array<{ rows: bigint; ids: string[] | null; not_contacts: bigint }>>(Prisma.sql`
    WITH hit AS (
      SELECT r.contact_id, r.data
      FROM data_records r
      WHERE r.table_id = ${a.tableId}::uuid
        AND r.account_id = ${accountId}::uuid
        AND ${cond}
    ),
    keys AS (
      SELECT DISTINCT right(regexp_replace(e.value, '[^0-9]', '', 'g'), 10) AS k
      FROM hit, jsonb_each_text(CASE WHEN jsonb_typeof(hit.data) = 'object' THEN hit.data ELSE '{}'::jsonb END) e
      WHERE btrim(e.value) ~ '^[+0-9 ()-]{10,20}$'
        AND length(regexp_replace(e.value, '[^0-9]', '', 'g')) BETWEEN 10 AND 13
        ${onlyPhoneColumns}
    ),
    people AS (
      SELECT coalesce(c.merged_into_contact_id, c.id) AS id, right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 10) AS k
      FROM contacts c
      WHERE c.account_id = ${accountId}::uuid
    )
    SELECT
      (SELECT count(*) FROM hit) AS rows,
      ARRAY(
        SELECT DISTINCT p.id::text FROM people p
        WHERE p.id IN (SELECT contact_id FROM hit WHERE contact_id IS NOT NULL)
           OR p.k IN (SELECT k FROM keys)
        ORDER BY 1
        LIMIT ${MAX_CONTACTS + 1}
      ) AS ids,
      (SELECT count(*) FROM keys WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.k = keys.k)) AS not_contacts
  `)
  const ids = res?.ids ?? []
  return {
    contactIds: ids.slice(0, MAX_CONTACTS),
    tooMany: ids.length > MAX_CONTACTS,
    rows: Number(res?.rows ?? 0),
    notContacts: Number(res?.not_contacts ?? 0),
  }
}

/** When the table's Google Sheet last synced, and whether it failed. */
export async function tableSheetSync(accountId: string, tableId: string): Promise<{ at: Date | null; error: string | null } | null> {
  const link = await prisma.googleSheetLink.findFirst({
    where: { table_id: tableId, account_id: accountId },
    orderBy: { last_synced_at: 'desc' },
    select: { last_synced_at: true, last_error: true },
  }).catch(() => null)
  if (!link) return null
  return { at: link.last_synced_at, error: link.last_error }
}

/**
 * The values a column holds, for the picker — only for columns that hold
 * a few repeated values (a status, a batch, a month). A column of names,
 * numbers or ID numbers has too many to list and gets none: the picker
 * then asks the person to type the value.
 */
export async function tableColumnValues(accountId: string, tableId: string, fieldKey: string): Promise<Array<{ value: string; count: number }>> {
  const rows = await prisma.$queryRaw<Array<{ value: string; count: bigint }>>(Prisma.sql`
    SELECT min(btrim(r.data ->> ${fieldKey})) AS value, count(*) AS count
    FROM data_records r
    WHERE r.table_id = ${tableId}::uuid AND r.account_id = ${accountId}::uuid
      AND btrim(coalesce(r.data ->> ${fieldKey}, '')) <> ''
    GROUP BY lower(btrim(r.data ->> ${fieldKey}))
    ORDER BY count(*) DESC
    LIMIT 31
  `)
  if (rows.length > 30) return []
  return rows.map((r) => ({ value: r.value, count: Number(r.count) }))
}
