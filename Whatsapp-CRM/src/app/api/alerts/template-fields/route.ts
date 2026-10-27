import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { prisma } from "@/lib/db"
import { ALERT_KINDS, cleanMapping, mappingFor, type AlertKind } from "@/lib/whatsapp/alert-fields"

/**
 * What each {{n}} of a staff-alert template carries.
 *   GET  /api/alerts/template-fields?kind=handoff|new_contact&template=<name>
 *   PUT  /api/alerts/template-fields  { kind, template, params: string[] | null }
 * Saved as { template, fields }: it applies only while that template is
 * the alert's template.
 * null clears it (the old fixed order). Admins only, like the alert
 * settings themselves.
 */
function kindOf(v: unknown): AlertKind | null {
  return v === "handoff" || v === "new_contact" ? v : null
}

async function read(accountId: string, kind: AlertKind): Promise<unknown> {
  if (kind === "handoff") {
    return (await prisma.aiConfig.findUnique({ where: { account_id: accountId }, select: { handoff_alert_params: true } }))?.handoff_alert_params ?? null
  }
  return (await prisma.contactCaptureConfig.findUnique({ where: { account_id: accountId }, select: { new_contact_alert_params: true } }))?.new_contact_alert_params ?? null
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireRole("admin")
    const kind = kindOf(req.nextUrl.searchParams.get("kind"))
    if (!kind) return NextResponse.json({ error: "kind must be handoff or new_contact" }, { status: 400 })
    const template = req.nextUrl.searchParams.get("template")
    return NextResponse.json({ params: mappingFor(await read(ctx.accountId, kind), template), fields: ALERT_KINDS[kind].fields, legacy: ALERT_KINDS[kind].legacy })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireRole("admin")
    const body = await req.json().catch(() => null)
    const kind = kindOf(body?.kind)
    if (!kind) return NextResponse.json({ error: "kind must be handoff or new_contact" }, { status: 400 })
    const template = typeof body.template === "string" ? body.template.trim().slice(0, 512) : ""
    let params: string[] | null = null
    if (body.params !== null && body.params !== undefined) {
      if (!template) return NextResponse.json({ error: "Choose the alert's template first." }, { status: 400 })
      const clean = cleanMapping(body.params)
      if (!clean || clean.some((f) => !ALERT_KINDS[kind].fields.includes(f))) {
        return NextResponse.json({ error: "Choose a value for every variable." }, { status: 400 })
      }
      params = clean
    }
    const value = params ? { template, fields: params } : undefined
    if (kind === "handoff") {
      const r = await prisma.aiConfig.updateMany({ where: { account_id: ctx.accountId }, data: { handoff_alert_params: value ?? Prisma.DbNull } })
      if (r.count === 0) return NextResponse.json({ error: "Set up the AI assistant first." }, { status: 400 })
    } else {
      await prisma.contactCaptureConfig.upsert({
        where: { account_id: ctx.accountId },
        update: { new_contact_alert_params: value ?? Prisma.DbNull },
        create: { account_id: ctx.accountId, new_contact_alert_params: value ?? Prisma.DbNull },
      })
    }
    return NextResponse.json({ params, template: params ? template : null })
  } catch (err) {
    return toErrorResponse(err)
  }
}

