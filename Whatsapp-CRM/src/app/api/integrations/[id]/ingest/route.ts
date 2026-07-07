import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { flattenPlain, detectType } from "@/lib/integration-fetch"

/**
 * POST /api/integrations/[id]/ingest
 * Accepts a real-time data push from any external system (webhook-style).
 * Body can be a single object OR an array of objects.
 * Records are upserted; Contacts are created from phone fields.
 *
 * External apps call this URL directly — no login required, but the
 * integration must exist and be active.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Look up integration by id (no user session needed — this is a server-to-server push)
  const integration = await prisma.integration.findUnique({ where: { id } })
  if (!integration) return NextResponse.json({ error: "Integration not found" }, { status: 404 })
  if (integration.status === "paused") return NextResponse.json({ error: "Integration is paused" }, { status: 400 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  const rawRows: unknown[] = Array.isArray(body) ? body : [body]
  const rows = rawRows
    .filter((r) => r && typeof r === "object" && !Array.isArray(r))
    .map((r) => flattenPlain(r as Record<string, unknown>))

  if (rows.length === 0) return NextResponse.json({ error: "No valid records in body" }, { status: 400 })

  // Find or create the Data Store table
  const tableName = integration.table_name || `${integration.name} ${integration.resource}`
  const slug = tableName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
  let table = await prisma.dataTable.findUnique({ where: { account_id_slug: { account_id: integration.account_id, slug } } })
  if (!table) {
    table = await prisma.dataTable.create({
      data: { account_id: integration.account_id, name: tableName, slug, icon: "plug", description: "Auto-created by integration", sort_order: 999 },
    })
  }

  // Ensure fields exist for all keys in first row
  const existing = await prisma.dataField.findMany({ where: { table_id: table.id } })
  const existingKeys = new Set(existing.map((f) => f.field_key))
  const toCreate: { table_id: string; account_id: string; label: string; field_key: string; field_type: string; sort_order: number }[] = []
  let order = existing.length
  for (const [key, value] of Object.entries(rows[0])) {
    if (!existingKeys.has(key)) {
      toCreate.push({ table_id: table.id, account_id: integration.account_id, label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), field_key: key, field_type: detectType(key, value), sort_order: order++ })
    }
  }
  if (toCreate.length > 0) await prisma.dataField.createMany({ data: toCreate, skipDuplicates: true })

  let recordsUpserted = 0, contactsCreated = 0

  for (const row of rows) {
    // Upsert record by external id
    const externalId = row.id || row.order_id || row.customer_id || row.booking_id || row.payment_id || null
    if (externalId) {
      const existing = await prisma.dataRecord.findFirst({
        where: { table_id: table.id, data: { path: ["id"], equals: externalId } },
      })
      if (existing) {
        await prisma.dataRecord.update({ where: { id: existing.id }, data: { data: row } })
      } else {
        await prisma.dataRecord.create({ data: { table_id: table.id, account_id: integration.account_id, data: row } })
      }
    } else {
      await prisma.dataRecord.create({ data: { table_id: table.id, account_id: integration.account_id, data: row } })
    }
    recordsUpserted++

    // Contact from phone
    const phone = findPhone(row)
    if (phone) {
      const normalized = phone.replace(/\D/g, "")
      const existing = await prisma.contact.findFirst({ where: { account_id: integration.account_id, phone_normalized: normalized } })
      if (!existing) {
        const name = row.name || row.customer_name || row.full_name || null
        const ownerProfile = await prisma.profile.findFirst({ where: { account_id: integration.account_id, account_role: "owner" } })
        if (ownerProfile) {
          await prisma.contact.create({
            data: { account_id: integration.account_id, user_id: ownerProfile.user_id, phone, phone_normalized: normalized, name, email: row.email || null, external_id: externalId },
          })
          contactsCreated++
        }
      }
    }
  }

  await prisma.integration.update({ where: { id }, data: { last_synced_at: new Date() } })

  return NextResponse.json({ success: true, records_upserted: recordsUpserted, contacts_created: contactsCreated })
}

function findPhone(row: Record<string, string>): string | null {
  const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/
  for (const k of ["phone", "mobile", "telephone", "tel", "contact_phone", "customer_phone", "patient_phone"]) {
    if (row[k] && PHONE_RE.test(row[k])) return row[k]
  }
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase().includes("phone") && PHONE_RE.test(v)) return v
  }
  return null
}
