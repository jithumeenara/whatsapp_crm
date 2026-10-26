import { NextRequest, NextResponse } from "next/server"
import { requireRoleOrApiKey, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { detectType } from "@/lib/integration-fetch"
import { isRazorpayPaymentId, paymentRowFromRazorpay } from "@/lib/integrations/razorpay-payment"
import { afterRecordCreated, afterRecordsChanged } from '@/lib/data-store/record-events'

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
    const { payment_id, integration_id } = body

    if (!isRazorpayPaymentId(payment_id) || !integration_id) {
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
    const payData = (await payRes.json().catch(() => ({}))) as Record<string, unknown>
    const verified = paymentRowFromRazorpay(payment_id, payRes.ok, payData)
    if (!verified.ok) {
      console.warn("[razorpay save-payment] refused:", payment_id, payRes.status, payData.status)
      return NextResponse.json({ error: verified.error }, { status: 400 })
    }
    const row = verified.row

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
      afterRecordsChanged(table.id, ctx.accountId)
    } else {
      const created = await prisma.dataRecord.create({
        data: { table_id: table.id, account_id: ctx.accountId, data: row, source: 'payment' },
      })
      afterRecordCreated({ ...created, source: 'payment' })
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
            opt_in_source: "razorpay",
            opt_in_at: new Date(),
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
