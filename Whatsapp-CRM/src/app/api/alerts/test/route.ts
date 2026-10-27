import { NextRequest, NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { checkRateLimit } from "@/lib/rate-limit"
import { ALERT_FIELD_SAMPLE, mappingFor, type AlertKind } from "@/lib/whatsapp/alert-fields"
import { cleanNumbers, sendStaffAlert } from "@/lib/whatsapp/staff-alert"

/**
 * POST /api/alerts/test  { kind: "handoff" | "new_contact" }
 * Sends one alert with sample values to the configured numbers, exactly
 * as a real one goes (same template, same mapping), and says per number
 * whether it went. Admins only; a few per ten minutes — each is a real
 * WhatsApp message.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireRole("admin")
    const rl = checkRateLimit(`alert-test:${ctx.accountId}`, { limit: 5, windowMs: 10 * 60_000 })
    if (!rl.success) return NextResponse.json({ error: "Too many test alerts. Try again in a few minutes." }, { status: 429 })

    const body = await req.json().catch(() => null)
    const kind: AlertKind | null = body?.kind === "handoff" || body?.kind === "new_contact" ? body.kind : null
    if (!kind) return NextResponse.json({ error: "kind must be handoff or new_contact" }, { status: 400 })

    let numbers: unknown
    let template: string | null
    let mapping: unknown
    if (kind === "handoff") {
      const c = await prisma.aiConfig.findUnique({
        where: { account_id: ctx.accountId },
        select: { handoff_alert_numbers: true, handoff_alert_template: true, handoff_alert_params: true },
      })
      numbers = c?.handoff_alert_numbers
      template = c?.handoff_alert_template ?? null
      mapping = c?.handoff_alert_params
    } else {
      const c = await prisma.contactCaptureConfig.findUnique({
        where: { account_id: ctx.accountId },
        select: { new_contact_alert_numbers: true, new_contact_alert_template: true, new_contact_alert_params: true },
      })
      numbers = c?.new_contact_alert_numbers
      template = c?.new_contact_alert_template ?? null
      mapping = c?.new_contact_alert_params
    }
    if (cleanNumbers(numbers).length === 0) {
      return NextResponse.json({ error: "Add at least one number to alert, and save, first." }, { status: 400 })
    }

    const values = { ...ALERT_FIELD_SAMPLE }
    const result = await sendStaffAlert({
      accountId: ctx.accountId,
      numbers,
      template,
      templateParams: [values.customer_name, values.customer_phone, values.customer_message, kind === "handoff" ? values.reason : values.channel],
      kind,
      mapping: mappingFor(mapping, template),
      values,
      label: "alert-test",
      text: `🔔 Test alert (${kind === "handoff" ? "customer needs a person" : "new contact"}) — sample values only.\n\nFrom: ${values.customer_name}\nNumber: ${values.customer_phone}\nThey said: "${values.customer_message}"`,
    })
    return NextResponse.json({ ...result, usedTemplate: template })
  } catch (err) {
    return toErrorResponse(err)
  }
}
