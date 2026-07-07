import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { detectType } from "@/lib/integration-fetch"

const RAZORPAY_API = "https://api.razorpay.com/v1"

// POST /api/razorpay/save-payment
// Called after successful payment — fetches full payment details from Razorpay
// and saves them to the Data Store table linked to the integration.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRoleOrApiKey(req, "agent")

    const body = (await req.json()) as {
      payment_id: string
      order_id: string
      integration_id: string
      amount: number
      currency: string
    }
    const { payment_id, order_id, integration_id, amount, currency } = body

    if (!payment_id || !integration_id) {
      return NextResponse.json({ error: "payment_id and integration_id are required" }, { status: 400 })
    }

    // Load integration + credentials
    const intg = await prisma.integration.findFirst({
      where: { id: integration_id, account_id: ctx.accountId },
    })
    if (!intg) return NextResponse.json({ error: "Integration not found" }, { status: 404 })

    const cfg = intg.auth_config as { username?: string; password?: string } | null
    if (!cfg?.username || !cfg?.password) {
      return NextResponse.json({ error: "Integration missing credentials" }, { status: 400 })
    }

    const auth = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`

    // Fetch full payment details from Razorpay
    const payRes = await fetch(`${RAZORPAY_API}/payments/${payment_id}`, {
      headers: { Authorization: auth },
    })
    const payData = await payRes.json() as Record<string, unknown>

    // Build a flat row from the payment object
    const UNIX_TS_RE = /^\d{10}$/
    const DATE_KEYS = ["_at", "date", "time", "created", "updated", "captured"]
    const row: Record<string, string> = {}
    for (const [k, v] of Object.entries(payData)) {
      if (v === null || v === undefined || typeof v === "object") continue
      const str = String(v)
      // Convert Unix second-timestamps to ISO strings so date fields display correctly
      const isDateKey = DATE_KEYS.some((d) => k.toLowerCase().includes(d))
      if (isDateKey && UNIX_TS_RE.test(str)) {
        row[k] = new Date(parseInt(str) * 1000).toISOString()
      } else {
        row[k] = str
      }
    }
    // Also save notes as flat fields
    if (payData.notes && typeof payData.notes === "object") {
      for (const [k, v] of Object.entries(payData.notes as Record<string, unknown>)) {
        if (v !== null && v !== undefined && typeof v !== "object") {
          row[`note_${k}`] = String(v)
        }
      }
    }
    // Fallback values from the frontend if Razorpay API call failed
    if (!row.id) row.id = payment_id
    if (!row.order_id) row.order_id = order_id
    if (!row.amount) row.amount = String(amount)
    if (!row.currency) row.currency = currency

    // Find or create a "Razorpay Payments" table for this account
    const tableName = `${intg.name} Payments`
    const slug = tableName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")

    let table = await prisma.dataTable.findUnique({
      where: { account_id_slug: { account_id: ctx.accountId, slug } },
    })
    if (!table) {
      table = await prisma.dataTable.create({
        data: {
          account_id: ctx.accountId,
          name: tableName,
          slug,
          icon: "credit-card",
          description: "Payments collected via Razorpay",
          sort_order: 999,
        },
      })
    }

    // Ensure fields exist for all keys in this row
    const existing = await prisma.dataField.findMany({ where: { table_id: table.id } })
    const existingKeys = new Set(existing.map((f) => f.field_key))
    const toCreate: { table_id: string; account_id: string; label: string; field_key: string; field_type: string; sort_order: number }[] = []
    let order = existing.length
    for (const [key, value] of Object.entries(row)) {
      if (!existingKeys.has(key)) {
        toCreate.push({
          table_id: table.id,
          account_id: ctx.accountId,
          label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          field_key: key,
          field_type: detectType(key, value),
          sort_order: order++,
        })
      }
    }
    if (toCreate.length > 0) {
      await prisma.dataField.createMany({ data: toCreate, skipDuplicates: true })
    }

    // Upsert record by payment id
    const existingRecord = await prisma.dataRecord.findFirst({
      where: { table_id: table.id, data: { path: ["id"], equals: payment_id } },
    })
    if (existingRecord) {
      await prisma.dataRecord.update({ where: { id: existingRecord.id }, data: { data: row } })
    } else {
      await prisma.dataRecord.create({
        data: { table_id: table.id, account_id: ctx.accountId, data: row },
      })
    }

    // Create/update contact from email or contact (phone) field
    const phone = row.contact || row.phone || null
    const email = row.email || null
    if (phone) {
      const normalized = phone.replace(/\D/g, "")
      const existing = await prisma.contact.findFirst({
        where: { account_id: ctx.accountId, phone_normalized: normalized },
      })
      if (!existing) {
        await prisma.contact.create({
          data: {
            account_id: ctx.accountId,
            user_id: ctx.userId,
            phone,
            phone_normalized: normalized,
            name: row.description || null,
            email,
            external_id: payment_id,
          },
        })
      }
    }

    return NextResponse.json({
      success: true,
      table_name: tableName,
      payment_id,
      fields_created: toCreate.length,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
