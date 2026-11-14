import { NextRequest, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { auditCtx } from '@/lib/audit'
import { auditConfigChange } from '@/lib/audit/config-change'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  FUNNEL_TEMPLATES,
  parseFunnel,
  parsePresentationSettings,
  parseReportSettings,
  validatePresentationSettings,
  validateFunnel,
  validateReportSettings,
} from '@/lib/reports/settings'

/**
 * Settings → Reports (plan §4): the business's funnel stages, the "needs
 * doing" threshold and manual ad spend. Admin and owner only: the funnel
 * decides what every report counts as a win.
 *
 * Both values live on lead_settings (one row per account, migration 158)
 * and are read and checked only through src/lib/reports/settings.ts.
 */

const TEMPLATES = Object.entries(FUNNEL_TEMPLATES).map(([key, t]) => ({ key, label: t.label, stages: t.stages }))

async function load(accountId: string) {
  const row = await prisma.leadSettings.findUnique({
    where: { account_id: accountId },
    select: { funnel_stages: true, report_settings: true, sla_warn_hours: true },
  })
  return {
    funnel_stages: parseFunnel(row?.funnel_stages),
    report_settings: parseReportSettings(row?.report_settings),
    presentation: parsePresentationSettings(row?.report_settings),
    // What "needs doing" falls back to when no own threshold is set.
    sla_warn_hours: row?.sla_warn_hours ?? 24,
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    return NextResponse.json({ ...(await load(ctx.accountId)), templates: TEMPLATES })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireRole('admin')
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    }

    // Only these two fields, each checked before anything is written.
    const data: { funnel_stages?: Prisma.InputJsonValue; report_settings?: Prisma.InputJsonValue } = {}
    if (body.funnel_stages !== undefined) {
      const v = validateFunnel(body.funnel_stages)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
      data.funnel_stages = v.stages as unknown as Prisma.InputJsonValue
    }
    if (body.report_settings !== undefined) {
      // An empty amount box would otherwise read as Number('') = 0 and
      // save a spend row nobody filled in.
      const rows = (body.report_settings as { manualSpend?: unknown } | null)?.manualSpend
      if (Array.isArray(rows) && rows.some((r) => typeof (r as { amount?: unknown } | null)?.amount !== 'number')) {
        return NextResponse.json({ error: 'Each spend row needs an amount.' }, { status: 400 })
      }
      const v = validateReportSettings(body.report_settings)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
      // The slides' brand colour and category name live in the same JSON.
      const p = validatePresentationSettings(body.report_settings)
      if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 })
      data.report_settings = { ...v.settings, ...p.settings } as unknown as Prisma.InputJsonValue
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    }

    await prisma.leadSettings.upsert({
      where: { account_id: ctx.accountId },
      update: data,
      create: { account_id: ctx.accountId, ...data },
    })

    // Field names only; stage names and spend stay out of the log.
    await auditConfigChange(auditCtx(req, ctx), 'config.lead_settings_changed', {
      area: 'report_settings',
      fields: Object.keys(data),
    })

    return NextResponse.json({ ...(await load(ctx.accountId)), templates: TEMPLATES })
  } catch (err) {
    return toErrorResponse(err)
  }
}
