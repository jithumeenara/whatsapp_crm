import { PrismaClient } from "@prisma/client"
import { buildFetchHeaders, fetchExternalRows, detectType } from "@/lib/integration-fetch"

export interface IntegrationRow {
  id: string
  account_id: string
  name: string
  source_type: string
  base_url: string
  resource: string
  auth_type: string
  auth_config: unknown
  table_name: string | null
}

export interface SyncResult {
  records_synced: number
  contacts_created: number
  table_name: string
}

// ── Predefined schemas for common endpoints ────────────────────
// Used to create tables with proper field types even before any data arrives.

type FieldDef = { field_key: string; label: string; field_type: string }

const KNOWN_SCHEMAS: Record<string, FieldDef[]> = {
  // Razorpay
  "customers": [
    { field_key: "id",         label: "Customer ID", field_type: "text"  },
    { field_key: "name",       label: "Name",        field_type: "text"  },
    { field_key: "contact",    label: "Phone",       field_type: "phone" },
    { field_key: "email",      label: "Email",       field_type: "email" },
    { field_key: "gstin",      label: "GSTIN",       field_type: "text"  },
    { field_key: "created_at", label: "Created At",  field_type: "date"  },
  ],
  "payments": [
    { field_key: "id",          label: "Payment ID",  field_type: "text"   },
    { field_key: "amount",      label: "Amount",      field_type: "number" },
    { field_key: "currency",    label: "Currency",    field_type: "text"   },
    { field_key: "status",      label: "Status",      field_type: "text"   },
    { field_key: "method",      label: "Method",      field_type: "text"   },
    { field_key: "email",       label: "Email",       field_type: "email"  },
    { field_key: "contact",     label: "Phone",       field_type: "phone"  },
    { field_key: "order_id",    label: "Order ID",    field_type: "text"   },
    { field_key: "description", label: "Description", field_type: "text"   },
    { field_key: "created_at",  label: "Created At",  field_type: "date"   },
  ],
  "orders": [
    { field_key: "id",          label: "Order ID",   field_type: "text"   },
    { field_key: "amount",      label: "Amount",     field_type: "number" },
    { field_key: "currency",    label: "Currency",   field_type: "text"   },
    { field_key: "status",      label: "Status",     field_type: "text"   },
    { field_key: "receipt",     label: "Receipt",    field_type: "text"   },
    { field_key: "created_at",  label: "Created At", field_type: "date"   },
  ],
  // Stripe
  "v1/customers": [
    { field_key: "id",      label: "Customer ID", field_type: "text"  },
    { field_key: "name",    label: "Name",        field_type: "text"  },
    { field_key: "email",   label: "Email",       field_type: "email" },
    { field_key: "phone",   label: "Phone",       field_type: "phone" },
    { field_key: "created", label: "Created At",  field_type: "date"  },
  ],
}

function getKnownSchema(resource: string): FieldDef[] | null {
  // Match by exact resource or last path segment
  const key = resource.replace(/^\//, "").toLowerCase()
  if (KNOWN_SCHEMAS[key]) return KNOWN_SCHEMAS[key]
  const segment = key.split("/").pop() ?? ""
  return KNOWN_SCHEMAS[segment] ?? null
}

// ── Helpers ────────────────────────────────────────────────────

const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/

function findPhone(row: Record<string, string>): string | null {
  // Explicit phone-named keys + Razorpay "contact" field
  const phoneKeys = ["phone", "mobile", "telephone", "tel", "contact",
    "contact_phone", "patient_phone", "customer_phone", "billing_phone"]
  for (const k of phoneKeys) {
    if (row[k] && PHONE_RE.test(row[k])) return row[k]
  }
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase().includes("phone") && PHONE_RE.test(v)) return v
  }
  return null
}

function findName(row: Record<string, string>): string | null {
  for (const k of ["name", "full_name", "customer_name", "patient_name",
    "guest_name", "contact_name", "billing_name"]) {
    if (row[k]) return row[k]
  }
  return null
}

function findExternalId(row: Record<string, string>): string | null {
  for (const k of ["fhir_id", "id", "order_id", "booking_id", "patient_id",
    "customer_id", "record_id", "payment_id"]) {
    if (row[k]) return row[k]
  }
  return null
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
}

// ── Table / field management ───────────────────────────────────

async function findOrCreateTable(db: PrismaClient, accountId: string, tableName: string): Promise<string> {
  const slug = slugify(tableName)
  const existing = await db.dataTable.findUnique({
    where: { account_id_slug: { account_id: accountId, slug } },
  })
  if (existing) return existing.id
  const created = await db.dataTable.create({
    data: { account_id: accountId, name: tableName, slug, icon: "plug", description: "Auto-created by integration", sort_order: 999 },
  })
  return created.id
}

async function ensureFieldsFromSchema(db: PrismaClient, tableId: string, accountId: string, fields: FieldDef[]): Promise<void> {
  const existing = await db.dataField.findMany({ where: { table_id: tableId } })
  const existingKeys = new Set(existing.map((f) => f.field_key))
  const toCreate = fields
    .filter((f) => !existingKeys.has(f.field_key))
    .map((f, i) => ({ table_id: tableId, account_id: accountId, ...f, sort_order: existing.length + i }))
  if (toCreate.length > 0) await db.dataField.createMany({ data: toCreate, skipDuplicates: true })
}

async function ensureFieldsFromSample(db: PrismaClient, tableId: string, accountId: string, sample: Record<string, string>): Promise<void> {
  const existing = await db.dataField.findMany({ where: { table_id: tableId } })
  const existingKeys = new Set(existing.map((f) => f.field_key))
  const toCreate: { table_id: string; account_id: string; label: string; field_key: string; field_type: string; sort_order: number }[] = []
  let order = existing.length
  for (const [key, value] of Object.entries(sample)) {
    if (existingKeys.has(key)) continue
    toCreate.push({
      table_id: tableId,
      account_id: accountId,
      label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      field_key: key,
      field_type: detectType(key, value),
      sort_order: order++,
    })
  }
  if (toCreate.length > 0) await db.dataField.createMany({ data: toCreate, skipDuplicates: true })
}

async function upsertRecord(db: PrismaClient, tableId: string, accountId: string, row: Record<string, string>, externalId: string | null): Promise<void> {
  if (externalId) {
    const existing = await db.dataRecord.findFirst({
      where: { table_id: tableId, data: { path: ["id"], equals: externalId } },
    })
    if (existing) {
      await db.dataRecord.update({ where: { id: existing.id }, data: { data: row } })
      return
    }
  }
  await db.dataRecord.create({ data: { table_id: tableId, account_id: accountId, data: row } })
}

async function upsertContact(db: PrismaClient, accountId: string, userId: string, row: Record<string, string>): Promise<boolean> {
  const phone = findPhone(row)
  if (!phone) return false
  const normalized = phone.replace(/\D/g, "")
  if (normalized.length < 7) return false
  const existing = await db.contact.findFirst({ where: { account_id: accountId, phone_normalized: normalized } })
  const name = findName(row)
  const externalId = findExternalId(row)
  if (existing) {
    if ((!existing.name && name) || (!existing.external_id && externalId)) {
      await db.contact.update({
        where: { id: existing.id },
        data: { name: existing.name ?? name, external_id: existing.external_id ?? externalId },
      })
    }
    return false
  }
  await db.contact.create({
    data: { account_id: accountId, user_id: userId, phone, phone_normalized: normalized, name, email: row.email ?? null, external_id: externalId },
  })
  return true
}

// ── Main sync ──────────────────────────────────────────────────

export async function runSync(db: PrismaClient, integration: IntegrationRow, userId: string): Promise<SyncResult> {
  const headers = buildFetchHeaders(integration.auth_type, integration.auth_config as Record<string, string> | null)

  const rows = await fetchExternalRows({
    source_type: integration.source_type,
    base_url: integration.base_url,
    resource: integration.resource,
    headers,
  })

  const tableName = integration.table_name || `${integration.name}`
  const tableId = await findOrCreateTable(db, integration.account_id, tableName)

  const knownSchema = getKnownSchema(integration.resource)

  if (rows.length === 0) {
    // No records yet — create table with predefined schema if we know this endpoint
    if (knownSchema) await ensureFieldsFromSchema(db, tableId, integration.account_id, knownSchema)
    return { records_synced: 0, contacts_created: 0, table_name: tableName }
  }

  // Use known schema for accurate field types, fall back to auto-detection
  if (knownSchema) {
    await ensureFieldsFromSchema(db, tableId, integration.account_id, knownSchema)
  } else {
    await ensureFieldsFromSample(db, tableId, integration.account_id, rows[0])
  }

  let recordsSynced = 0, contactsCreated = 0
  for (const row of rows) {
    await upsertRecord(db, tableId, integration.account_id, row, findExternalId(row))
    recordsSynced++
    if (await upsertContact(db, integration.account_id, userId, row)) contactsCreated++
  }

  return { records_synced: recordsSynced, contacts_created: contactsCreated, table_name: tableName }
}
